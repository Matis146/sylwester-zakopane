// Familiada Granatu: lobby, przyciski zgłoszeń, odpowiedzi wpisywane przez graczy i tablica na żywo.
// Firebase Auth (anonimowo) + Firestore. Prowadzący to konto anonimowe dopisane do „familiada_host”.
// Odpowiedzi z punktami leżą w „familiada_pytania”, którą czyta tylko prowadzący – dlatego
// sprawdzanie odpowiedzi (silnik gry) działa w przeglądarce prowadzącego, która musi być otwarta.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, connectFirestoreEmulator, doc, collection, query, orderBy, onSnapshot,
  getDoc, getDocs, setDoc, updateDoc, deleteDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
const EMU = LOCAL && new URLSearchParams(location.search).has("emu");
const app = initializeApp({ apiKey: "AIzaSyCt3gklt5Vb5j-YmuBKUBb4oQqY7C1usnw", authDomain: "granat-zlota-pilka-7299.firebaseapp.com", projectId: "granat-zlota-pilka-7299" }, "familiada");
const auth = getAuth(app);
const db = getFirestore(app);
if (EMU) { connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true }); connectFirestoreEmulator(db, "127.0.0.1", 8085); }

const GRA = doc(db, "familiada", "gra");
const GRACZE = collection(db, "familiada", "gra", "gracze");
const buzzDoc = (runda, proba) => doc(db, "familiada", "gra", "buzz", `${runda}-${proba}`);
const odpDoc = (runda, krok) => doc(db, "familiada", "gra", "odp", `${runda}-${krok}`);
// Etapy rundy, w których ktoś wpisuje odpowiedź.
const ODPOWIADANIE = ["pojedynek1", "pojedynek2", "gra", "kradziez"];
const NOWA_GRA = {
  faza: "lobby", druzyny: { A: "Granatowi", B: "Czerwoni" }, wynik: { A: 0, B: 0 },
  runda: 0, pytanieId: "", pytanie: "", sloty: 0, odkryte: {}, mnoznik: 1, pula: 0, przyznano: "",
  etap: "", proba: 0, krok: 0, kto: "", ktoUid: "", ktoImie: "", czas: 20,
  kontrola: "", bledy: 0, p1: null, ostatnia: null, uzyte: [], blysk: { typ: "", n: 0 },
};
const IMIONA = { rafal: "Rafał", gadom: "Gadom" };

const $ = id => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const btn = (text, cls, fn) => { const b = el("button", "fb " + (cls || ""), text); b.type = "button"; b.addEventListener("click", fn); return b; };
const who = () => { try { return JSON.parse(sessionStorage.getItem("me") || "null")?.login || null; } catch (e) { return null; } };
const imie = l => IMIONA[l] || l.charAt(0).toUpperCase() + l.slice(1);
const inna = d => (d === "A" ? "B" : "A");
const fail = e => { console.error(e); status("Coś poszło nie tak: " + (e.code || e.message) + ". Odśwież stronę.", true); };
const status = (t, err) => { const s = $("fam-status"); s.textContent = t || ""; s.hidden = !t; s.classList.toggle("err", !!err); };

let uid = null, login = null, host = false, stan = null, gracze = [], buzz = null, bank = [];
let started = false, lastBlysk = null, lastOdkryte = null, turnKey = "", turnStart = 0;

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
const sndTick = () => tone([1500], 0.05, "square", 0.05);
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
    onSnapshot(GRA, s => { stan = s.exists() ? s.data() : null; status(""); onState(); }, fail);
    onSnapshot(GRACZE, s => { gracze = s.docs.map(d => ({ uid: d.id, ...d.data() })); render(); }, fail);
  });
}
addEventListener("hashchange", maybeStart);
addEventListener("granat:login", maybeStart);
maybeStart();
$("fam-form").addEventListener("submit", e => { e.preventDefault(); wyslij(); });
setInterval(tickTimer, 250);

