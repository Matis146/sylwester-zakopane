// Granat X – parodia Twittera w zakładce Złota Piłka. Posty są zmyślone (wpisane tutaj),
// a reakcje, komentarze i głosy w ankietach zapisują się w Firestore (anonimowe logowanie).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, connectFirestoreEmulator, collection, doc, onSnapshot, setDoc, deleteDoc, addDoc, getDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
const EMU = LOCAL && new URLSearchParams(location.search).has("emu");
const app = initializeApp({ apiKey: "AIzaSyCt3gklt5Vb5j-YmuBKUBb4oQqY7C1usnw", authDomain: "granat-zlota-pilka-7299.firebaseapp.com", projectId: "granat-zlota-pilka-7299" }, "granatx");
const auth = getAuth(app);
const db = getFirestore(app);
if (EMU) { connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true }); connectFirestoreEmulator(db, "127.0.0.1", 8085); }

const KONTA = {
  zp: { n: "Złota Piłka Szerominek", h: "ZlotaPilkaNews", a: "🏆", v: true },
  fab: { n: "Fabrizio Granatano", h: "FabrizioGranat", a: "🗞️", v: true },
  ins: { n: "Granat Insight", h: "GranatInsight", a: "📊", v: true },
  kib: { n: "Kibic Granatu", h: "KibicGranatu1", a: "🧣" },
  sport: { n: "Szerominek Sport", h: "SzerominekSport", a: "⚽", v: true },
  plonka: { n: "Płonka Płońsk FC (parodia)", h: "PlonkaPlonsk", a: "🌊" },
  tr: { n: "Transfery Granatu", h: "TransferyGranat", a: "🔁" },
};
// Wszystko zmyślone. Ankiety (opcje) zbierają prawdziwe głosy ekipy, „sondaz” to zmyślone liczby.
const POSTY = [
  { id: "p01", k: "zp", czas: "2 godz.", t: "🚨 OFICJALNIE: Gala Złotej Piłki wraca po 3 latach. 11 nominowanych, jedna statuetka, zero litości.\n\nGłosowanie trwa – wyniki poznamy tylko na gali. #ZłotaPiłka2026" },
  { id: "p02", k: "fab", czas: "3 godz.", t: "Ksawery Bandurski chce trzeciej Złotej Piłki. Dwukrotny zwycięzca, od dwóch lat kontuzjowany, pewność siebie bez zmian.\n\nTesty medyczne na kanapie zaliczone. HERE WE GO? 🔴⚪" },
  { id: "p03", k: "ins", czas: "4 godz.", t: "Nowy sondaż Granat Insight 👇", sondaz: { tytul: "Czy Ksawery wygrałby Złotą Piłkę, gdyby grał?", wyniki: [["Tak, bez dwóch zdań", 64], ["Nie pamiętam, kiedy grał", 31], ["Kto?", 5]], przypis: "Próba: 3 osoby i pies. Sondaż zmyślony – nie ma nic wspólnego z prawdziwym głosowaniem." } },
  { id: "p04", k: "kib", czas: "5 godz.", t: "Zakłady przyjęte, kto przyjdzie na galę ostatni? 👀", opcje: ["Oliwier (nagła choroba z kosmosu)", "Szymon (nie będzie mu się chciało)", "Jacek (przyjdzie prosto od dzieci)", "Gadom (wciąż czeka na debiut)"] },
  { id: "p05", k: "sport", czas: "6 godz.", t: "Statystyki nie kłamią: Marcel Nowicki – najwięcej minut w historii klubu. Przerwa na wodę? Nie słyszał. 🔋\n\nMaszyna, nie człowiek." },
  { id: "p06", k: "plonka", czas: "7 godz.", t: "Pozdrawiamy Granat Szerominek przed galą. Pamiętacie nasz mecz? My też. 😌" },
  { id: "p07", k: "ins", czas: "9 godz.", t: "Najczęstsze wymówki przed meczem Granatu (sondaż zmyślony, ale prawdziwy w duszy):", sondaz: { tytul: "Dlaczego nie przyjdziesz na mecz?", wyniki: [["Nagła choroba z kosmosu", 41], ["Po prostu nie chce mi się", 33], ["Mam ranked w LoL-u", 18], ["Gram z dziećmi", 8]], przypis: "Dane: Granat Insight. Metodologia: zgadywanie." } },
  { id: "p08", k: "tr", czas: "10 godz.", t: "PLOTKA 👀 Bartosz Gadomski coraz bliżej debiutu w Granacie. Źródło bliskie klubowi: „wcześniej czy później musi zagrać”.\n\nKlub potwierdza tylko, że zawodnik ma korki." },
  { id: "p09", k: "zp", czas: "12 godz.", t: "Jacek Malicki zapytany o przezwisko „Judasz”: „Nie zdradziłem Granatu, po prostu…”\n\nReszta wypowiedzi zagłuszona przez buczenie kibiców. 📢" },
  { id: "p10", k: "kib", czas: "14 godz.", t: "Pytanie do ekipy: czy GOAT i twórca klubu powinien sam sobie wręczyć statuetkę? 🐐", opcje: ["Tak, w końcu założył ten klub", "Nie, niech zasłuży jak każdy", "Niech wręczy Ignacy – najmłodszy"] },
  { id: "p11", k: "sport", czas: "16 godz.", t: "Nikodem Chyczewski znowu najlepszy w klubie w długich piłkach. Niektóre lądują w Płońsku. 🎯\n\nZero talentu, sama ciężka praca – i dlatego jest nominowany." },
  { id: "p12", k: "sport", czas: "1 dzień", t: "Forma Rafała Kila rośnie szybciej niż ceny w Żabce. 📈 Obrońcy rywali już się boją. Napastnicy rywali też." },
];
const EMOJI = ["🔥", "😂", "🐐", "💀", "👏"];
const IMIONA = { rafal: "Rafał", gadom: "Gadom" };

