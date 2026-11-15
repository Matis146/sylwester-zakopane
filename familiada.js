// Familiada Granatu: lobby, przyciski zgłoszeń i tablica na żywo (Firebase Auth + Firestore).
// Gracze logują się anonimowo; prowadzący to konto anonimowe dopisane do „familiada_host”.
// Odpowiedzi z punktami leżą w „familiada_pytania”, którą czyta tylko prowadzący –
// na wspólną tablicę trafiają dopiero po odkryciu.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, connectFirestoreEmulator, doc, collection, query, orderBy, onSnapshot,
  getDoc, getDocs, setDoc, updateDoc, deleteDoc, serverTimestamp, increment, deleteField,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
const EMU = LOCAL && new URLSearchParams(location.search).has("emu");
const app = initializeApp({ apiKey: "AIzaSyCt3gklt5Vb5j-YmuBKUBb4oQqY7C1usnw", authDomain: "granat-zlota-pilka-7299.firebaseapp.com", projectId: "granat-zlota-pilka-7299" }, "familiada");
const auth = getAuth(app);
const db = getFirestore(app);
if (EMU) { connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true }); connectFirestoreEmulator(db, "127.0.0.1", 8085); }

const GRA = doc(db, "familiada", "gra");
const GRACZE = collection(db, "familiada", "gra", "gracze");
const buzzDoc = runda => doc(db, "familiada", "gra", "buzz", String(runda));
const NOWA_GRA = {
  faza: "lobby", druzyny: { A: "Granatowi", B: "Czerwoni" }, wynik: { A: 0, B: 0 },
  runda: 0, pytanie: "", sloty: 0, odkryte: {}, mnoznik: 1, pula: 0, przyznano: "",
  buzz: false, kontrola: "", bledy: 0, kradziez: false, uzyte: [], blysk: { typ: "", n: 0 },
};
const IMIONA = { rafal: "Rafał", gadom: "Gadom" };

const $ = id => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const btn = (text, cls, fn) => { const b = el("button", "fb " + (cls || ""), text); b.type = "button"; b.addEventListener("click", fn); return b; };
const who = () => { try { return JSON.parse(sessionStorage.getItem("me") || "null")?.login || null; } catch (e) { return null; } };
const imie = l => IMIONA[l] || l.charAt(0).toUpperCase() + l.slice(1);
const fail = e => { console.error(e); status("Coś poszło nie tak: " + (e.code || e.message) + ". Odśwież stronę.", true); };
const status = (t, err) => { const s = $("fam-status"); s.textContent = t || ""; s.hidden = !t; s.classList.toggle("err", !!err); };

let uid = null, login = null, host = false, stan = null, gracze = [], buzz = null, bank = [];
let started = false, unsubBuzz = null, lastBlysk = null, lastOdkryte = null;

// ---------- Dźwięki (Web Audio, bez plików) ----------
let ac = null;
const unlockAudio = () => { try { ac = ac || new AudioContext(); if (ac.state === "suspended") ac.resume(); } catch (e) {} };
function tone(freqs, dur, type = "square", gain = 0.12) {
  if (!ac) return;
  const t0 = ac.currentTime;
  freqs.forEach((f, i) => {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(0, t0 + i * dur); g.gain.linearRampToValueAtTime(gain, t0 + i * dur + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + (i + 1) * dur);
    o.connect(g).connect(ac.destination); o.start(t0 + i * dur); o.stop(t0 + (i + 1) * dur + 0.02);
  });
}
const sndBuzz = () => tone([880, 1320], 0.12, "square", 0.1);
const sndOk = () => tone([660, 880, 1100], 0.11, "triangle", 0.2);
const sndX = () => tone([110, 98], 0.35, "sawtooth", 0.16);
addEventListener("pointerdown", unlockAudio, { once: true });