// Nasłuch zgłoszeń (przycisk) i odpowiedzi dla bieżącej rundy/kroku.
let buzzKey = "", unsubBuzz = null, odpKey = "", unsubOdp = null;
function onState() {
  if (stan) {
    const bk = `${stan.runda}-${stan.proba || 0}`;
    if (bk !== buzzKey) {
      buzzKey = bk; if (unsubBuzz) unsubBuzz(); buzz = null;
      let first = true;
      unsubBuzz = onSnapshot(buzzDoc(stan.runda, stan.proba || 0), s => {
        const prev = buzz; buzz = s.exists() ? s.data() : null;
        if (buzz && !first && !prev) sndBuzz();
        first = false;
        if (host) engineBuzz();
        render();
      }, fail);
    }
    const tk = `${stan.runda}-${stan.krok || 0}-${stan.etap}`;
    if (tk !== turnKey) { turnKey = tk; turnStart = Date.now(); $("fam-input").value = ""; $("fam-form-msg").textContent = ""; }
    if (host) {
      const ok = `${stan.runda}-${stan.krok || 0}`;
      if (ok !== odpKey) {
        odpKey = ok; if (unsubOdp) unsubOdp();
        unsubOdp = onSnapshot(odpDoc(stan.runda, stan.krok || 0), s => { if (s.exists()) engineAnswer(s.data(), ok); }, fail);
      }
    }
  }
  render(); effects();
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
    const x = $("fam-bigx"); x.hidden = false; x.textContent = "✕".repeat(Math.max(1, Math.min(3, b.ile || 1)));
    clearTimeout(effects.t); effects.t = setTimeout(() => x.hidden = true, 1300);
  }
  lastBlysk = b.n || 0;
}

// ---------- Akcje gracza ----------
const ja = () => gracze.find(g => g.uid === uid);
const mogeOdpowiadac = () => {
  const g = ja();
  return !!(stan && g && !stan.decyzja && ODPOWIADANIE.includes(stan.etap) && g.druzyna === stan.kto && (!stan.ktoUid || stan.ktoUid === uid) && pozostalo() > 0);
};
const pozostalo = () => (stan ? Math.max(0, (stan.czas || 20) - (Date.now() - turnStart) / 1000) : 0);
async function dolacz(d) {
  unlockAudio();
  try { await setDoc(doc(GRACZE, uid), { imie: imie(login), druzyna: d }); } catch (e) { fail(e); }
}
async function zglos() {
  unlockAudio();
  const g = ja();
  if (!g || stan?.etap !== "buzz" || buzz) return;
  try { await setDoc(buzzDoc(stan.runda, stan.proba || 0), { uid, imie: g.imie, druzyna: g.druzyna, t: serverTimestamp() }); }
  catch (e) { /* ktoś był szybszy – reguły nie pozwalają nadpisać */ }
}
async function wyslij() {
  unlockAudio();
  const tekst = $("fam-input").value.trim().slice(0, 60);
  const msg = $("fam-form-msg");
  if (!tekst || !mogeOdpowiadac()) return;
  const g = ja();
  $("fam-send").disabled = true;
  try {
    await setDoc(odpDoc(stan.runda, stan.krok || 0), { uid, imie: g.imie, druzyna: g.druzyna, tekst, t: serverTimestamp() });
    msg.textContent = "Wysłane – sprawdzamy…";
  } catch (e) { msg.textContent = "Ktoś z drużyny odpowiedział szybciej."; }
  finally { $("fam-send").disabled = false; }
}

// ---------- Sprawdzanie odpowiedzi ----------
const norm = s => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
// Indeks trafionej, jeszcze nieodkrytej odpowiedzi albo -1.
function dopasuj(tekst) {
  const q = pyt(), t = norm(tekst || "");
  if (!q || t.length < 2) return -1;
  for (const [i, a] of q.odpowiedzi.entries()) {
    if (stan.odkryte?.[i]) continue;
    const warianty = [...a.t.split("/"), ...(a.alias || [])].map(norm).filter(Boolean);
    for (const w of warianty) {
      if (t === w) return i;
      if (Math.min(t.length, w.length) >= 4 && (t.includes(w) || w.includes(t))) return i;
      const tol = w.length >= 8 ? 2 : w.length >= 5 ? 1 : 0;
      if (tol && lev(t, w) <= tol) return i;
    }
  }
  return -1;
}