const $ = id => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const who = () => { try { return JSON.parse(sessionStorage.getItem("me") || "null")?.login || null; } catch (e) { return null; } };
const imie = l => IMIONA[l] || l.charAt(0).toUpperCase() + l.slice(1);
const kiedy = t => {
  const ms = t?.toMillis ? Date.now() - t.toMillis() : 0, m = Math.floor(ms / 60000);
  return m < 1 ? "teraz" : m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} godz.` : `${Math.floor(m / 1440)} d.`;
};

let uid = null, login = null, mod = false, started = false;
let reakcje = [], komentarze = [], glosy = [];
const otwarte = new Set();
let pokaz = 4;

function start() {
  if (started || !(login = who())) return;
  started = true;
  signInAnonymously(auth).catch(e => console.error(e));
  onAuthStateChanged(auth, async user => {
    if (!user || uid === user.uid) return;
    uid = user.uid;
    try { mod = (await getDoc(doc(db, "familiada_host", uid))).exists(); } catch (e) { mod = false; }
    onSnapshot(collection(db, "x_reakcje"), s => { reakcje = s.docs.map(d => d.data()); render(); });
    onSnapshot(collection(db, "x_komentarze"), s => { komentarze = s.docs.map(d => ({ id: d.id, ...d.data() })); render(); });
    onSnapshot(collection(db, "x_glosy"), s => { glosy = s.docs.map(d => ({ id: d.id, ...d.data() })); render(); });
  });
  render();
}
addEventListener("granat:login", start);
start();

// ---------- Akcje ----------
async function reaguj(post, e) {
  if (!uid) return;
  const ref = doc(db, "x_reakcje", `${post}_${uid}`);
  const moja = reakcje.find(r => r.post === post && r.uid === uid);
  try {
    if (moja?.e === e) await deleteDoc(ref);
    else await setDoc(ref, { post, uid, e, imie: imie(login) });
  } catch (err) { console.error(err); }
}
async function glosuj(post, o) {
  if (!uid) return;
  try { await setDoc(doc(db, "x_glosy", `${post}_${uid}`), { post, o }); } catch (err) { console.error(err); }
}
async function komentuj(post, input) {
  const tekst = input.value.trim().slice(0, 280);
  if (!tekst || !uid) return;
  input.disabled = true;
  try { await addDoc(collection(db, "x_komentarze"), { post, uid, imie: imie(login), tekst, t: serverTimestamp() }); input.value = ""; }
  catch (err) { console.error(err); alert("Nie udało się dodać komentarza. Spróbuj jeszcze raz."); }
  finally { input.disabled = false; input.focus(); }
}
const usun = id => deleteDoc(doc(db, "x_komentarze", id)).catch(e => console.error(e));

// ---------- Wyświetlanie ----------
function render() {
  const box = $("gx-feed");
  if (!box) return;
  // Zachowaj wpisywany komentarz i fokus przy odświeżaniu.
  const draft = {}; box.querySelectorAll("input[data-post]").forEach(i => { if (i.value) draft[i.dataset.post] = i.value; });
  const focus = document.activeElement?.dataset?.post;
  box.replaceChildren();

  POSTY.slice(0, pokaz).forEach(p => {
    const k = KONTA[p.k];
    const art = el("article", "gx-post");
    const av = el("div", "gx-av", k.a);
    const body = el("div", "gx-body");
    const head = el("div", "gx-head");
    const nm = el("b", "", k.n); if (k.v) nm.append(el("span", "gx-v", "✓"));
    head.append(nm, el("span", "gx-h", `@${k.h} · ${p.czas}`));
    body.append(head, el("p", "gx-text", p.t));

    if (p.sondaz) {
      const s = el("div", "gx-poll fake");
      s.append(el("p", "gx-poll-t", p.sondaz.tytul));
      p.sondaz.wyniki.forEach(([t, v]) => { const r = el("div", "gx-bar"); r.style.setProperty("--w", v + "%"); r.append(el("span", "", t), el("b", "", v + "%")); s.append(r); });
      s.append(el("p", "gx-note", p.sondaz.przypis));
      body.append(s);
    }
    if (p.opcje) {
      const g = glosy.filter(x => x.post === p.id), suma = g.length, moj = g.find(x => x.id === `${p.id}_${uid}`);
      const s = el("div", "gx-poll");
      p.opcje.forEach((t, i) => {
        const n = g.filter(x => x.o === i).length, pr = suma ? Math.round(100 * n / suma) : 0;
        const b = el("button", "gx-bar opt" + (moj?.o === i ? " me" : "")); b.type = "button";
        if (moj) b.style.setProperty("--w", pr + "%");
        b.append(el("span", "", t), el("b", "", moj ? pr + "%" : ""));
        b.addEventListener("click", () => glosuj(p.id, i));
        s.append(b);
      });
      s.append(el("p", "gx-note", moj ? `${suma} ${suma === 1 ? "głos" : suma < 5 ? "głosy" : "głosów"} · możesz zmienić zdanie` : "Kliknij, żeby zagłosować – wyniki zobaczysz po oddaniu głosu."));
      body.append(s);
    }

    // Reakcje
    const acts = el("div", "gx-acts");
    const moje = reakcje.find(r => r.post === p.id && r.uid === uid);
    EMOJI.forEach(e => {
      const n = reakcje.filter(r => r.post === p.id && r.e === e).length;
      const b = el("button", "gx-re" + (moje?.e === e ? " on" : "")); b.type = "button";
      b.append(document.createTextNode(e), el("span", "", n ? String(n) : ""));
      b.title = reakcje.filter(r => r.post === p.id && r.e === e).map(r => r.imie).join(", ");
      b.addEventListener("click", () => reaguj(p.id, e));
      acts.append(b);
    });
    const kom = komentarze.filter(c => c.post === p.id).sort((a, b) => (a.t?.toMillis?.() || Infinity) - (b.t?.toMillis?.() || Infinity));
    const kb = el("button", "gx-re gx-kom", `💬 ${kom.length || ""}`); kb.type = "button";
    kb.addEventListener("click", () => { otwarte.has(p.id) ? otwarte.delete(p.id) : otwarte.add(p.id); render(); });
    acts.append(kb);
    body.append(acts);

    // Komentarze
    if (otwarte.has(p.id)) {
      const list = el("div", "gx-comments");
      kom.forEach(c => {
        const row = el("div", "gx-c");
        const top = el("div", "gx-c-top"); top.append(el("b", "", c.imie), el("span", "", kiedy(c.t)));
        if (c.uid === uid || mod) { const d = el("button", "gx-del", "usuń"); d.type = "button"; d.addEventListener("click", () => usun(c.id)); top.append(d); }
        row.append(top, el("p", "", c.tekst));
        list.append(row);
      });
      if (!kom.length) list.append(el("p", "gx-note", "Brak komentarzy. Bądź pierwszy."));
      const form = el("form", "gx-form");
      const inp = el("input"); inp.maxLength = 280; inp.placeholder = "Napisz komentarz…"; inp.dataset.post = p.id; inp.value = draft[p.id] || "";
      const send = el("button", "", "Wyślij"); send.type = "submit";
      form.append(inp, send);
      form.addEventListener("submit", e => { e.preventDefault(); komentuj(p.id, inp); });
      list.append(form);
      body.append(list);
      if (focus === p.id) queueMicrotask(() => inp.focus());
    }

    art.append(av, body);
    box.append(art);
  });

  if (pokaz < POSTY.length) {
    const more = el("button", "gx-more", `Pokaż więcej wpisów (${POSTY.length - pokaz})`); more.type = "button";
    more.addEventListener("click", () => { pokaz = POSTY.length; render(); });
    box.append(more);
  }
}