// ---------- Start (po zalogowaniu na stronie i wejściu w zakładkę) ----------
const onTab = () => /^#(familiada|odliczanie)$/.test(location.hash);
function maybeStart() {
  if (started || !onTab() || !(login = who())) return;
  started = true;
  status("Łączę z grą…");
  signInAnonymously(auth).catch(fail);
  onAuthStateChanged(auth, async user => {
    if (!user || uid === user.uid) return;
    uid = user.uid;
    try { host = (await getDoc(doc(db, "familiada_host", uid))).exists(); } catch (e) { host = false; }
    if (host) {
      try { bank = (await getDocs(query(collection(db, "familiada_pytania"), orderBy("nr")))).docs.map(d => ({ id: d.id, ...d.data() })); } catch (e) { fail(e); }
    }
    onSnapshot(GRA, s => { stan = s.exists() ? s.data() : null; status(""); watchBuzz(); render(); effects(); }, fail);
    onSnapshot(GRACZE, s => { gracze = s.docs.map(d => ({ uid: d.id, ...d.data() })); render(); }, fail);
  });
}
addEventListener("hashchange", maybeStart);
addEventListener("granat:login", maybeStart);
maybeStart();

function watchBuzz() {
  if (!stan) return;
  const r = stan.runda;
  if (watchBuzz.r === r) return;
  watchBuzz.r = r;
  if (unsubBuzz) unsubBuzz();
  buzz = null;
  let first = true;
  unsubBuzz = onSnapshot(buzzDoc(r), s => {
    const prev = buzz;
    buzz = s.exists() ? s.data() : null;
    if (buzz && !first && (!prev || prev.uid !== buzz.uid)) sndBuzz();
    first = false;
    render();
  }, fail);
}

// Animacje i dźwięki tylko przy zmianach (nie przy pierwszym wczytaniu).
function effects() {
  if (!stan) return;
  const n = Object.keys(stan.odkryte || {}).length;
  if (lastOdkryte !== null && n > lastOdkryte) sndOk();
  lastOdkryte = n;
  const b = stan.blysk || {};
  if (lastBlysk !== null && b.n && b.n !== lastBlysk && b.typ === "x") {
    sndX();
    const x = $("fam-bigx"); x.hidden = false; x.textContent = "✕".repeat(Math.min(3, stan.bledy || 1));
    clearTimeout(effects.t); effects.t = setTimeout(() => x.hidden = true, 1300);
  }
  lastBlysk = b.n || 0;
}

// ---------- Akcje gracza ----------
const ja = () => gracze.find(g => g.uid === uid);
async function dolacz(d) {
  unlockAudio();
  try { await setDoc(doc(GRACZE, uid), { imie: imie(login), druzyna: d }); } catch (e) { fail(e); }
}
async function zglos() {
  unlockAudio();
  const g = ja();
  if (!g || !stan?.buzz || buzz) return;
  try { await setDoc(buzzDoc(stan.runda), { uid, imie: g.imie, druzyna: g.druzyna, t: serverTimestamp() }); }
  catch (e) { /* ktoś był szybszy – reguły nie pozwalają nadpisać */ }
}