// ---------- Silnik gry (tylko w przeglądarce prowadzącego) ----------
const upd = data => updateDoc(GRA, data).catch(fail);
const pyt = () => bank.find(q => q.id === stan?.pytanieId);
let handled = "";

function engineBuzz() {
  if (!stan || stan.etap !== "buzz" || !buzz) return;
  upd({ etap: "pojedynek1", kto: buzz.druzyna, ktoUid: buzz.uid, ktoImie: buzz.imie, krok: (stan.krok || 0) + 1, ostatnia: null });
}

function engineAnswer(ans, key) {
  if (!stan || handled === key || key !== `${stan.runda}-${stan.krok || 0}` || !ODPOWIADANIE.includes(stan.etap)) return;
  handled = key;
  const idx = ans ? dopasuj(ans.tekst) : -1;
  if (ans && (idx < 0 || stan.recznie)) { upd({ decyzja: { imie: ans.imie, druzyna: ans.druzyna, tekst: ans.tekst, sugestia: idx } }); return; }
  rozstrzygnij(idx, ans);
}

// Upływ czasu = zła odpowiedź (prowadzący liczy z małym zapasem na opóźnienia).
setInterval(() => {
  if (!host || !stan || stan.decyzja || !ODPOWIADANIE.includes(stan.etap)) return;
  const key = `${stan.runda}-${stan.krok || 0}`;
  if (handled !== key && (Date.now() - turnStart) / 1000 > (stan.czas || 20) + 1.5) { handled = key; rozstrzygnij(-1, null); }
}, 400);

// Główna logika rundy: idx = trafiona odpowiedź (-1 = pudło albo koniec czasu).
function rozstrzygnij(idx, ans, opts = {}) {
  const q = pyt(); if (!q) return;
  const s = stan, d = {}, m = s.mnoznik || 1;
  const kto = s.kto, imieOdp = ans?.imie || s.ktoImie || s.druzyny?.[kto] || "";
  let pula = s.pula || 0, odkryte = { ...(s.odkryte || {}) };
  if (idx >= 0) { const a = q.odpowiedzi[idx]; odkryte[idx] = { t: a.t, p: a.p }; d["odkryte." + idx] = { t: a.t, p: a.p }; pula += a.p * m; d.pula = pula; }
  d.ostatnia = { imie: imieOdp, druzyna: kto, tekst: ans ? ans.tekst : opts.reczne ? "(decyzja prowadzącego)" : "(czas minął)", ok: idx >= 0, idx };
  d.decyzja = null;
  d.krok = (s.krok || 0) + 1;
  const wszystkie = Object.keys(odkryte).length >= q.odpowiedzi.length;
  const przyznaj = team => { d["wynik." + team] = (s.wynik?.[team] || 0) + pula; d.przyznano = team; d.etap = "po"; d.kto = ""; d.ktoUid = ""; };
  const krzyzyk = ile => { d.blysk = { typ: "x", n: Date.now(), ile }; };

  if (s.etap === "pojedynek1") {
    if (idx === 0 || (idx >= 0 && wszystkie)) { d.kontrola = kto; d.etap = "gra"; d.kto = kto; d.ktoUid = ""; d.ktoImie = ""; d.bledy = 0; if (wszystkie) przyznaj(kto); }
    else { if (idx < 0) krzyzyk(1); d.p1 = { druzyna: kto, idx }; d.etap = "pojedynek2"; d.kto = inna(kto); d.ktoUid = ""; d.ktoImie = ""; }
  } else if (s.etap === "pojedynek2") {
    const p1 = s.p1 || { idx: -1, druzyna: inna(kto) };
    if (idx < 0) krzyzyk(1);
    let wygrany = null;
    if (idx >= 0 && (p1.idx < 0 || idx < p1.idx)) wygrany = kto;
    else if (p1.idx >= 0) wygrany = p1.druzyna;
    if (wygrany) { d.kontrola = wygrany; d.etap = "gra"; d.kto = wygrany; d.ktoUid = ""; d.ktoImie = ""; d.bledy = 0; if (wszystkie) przyznaj(wygrany); }
    else { d.etap = "buzz"; d.proba = (s.proba || 0) + 1; d.kto = ""; d.ktoUid = ""; d.ktoImie = ""; d.p1 = null; } // oba pudła – nowe zgłoszenia
  } else if (s.etap === "gra") {
    if (idx >= 0) { if (wszystkie) przyznaj(s.kontrola); }
    else {
      const b = Math.min(3, (s.bledy || 0) + 1);
      d.bledy = b; krzyzyk(b);
      if (b >= 3) { d.etap = "kradziez"; d.kto = inna(s.kontrola); d.ktoUid = ""; d.ktoImie = ""; }
    }
  } else if (s.etap === "kradziez") {
    if (idx < 0) krzyzyk(1);
    przyznaj(idx >= 0 ? kto : s.kontrola);
  }
  const etap = d.etap ?? s.etap;
  if (ODPOWIADANIE.includes(etap)) nastepny(d.kto ?? s.kto, d);
  upd(d);
}
// Wskazuje kolejną osobę z drużyny, która odpowiada w tym kroku.
function nastepny(team, d) {
  const ludzie = gracze.filter(g => g.druzyna === team).sort((a, b) => a.imie.localeCompare(b.imie, "pl") || a.uid.localeCompare(b.uid));
  if (!ludzie.length) { d.ktoUid = ""; d.ktoImie = ""; return d; }
  const n = stan.kol?.[team] || 0;
  const g = ludzie[n % ludzie.length];
  d["kol." + team] = n + 1; d.ktoUid = g.uid; d.ktoImie = g.imie;
  return d;
}
// Po rozstrzygnięciu rundy odkrywamy resztę odpowiedzi (już bez punktów).
function reszta(q, odkryte) {
  const d = {};
  q.odpowiedzi.forEach((a, i) => { if (!odkryte[i]) d["odkryte." + i] = { t: a.t, p: a.p }; });
  return d;
}

const H = {
  nowa: () => confirm("Zacząć nową grę? Wyniki zostaną wyzerowane (gracze zostają).") && setDoc(GRA, { ...NOWA_GRA, druzyny: stan?.druzyny || NOWA_GRA.druzyny, czas: stan?.czas || 20 }).catch(fail),
  start: () => upd({ faza: "gra" }),
  koniec: () => confirm("Zakończyć grę i pokazać zwycięzcę?") && upd({ faza: "koniec", etap: "", kto: "" }),
  pytanie: (id, m) => {
    const q = bank.find(x => x.id === id);
    if (!q) return;
    upd({ faza: "gra", runda: (stan.runda || 0) + 1, pytanieId: q.id, pytanie: q.pytanie, sloty: q.odpowiedzi.length, odkryte: {},
      mnoznik: m, pula: 0, przyznano: "", etap: "buzz", proba: 0, kto: "", ktoUid: "", ktoImie: "", kontrola: "", bledy: 0, p1: null, ostatnia: null,
      uzyte: [...new Set([...(stan.uzyte || []), q.id])] });
  },
  // Ręczne poprawki: uznanie odpowiedzi albo pudła w bieżącym kroku (gdy automat się pomylił).
  uznaj: i => { if (ODPOWIADANIE.includes(stan.etap)) { handled = `${stan.runda}-${stan.krok || 0}`; rozstrzygnij(i, stan.decyzja, { reczne: true }); } else odkryjRecznie(i); },
  pudlo: () => { if (ODPOWIADANIE.includes(stan.etap)) { handled = `${stan.runda}-${stan.krok || 0}`; rozstrzygnij(-1, stan.decyzja, { reczne: true }); } },
  recznie: on => upd({ recznie: on }),
  cofnijBlad: () => {
    const b = Math.max(0, (stan.bledy || 0) - 1);
    upd(stan.etap === "kradziez" ? nastepny(stan.kontrola, { bledy: b, etap: "gra", kto: stan.kontrola, krok: (stan.krok || 0) + 1 }) : { bledy: b });
  },
  // Pomija osobę, która nie odpowiada (bez błędu) – ruch ma następna z drużyny.
  pomin: () => { if (ODPOWIADANIE.includes(stan.etap) && stan.etap !== "pojedynek1") { handled = `${stan.runda}-${stan.krok || 0}`; upd(nastepny(stan.kto, { krok: (stan.krok || 0) + 1 })); } },
  przyznaj: d => { if (!stan.przyznano) upd({ ["wynik." + d]: (stan.wynik?.[d] || 0) + (stan.pula || 0), przyznano: d, etap: "po", kto: "" }); },
  // Odsłanianie pozostałych odpowiedzi po rundzie: od najniżej punktowanej, jak w TV (bez punktów).
  nastepna: () => { const q = pyt(); if (!q) return; const i = q.odpowiedzi.map((_, k) => k).reverse().find(k => !stan.odkryte?.[k]); if (i !== undefined) odkryjRecznie(i); },
  wszystkie: () => { const q = pyt(); if (q) upd(reszta(q, stan.odkryte || {})); },
  ponowBuzz: () => upd({ etap: "buzz", proba: (stan.proba || 0) + 1, kto: "", ktoUid: "", ktoImie: "", p1: null }),
  czas: s => upd({ czas: s }),
  nazwy: () => upd({ druzyny: { A: $("fh-nA").value.trim().slice(0, 30) || "Drużyna A", B: $("fh-nB").value.trim().slice(0, 30) || "Drużyna B" } }),
  przenies: g => updateDoc(doc(GRACZE, g.uid), { druzyna: inna(g.druzyna) }).catch(fail),
  usun: g => confirm(`Usunąć ${g.imie} z gry?`) && deleteDoc(doc(GRACZE, g.uid)).catch(fail),
  utworz: () => setDoc(GRA, NOWA_GRA).catch(fail),
};
function odkryjRecznie(i) {
  const a = pyt()?.odpowiedzi[i];
  if (!a || stan.odkryte?.[i]) return;
  const d = { ["odkryte." + i]: { t: a.t, p: a.p } };
  if (!stan.przyznano) d.pula = (stan.pula || 0) + a.p * (stan.mnoznik || 1);
  upd(d);
}