// ---------- Akcje prowadzącego ----------
const upd = data => updateDoc(GRA, data).catch(fail);
const pyt = () => bank.find(q => q.id === stan?.pytanieId);
const H = {
  nowa: () => confirm("Zacząć nową grę? Wyniki zostaną wyzerowane (gracze zostają).") && setDoc(GRA, { ...NOWA_GRA, druzyny: stan?.druzyny || NOWA_GRA.druzyny }).catch(fail),
  start: () => upd({ faza: "gra" }),
  koniec: () => confirm("Zakończyć grę i pokazać zwycięzcę?") && upd({ faza: "koniec", buzz: false }),
  pytanie: (id, m) => {
    const q = bank.find(x => x.id === id);
    if (!q) return;
    upd({ faza: "gra", runda: (stan.runda || 0) + 1, pytanieId: q.id, pytanie: q.pytanie, sloty: q.odpowiedzi.length, odkryte: {},
      mnoznik: m, pula: 0, przyznano: "", buzz: true, kontrola: "", bledy: 0, kradziez: false, uzyte: [...new Set([...(stan.uzyte || []), q.id])] });
  },
  odkryj: i => {
    const a = pyt()?.odpowiedzi[i];
    if (!a || stan.odkryte?.[i]) return;
    const d = { ["odkryte." + i]: { t: a.t, p: a.p } };
    if (!stan.przyznano) d.pula = increment(a.p * (stan.mnoznik || 1));
    upd(d);
  },
  reszta: () => {
    const q = pyt(); if (!q) return;
    const d = {}; q.odpowiedzi.forEach((a, i) => { if (!stan.odkryte?.[i]) d["odkryte." + i] = { t: a.t, p: a.p }; });
    if (Object.keys(d).length) upd(d);
  },
  blad: () => {
    const b = Math.min(3, (stan.bledy || 0) + 1);
    upd({ bledy: b, kradziez: b >= 3 && !!stan.kontrola, blysk: { typ: "x", n: Date.now() } });
  },
  kontrola: d => upd({ kontrola: d, bledy: 0, kradziez: false, buzz: false }),
  przyznaj: d => {
    if (stan.przyznano) return;
    upd({ ["wynik." + d]: increment(stan.pula || 0), przyznano: d, buzz: false });
  },
  otworz: () => upd({ buzz: true }),
  resetBuzz: async () => { try { await deleteDoc(buzzDoc(stan.runda)); await upd({ buzz: true }); } catch (e) { fail(e); } },
  nazwy: () => upd({ druzyny: { A: $("fh-nA").value.trim().slice(0, 30) || "Drużyna A", B: $("fh-nB").value.trim().slice(0, 30) || "Drużyna B" } }),
  przenies: g => updateDoc(doc(GRACZE, g.uid), { druzyna: g.druzyna === "A" ? "B" : "A" }).catch(fail),
  usun: g => confirm(`Usunąć ${g.imie} z gry?`) && deleteDoc(doc(GRACZE, g.uid)).catch(fail),
  utworz: () => setDoc(GRA, NOWA_GRA).catch(fail),
};