// ---------- Licznik czasu ----------
function tickTimer() {
  const box = $("fam-timer"), form = $("fam-form");
  const active = stan && stan.faza === "gra" && !stan.decyzja && ODPOWIADANIE.includes(stan.etap);
  box.hidden = !active;
  const moge = mogeOdpowiadac();
  if (form.hidden === moge) { form.hidden = !moge; if (moge) { $("fam-form-msg").textContent = ""; $("fam-input").focus({ preventScroll: true }); } }
  if (!active) return;
  const left = pozostalo(), total = stan.czas || 20;
  box.querySelector("b").textContent = Math.ceil(left);
  box.querySelector("i").style.width = (100 * left / total) + "%";
  box.classList.toggle("low", left <= 5);
  const sec = Math.ceil(left);
  if (moge && sec <= 5 && sec > 0 && sec !== tickTimer.last) sndTick();
  tickTimer.last = sec;
}

// ---------- Wyświetlanie ----------
function render() {
  const root = $("fam-app"), lob = $("fam-lobby");
  if (!root || !uid) return;
  const me = ja();
  const nazwa = d => stan?.druzyny?.[d] || d;
  root.replaceChildren(); lob.replaceChildren();

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
    board.append(strikes);
    if (stan.przyznano) board.append(el("p", "fam-award", `Pula dla: ${nazwa(stan.przyznano)}`));
    root.append(board);

    // Kto teraz odpowiada / co się dzieje
    const info = el("div", "fam-turn" + (stan.kto ? " t" + stan.kto : ""));
    const kto = stan.kto ? nazwa(stan.kto) : "";
    const tekst = {
      buzz: ["Kto pierwszy?", "Naciśnij przycisk, żeby odpowiadać."],
      pojedynek1: ["Pojedynek", `Odpowiada ${stan.ktoImie} (${kto}) – trzeba trafić najwyżej punktowaną odpowiedź.`],
      pojedynek2: ["Szansa dla rywali", `Odpowiada ${stan.ktoImie || kto} (${kto}) – trzeba trafić wyżej punktowaną odpowiedź, żeby przejąć pytanie.`],
      gra: [`Gra drużyna ${kto}`, `Teraz odpowiada ${stan.ktoImie || kto} · błędy: ${stan.bledy || 0}/3`],
      kradziez: ["Kradzież!", `${kto} ma jedną szansę na całą pulę (${stan.pula || 0} pkt) – odpowiada ${stan.ktoImie || kto}.`],
      po: ["Koniec rundy", Object.keys(stan.odkryte || {}).length < stan.sloty ? `Pula trafiła do: ${nazwa(stan.przyznano)}. Prowadzący odsłania pozostałe odpowiedzi…` : `Pula trafiła do: ${nazwa(stan.przyznano)}. Czekamy na kolejne pytanie.`],
    }[stan.etap];
    if (tekst) { info.append(el("small", "", tekst[0]), el("span", "", tekst[1])); root.append(info); }

    if (stan.decyzja) {
      const w = el("div", "fam-last wait");
      w.append(el("span", "", `${stan.decyzja.imie}:`), el("b", "", `„${stan.decyzja.tekst}”`), el("i", "", "…"));
      root.append(w, el("p", "fam-note", "Prowadzący decyduje, czy uznać tę odpowiedź…"));
    } else if (stan.ostatnia) {
      const o = stan.ostatnia;
      const last = el("div", "fam-last " + (o.ok ? "ok" : "bad"));
      last.append(el("span", "", `${o.imie}:`), el("b", "", `„${o.tekst}”`), el("i", "", o.ok ? "✓" : "✕"));
      root.append(last);
    }

    if (stan.etap === "buzz" && me) {
      if (buzz) { const w = el("div", `fam-first t${buzz.druzyna}`); w.append(el("small", "", "Pierwszy zgłosił się"), el("b", "", buzz.imie), el("span", "", nazwa(buzz.druzyna))); root.append(w); }
      else root.append(btn("Zgłaszam się!", "fam-buzz", zglos));
    }
  }

  // Lobby: drużyny i gracze
  for (const d of ["A", "B"]) {
    const col = el("div", `fam-col t${d}`);
    col.append(el("h4", "", nazwa(d)));
    const ul = el("ul");
    gracze.filter(g => g.druzyna === d).sort((a, b) => a.imie.localeCompare(b.imie, "pl") || a.uid.localeCompare(b.uid))
      .forEach(g => ul.append(el("li", [g.uid === uid ? "me" : "", g.uid === stan.ktoUid && ODPOWIADANIE.includes(stan.etap) ? "now" : ""].join(" ").trim(), g.imie)));
    if (!ul.children.length) ul.append(el("li", "empty", "nikogo"));
    col.append(ul);
    if (!me && stan.faza !== "koniec") col.append(btn("Dołącz", "gold", () => dolacz(d)));
    else if (me && me.druzyna !== d && stan.faza === "lobby") col.append(btn("Przejdź tutaj", "", () => dolacz(d)));
    lob.append(col);
  }
  if (!me) lob.append(el("p", "fam-note", "Wybierz drużynę, żeby grać."));
  tickTimer();
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
  box.append(el("p", "fam-note", "Nie zamykaj tej strony w trakcie gry – to ona sprawdza odpowiedzi graczy."));
  const row = (...kids) => { const r = el("div", "fh-row"); r.append(...kids); box.append(r); return r; };
  const qd = pyt();
  if (stan.decyzja && qd) {
    const dz = el("div", "fh-decide");
    dz.append(el("p", "kicker", "Twoja decyzja"), el("p", "", `${stan.decyzja.imie} (${stan.druzyny[stan.decyzja.druzyna] || ""}) wpisał(a):`), el("b", "fh-said", `„${stan.decyzja.tekst}”`));
    if (stan.decyzja.sugestia >= 0) dz.append(el("p", "fam-note", `Automat proponuje: ${qd.odpowiedzi[stan.decyzja.sugestia].t}`));
    const opts = el("div", "fh-answers");
    qd.odpowiedzi.forEach((a, i) => { if (!stan.odkryte?.[i]) opts.append(btn(`Uznaj jako: ${a.t} · ${a.p}`, i === stan.decyzja.sugestia ? "gold" : "", () => H.uznaj(i))); });
    dz.append(opts, btn("Nie uznaję – pudło ✕", "red", H.pudlo));
    box.append(dz);
  }

  // Pytanie
  const sel = el("select"); sel.id = "fh-q";
  bank.forEach(q => sel.append(new Option(`${q.nr}. ${q.pytanie}${(stan.uzyte || []).includes(q.id) ? " ✓" : ""}`, q.id)));
  const next = bank.find(q => !(stan.uzyte || []).includes(q.id)); if (next) sel.value = next.id;
  if (keep.q && bank.some(q => q.id === keep.q) && !(stan.uzyte || []).includes(keep.q)) sel.value = keep.q;
  const mult = el("select"); mult.id = "fh-m"; [1, 2, 3].forEach(m => mult.append(new Option("×" + m, m)));
  if (keep.m) mult.value = keep.m;
  box.append(el("h4", "", "Pytanie"));
  row(sel, mult, btn("Pokaż pytanie", "gold", () => H.pytanie(sel.value, +mult.value)));
  if (!bank.length) box.append(el("p", "fam-note", "Brak pytań w bazie – poproś Claude'a o wgranie."));

  // Odpowiedzi i poprawki
  const q = pyt();
  if (q && stan.pytanie) {
    const odp = ODPOWIADANIE.includes(stan.etap);
    const zostalo = q.odpowiedzi.length - Object.keys(stan.odkryte || {}).length;
    if (stan.etap === "po" && zostalo > 0) {
      const od = el("div", "fh-decide");
      od.append(el("p", "kicker", `Odsłoń pozostałe odpowiedzi (${zostalo})`), el("p", "fam-note", "Klikaj powoli – każda odwraca się na tablicy u wszystkich. Punkty już nie wchodzą."));
      const r = el("div", "fh-row"); r.append(btn("Odsłoń następną", "gold", H.nastepna), btn("Odsłoń wszystkie naraz", "", H.wszystkie));
      od.append(r); box.append(od);
    }
    box.append(el("h4", "", odp ? "Odpowiedzi – kliknij, żeby uznać bieżącą odpowiedź" : stan.etap === "po" ? "Odpowiedzi – kliknij, żeby odsłonić wybraną" : "Odpowiedzi"));
    const list = el("div", "fh-answers");
    q.odpowiedzi.forEach((a, i) => {
      const b = btn(`${i + 1}. ${a.t} · ${a.p}`, stan.odkryte?.[i] ? "done" : "", () => H.uznaj(i));
      b.disabled = !!stan.odkryte?.[i];
      list.append(b);
    });
    box.append(list);
    box.append(el("h4", "", "Poprawki"));
    const pz = btn("Uznaj jako pudło ✕", "red", H.pudlo); pz.disabled = !odp;
    const cb = btn("Cofnij błąd", "", H.cofnijBlad); cb.disabled = !(stan.bledy > 0);
    const pm = btn("Pomiń osobę (bez błędu)", "", H.pomin); pm.disabled = !odp || stan.etap === "pojedynek1";
    row(pz, cb, pm, btn("Ponów zgłoszenia", "", H.ponowBuzz));
    const pa = btn(`Pula → ${stan.druzyny.A}`, "", () => H.przyznaj("A")), pb = btn(`Pula → ${stan.druzyny.B}`, "", () => H.przyznaj("B"));
    pa.disabled = pb.disabled = !!stan.przyznano;
    row(pa, pb);
  }

  // Gra i drużyny
  box.append(el("h4", "", "Gra"));
  const czas = el("select"); [10, 15, 20, 30, 45].forEach(s => czas.append(new Option(`${s} s na odpowiedź`, s))); czas.value = stan.czas || 20;
  czas.addEventListener("change", () => H.czas(+czas.value));
  row(btn("Start gry", stan.faza === "lobby" ? "gold" : "", H.start), btn("Zakończ grę", "", H.koniec), btn("Nowa gra (zeruj wyniki)", "red", H.nowa));
  const rc = el("label", "fh-check"); const cbx = el("input"); cbx.type = "checkbox"; cbx.checked = !!stan.recznie;
  cbx.addEventListener("change", () => H.recznie(cbx.checked)); rc.append(cbx, document.createTextNode(" Każda odpowiedź do mojej decyzji"));
  row(czas, rc);
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