// ---------- Wyświetlanie ----------
function render() {
  const root = $("fam-app");
  if (!root || !uid) return;
  const me = ja();
  const nazwa = d => stan?.druzyny?.[d] || d;
  root.replaceChildren();

  if (!stan) {
    root.append(el("p", "fam-note", host ? "Gra jeszcze nie istnieje." : "Prowadzący jeszcze nie otworzył gry. Zajrzyj za chwilę."));
    if (host) root.append(btn("Utwórz grę", "gold", H.utworz));
    hostPanel(); return;
  }

  // Tablica wyników
  const score = el("div", "fam-score");
  for (const d of ["A", "B"]) {
    const s = el("div", `fam-team t${d}` + (stan.kontrola === d ? " on" : ""));
    s.append(el("span", "", nazwa(d)), el("b", "", String(stan.wynik?.[d] || 0)));
    score.append(s);
    if (d === "A") { const p = el("div", "fam-pot"); p.append(el("span", "", "Pula"), el("b", "", String(stan.pula || 0))); if (stan.mnoznik > 1) p.append(el("small", "", "×" + stan.mnoznik)); score.append(p); }
  }
  root.append(score);

  if (stan.faza === "koniec") {
    const a = stan.wynik?.A || 0, b = stan.wynik?.B || 0;
    const end = el("div", "fam-end");
    end.append(el("p", "kicker", "Koniec gry"), el("h3", "", a === b ? "Remis!" : `Wygrywają ${nazwa(a > b ? "A" : "B")}!`), el("p", "", `${nazwa("A")} ${a} : ${b} ${nazwa("B")}`));
    root.append(end);
  } else if (stan.faza === "lobby" || !stan.pytanie) {
    root.append(el("p", "fam-note", stan.faza === "lobby" ? "Lobby – czekamy, aż prowadzący zacznie grę." : "Czekamy na pierwsze pytanie…"));
  } else {
    // Pytanie i tablica odpowiedzi
    const board = el("div", "fam-board");
    board.append(el("p", "fam-round", `Runda ${stan.runda}` + (stan.mnoznik > 1 ? ` · punkty ×${stan.mnoznik}` : "")), el("h3", "fam-q", stan.pytanie));
    const ol = el("ol", "fam-slots");
    for (let i = 0; i < stan.sloty; i++) {
      const a = stan.odkryte?.[i];
      const li = el("li", a ? "open" : "");
      li.append(el("span", "n", String(i + 1)), el("span", "t", a ? a.t : "· · · · · · · · · ·"), el("span", "p", a ? String(a.p) : "––"));
      ol.append(li);
    }
    board.append(ol);
    const strikes = el("div", "fam-strikes");
    for (let i = 0; i < 3; i++) strikes.append(el("span", i < (stan.bledy || 0) ? "on" : "", "✕"));
    if (stan.kontrola) strikes.prepend(el("small", "", `Gra: ${nazwa(stan.kontrola)}` + (stan.kradziez ? ` · kradnie: ${nazwa(stan.kontrola === "A" ? "B" : "A")}` : "")));
    board.append(strikes);
    if (stan.przyznano) board.append(el("p", "fam-award", `Pula dla: ${nazwa(stan.przyznano)}`));
    root.append(board);

    // Zgłoszenia
    if (buzz) {
      const w = el("div", `fam-first t${buzz.druzyna}`);
      w.append(el("small", "", "Pierwszy zgłosił się"), el("b", "", buzz.imie), el("span", "", nazwa(buzz.druzyna)));
      root.append(w);
    } else if (me) {
      const b = btn(stan.buzz ? "Zgłaszam się!" : "Czekaj na sygnał…", "fam-buzz", zglos);
      b.disabled = !stan.buzz;
      root.append(b);
    }
  }

  // Lobby: drużyny i gracze
  const lobby = el("div", "fam-lobby");
  for (const d of ["A", "B"]) {
    const col = el("div", `fam-col t${d}`);
    col.append(el("h4", "", nazwa(d)));
    const ul = el("ul");
    gracze.filter(g => g.druzyna === d).forEach(g => ul.append(el("li", g.uid === uid ? "me" : "", g.imie)));
    if (!ul.children.length) ul.append(el("li", "empty", "nikogo"));
    col.append(ul);
    if (!me && stan.faza !== "koniec") col.append(btn("Dołącz", "gold", () => dolacz(d)));
    else if (me && me.druzyna !== d && stan.faza === "lobby") col.append(btn("Przejdź tutaj", "", () => dolacz(d)));
    lobby.append(col);
  }
  root.append(lobby);
  if (!me) root.append(el("p", "fam-note", "Wybierz drużynę, żeby grać."));
  hostPanel();
}

function hostPanel() {
  const box = $("fam-host");
  const keep = { q: $("fh-q")?.value, m: $("fh-m")?.value, nA: $("fh-nA"), nB: $("fh-nB") };
  const focused = document.activeElement;
  box.replaceChildren();
  box.hidden = !(host || login === "mateusz");
  if (box.hidden) return;
  box.append(el("p", "kicker", "Panel prowadzącego"));
  if (!host) {
    box.append(el("p", "", "Ta przeglądarka nie jest jeszcze prowadzącym. Wyślij Claude'owi ten identyfikator, żeby ją dopisał:"), el("code", "fam-uid", uid || "…"));
    return;
  }
  if (!stan) return;
  const row = (...kids) => { const r = el("div", "fh-row"); r.append(...kids); box.append(r); return r; };

  // Pytanie
  const sel = el("select"); sel.id = "fh-q";
  bank.forEach(q => { const o = new Option(`${q.nr}. ${q.pytanie}${(stan.uzyte || []).includes(q.id) ? " ✓" : ""}`, q.id); sel.append(o); });
  const next = bank.find(q => !(stan.uzyte || []).includes(q.id)); if (next) sel.value = next.id;
  if (keep.q && bank.some(q => q.id === keep.q) && !(stan.uzyte || []).includes(keep.q)) sel.value = keep.q;
  const mult = el("select"); mult.id = "fh-m"; [1, 2, 3].forEach(m => mult.append(new Option("×" + m, m)));
  if (keep.m) mult.value = keep.m;
  box.append(el("h4", "", "1. Pytanie"));
  row(sel, mult, btn("Pokaż pytanie", "gold", () => H.pytanie(sel.value, +mult.value)));
  if (!bank.length) box.append(el("p", "fam-note", "Brak pytań w bazie – poproś Claude'a o wgranie."));

  // Odpowiedzi
  const q = pyt();
  if (q && stan.pytanie) {
    box.append(el("h4", "", "2. Odpowiedzi (kliknij, żeby odkryć)"));
    const list = el("div", "fh-answers");
    q.odpowiedzi.forEach((a, i) => {
      const b = btn(`${i + 1}. ${a.t} · ${a.p}`, stan.odkryte?.[i] ? "done" : "", () => H.odkryj(i));
      b.disabled = !!stan.odkryte?.[i];
      list.append(b);
    });
    box.append(list);
    box.append(el("h4", "", "3. Przebieg rundy"));
    row(btn(stan.buzz ? "Przyciski otwarte" : "Otwórz przyciski", "", H.otworz), btn("Reset zgłoszenia", "", H.resetBuzz));
    row(btn(`Gra: ${stan.druzyny.A}`, stan.kontrola === "A" ? "gold" : "", () => H.kontrola("A")), btn(`Gra: ${stan.druzyny.B}`, stan.kontrola === "B" ? "gold" : "", () => H.kontrola("B")), btn("Błąd ✕", "red", H.blad));
    const pa = btn(`Pula (${stan.pula || 0}) → ${stan.druzyny.A}`, "gold", () => H.przyznaj("A")), pb = btn(`Pula (${stan.pula || 0}) → ${stan.druzyny.B}`, "gold", () => H.przyznaj("B"));
    pa.disabled = pb.disabled = !!stan.przyznano;
    row(pa, pb, btn("Pokaż resztę odpowiedzi", "", H.reszta));
  }

  // Gra i drużyny
  box.append(el("h4", "", "Gra"));
  row(btn("Start gry", stan.faza === "lobby" ? "gold" : "", H.start), btn("Zakończ grę", "", H.koniec), btn("Nowa gra (zeruj wyniki)", "red", H.nowa));
  const nA = el("input"); nA.id = "fh-nA"; nA.value = stan.druzyny.A; nA.maxLength = 30;
  const nB = el("input"); nB.id = "fh-nB"; nB.value = stan.druzyny.B; nB.maxLength = 30;
  for (const [k, inp] of [["nA", nA], ["nB", nB]]) if (keep[k] && keep[k] === focused) { inp.value = keep[k].value; queueMicrotask(() => inp.focus()); }
  row(nA, nB, btn("Zapisz nazwy drużyn", "", H.nazwy));
  const gl = el("div", "fh-players");
  gracze.forEach(g => {
    const r = el("div", "fh-player");
    r.append(el("span", "", `${g.imie} (${stan.druzyny[g.druzyna] || g.druzyna})`), btn("⇄ drużyna", "", () => H.przenies(g)), btn("Usuń", "", () => H.usun(g)));
    gl.append(r);
  });
  if (gracze.length) box.append(el("h4", "", "Gracze"), gl);
}
