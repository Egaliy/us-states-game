import "./styles.css";
import { STATES, REGIONS, NOT_STATES } from "./states.js";
import { SHAPES } from "./map-data.js";

/* ─────────────────────────────────────────────
   Константы и утилиты
   ───────────────────────────────────────────── */

const STATE_KEY = "us-states-state-v1";
const RECORD_KEY = "us-states-records-v1";
const TOTAL = STATES.length;
const MAX_TRIES = 3;
const MODES = [
  { id: "type", label: "Вписать штаты", caption: "названо штатов" },
  { id: "map", label: "Найти на карте", caption: "найдено на карте" },
];

/* Мелкие штаты Северо-Востока: кликабельные плашки в океане. [fips, y плашки, x и y точки на штате] */
const CALLOUTS = [
  ["25", 156, 912, 171],
  ["44", 182, 905, 185],
  ["09", 208, 887, 192],
  ["34", 234, 867, 234],
  ["10", 260, 856, 259],
  ["24", 286, 846, 281],
];
const CALLOUT_X = 936;
const CALLOUT_W = 36;
const CALLOUT_H = 20;

const normalize = (s) =>
  String(s)
    .toLowerCase()
    .replaceAll("э", "е")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zа-я0-9]/g, "")
    .replace(/(.)\1+/g, "$1");

const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const fmtTime = (s) => {
  const v = Math.max(0, s | 0);
  return `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`;
};

const plural = (n, [one, few, many]) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};
const STATE_FORMS = ["штат", "штата", "штатов"];

const loadJSON = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
};
const saveJSON = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* приватный режим — играем без сохранения */
  }
};

const byFips = new Map(STATES.map((s) => [s.fips, s]));
const collator = new Intl.Collator("ru");

/* Индекс названий: нормализованный ключ → штат */
const nameIndex = new Map();
STATES.forEach((s) => {
  [s.ru, s.en, ...(s.aliases || [])].forEach((w) => {
    const k = normalize(w);
    const prev = nameIndex.get(k);
    if (prev && prev !== s) throw new Error(`Коллизия ключа «${k}»: ${prev.ru} и ${s.ru}`);
    nameIndex.set(k, s);
  });
});
const notStateIndex = new Map();
NOT_STATES.forEach((n) => n.words.forEach((w) => notStateIndex.set(normalize(w), n)));

/* ─────────────────────────────────────────────
   Состояние
   ───────────────────────────────────────────── */

const freshType = () => ({ guessed: [], elapsed: 0, started: false, done: false, gaveUp: false });
const freshMap = () => ({
  queue: shuffle(STATES.map((s) => s.fips)),
  qi: 0,
  tries: 0,
  wrong: 0,
  results: {},
  elapsed: 0,
  started: false,
  done: false,
});

function loadState() {
  const s = loadJSON(STATE_KEY);
  const valid =
    s &&
    MODES.some((m) => m.id === s.mode) &&
    s.type &&
    Array.isArray(s.type.guessed) &&
    s.map &&
    Array.isArray(s.map.queue) &&
    s.map.queue.length === TOTAL &&
    s.map.queue.every((f) => byFips.has(f));
  return valid ? s : { mode: "type", type: freshType(), map: freshMap() };
}

let S = loadState();
let records = loadJSON(RECORD_KEY) || {};
let busy = false; // пауза после провала в режиме карты
let lastHit = null; // последний верно найденный штат — показываем в подсказке вместо тоста
let lastRecordBroken = false;

const save = () => saveJSON(STATE_KEY, S);
const game = () => S[S.mode];
const typeScore = () => S.type.guessed.length;
const mapCounts = () => {
  const r = Object.values(S.map.results);
  return {
    ok: r.filter((x) => x === "ok").length,
    late: r.filter((x) => x === "late").length,
    fail: r.filter((x) => x === "fail").length,
  };
};

/* ─────────────────────────────────────────────
   Разметка
   ───────────────────────────────────────────── */

const allBounds = Object.values(SHAPES).map((s) => s.b);
const VB = {
  x: Math.floor(Math.min(...allBounds.map((b) => b[0]))) - 6,
  y: Math.floor(Math.min(...allBounds.map((b) => b[1]))) - 6,
};
VB.w = CALLOUT_X + CALLOUT_W + 8 - VB.x;
VB.h = Math.ceil(Math.max(...allBounds.map((b) => b[3]))) + 6 - VB.y;

const silhouette = (fips) => {
  const [x0, y0, x1, y1] = SHAPES[fips].b;
  const pad = 1.5;
  return `<svg viewBox="${x0 - pad} ${y0 - pad} ${x1 - x0 + pad * 2} ${y1 - y0 + pad * 2}" aria-hidden="true"><use href="#s-${fips}"/></svg>`;
};

const mapSVG = () => `
  <svg class="map" id="map" viewBox="${VB.x} ${VB.y} ${VB.w} ${VB.h}" role="img" aria-label="Карта США">
    <defs>
      ${Object.entries(SHAPES)
        .map(([fips, s]) => `<path id="s-${fips}" d="${s.d}"/>`)
        .join("")}
    </defs>
    <g>
      ${STATES.map((s) => `<use href="#s-${s.fips}" class="st" data-fips="${s.fips}"/>`).join("")}
      <use href="#s-11" class="st st--dc"/>
    </g>
    <g>
      ${CALLOUTS.map(
        ([fips, y, ax, ay]) => `
        <path class="callout-line" d="M${CALLOUT_X} ${y + CALLOUT_H / 2} L${ax} ${ay}"/>
        <rect class="callout" data-fips="${fips}" x="${CALLOUT_X}" y="${y}" width="${CALLOUT_W}" height="${CALLOUT_H}" rx="6"/>`,
      ).join("")}
    </g>
  </svg>`;

const rowHTML = (s) => `
  <div class="c" data-fips="${s.fips}">
    <span class="c__slot">
      <span class="c__flag">${silhouette(s.fips)}</span>
      <span class="c__hint">${s.ru[0]}</span>
    </span>
    <span class="c__body">
      <span class="c__mask" style="width:${Math.min(170, Math.max(28, s.ru.length * 8.2))}px"></span>
      <span class="c__name${s.ru.length > 16 ? " c__name--long" : ""}">${s.ru}</span>
    </span>
  </div>`;

const root = document.querySelector("#app");
root.innerHTML = `
  <main class="app">
    <header class="topbar">
      <div class="brand"><span class="brand__mark">🗽</span><span>Штаты США</span></div>
    </header>

    <section class="hero" aria-live="polite">
      <div class="score">
        <div class="score__line">
          <span class="score__count" id="count">0</span>
          <span class="score__total">/ ${TOTAL}</span>
        </div>
        <p class="score__caption" id="caption"></p>
      </div>
      <div class="stats" id="stats"></div>
      <div class="progress"><div class="progress__bar" id="bar"></div></div>
      <div class="controls">
        <nav class="segmented" id="segmented" role="tablist" aria-label="Режим">
          <span class="segmented__thumb" id="thumb"></span>
          ${MODES.map(
            (m) =>
              `<button class="segmented__item" role="tab" type="button" data-mode="${m.id}" aria-selected="false">${m.label}</button>`,
          ).join("")}
        </nav>
        <button class="btn btn--quiet" id="reset" type="button"><span class="lg-only">Начать заново</span><span class="sm-only">Заново</span></button>
      </div>
    </section>

    <section class="entry" id="entry">
      <div class="field">
        <input class="field__input" id="answer" type="text" placeholder="Введите штат" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="go" />
        <button class="field__clear" id="clear" type="button" aria-label="Очистить">
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 3l6 6M9 3l-6 6"/></svg>
        </button>
      </div>
      <div class="entry__actions">
        <button class="btn btn--danger" id="giveup" type="button">Сдаться</button>
      </div>
    </section>

    <section class="prompt" id="prompt">
      <div class="prompt__main">
        <span class="prompt__label" id="prompt-label">Найдите на карте</span>
        <span class="prompt__name" id="target"></span>
      </div>
      <div class="prompt__side">
        <span class="tries" id="tries" aria-label="Попытки"></span>
        <span class="pill" id="qcount"></span>
        <button class="btn" id="skip" type="button">Пропустить</button>
      </div>
    </section>

    <section class="result-card" id="result" hidden></section>

    <section class="map-card" id="map-card">
      ${mapSVG()}
      <div class="tip" id="tip"></div>
      <div class="legend" id="legend"></div>
    </section>

    <section class="regions" id="regions">
      ${REGIONS.map((r) => {
        const list = STATES.filter((s) => s.region === r.id).sort((a, b) => collator.compare(a.ru, b.ru));
        return `
        <article class="region" data-region="${r.id}">
          <div class="region__head">
            <h2 class="region__title">${r.name}</h2>
            <div class="region__meter"><i></i></div>
            <span class="region__count tnum">0 / ${list.length}</span>
          </div>
          <div class="region__grid">${list.map(rowHTML).join("")}</div>
        </article>`;
      }).join("")}
    </section>
  </main>

  <div class="toast" id="toast" role="status" aria-live="polite">
    <span class="toast__icon"></span>
    <span class="toast__name"></span>
  </div>
`;

const $ = (sel) => root.querySelector(sel);
const ui = {
  count: $("#count"),
  caption: $("#caption"),
  stats: $("#stats"),
  bar: $("#bar"),
  segmented: $("#segmented"),
  thumb: $("#thumb"),
  reset: $("#reset"),
  entry: $("#entry"),
  input: $("#answer"),
  clear: $("#clear"),
  giveup: $("#giveup"),
  prompt: $("#prompt"),
  promptLabel: $("#prompt-label"),
  target: $("#target"),
  tries: $("#tries"),
  qcount: $("#qcount"),
  skip: $("#skip"),
  result: $("#result"),
  mapCard: $("#map-card"),
  map: $("#map"),
  tip: $("#tip"),
  legend: $("#legend"),
  regions: $("#regions"),
  toast: document.querySelector("#toast"),
};

const shapeEls = new Map();
ui.map.querySelectorAll("[data-fips]").forEach((node) => {
  const f = node.dataset.fips;
  node.dataset.base = node.getAttribute("class");
  if (!shapeEls.has(f)) shapeEls.set(f, []);
  shapeEls.get(f).push(node);
});
const rowEls = new Map([...ui.regions.querySelectorAll(".c")].map((n) => [n.dataset.fips, n]));

/* ─────────────────────────────────────────────
   Таймер
   ───────────────────────────────────────────── */

let timer = null;

function syncTimer() {
  if (timer) window.clearInterval(timer);
  timer = null;
  const g = game();
  if (g.started && !g.done) {
    timer = window.setInterval(() => {
      const cur = game();
      if (!cur.started || cur.done) return syncTimer();
      cur.elapsed += 1;
      renderStats();
      if (cur.elapsed % 5 === 0) save();
    }, 1000);
  }
}

function start() {
  const g = game();
  if (g.started) return;
  g.started = true;
  syncTimer();
}

/* ─────────────────────────────────────────────
   Рекорды
   ───────────────────────────────────────────── */

function commitRecord(mode, score, time) {
  const prev = records[mode] || {};
  const full = mode === "map" || score === TOTAL;
  const better =
    prev.best == null ||
    score > prev.best ||
    (score === prev.best && full && (prev.time == null || time < prev.time));
  if (better) {
    records[mode] = { best: score, time: full ? time : null };
    saveJSON(RECORD_KEY, records);
  }
  return better;
}

const recordText = (mode) => {
  const r = records[mode];
  if (!r || r.best == null) return "—";
  return r.time != null ? `${r.best} · ${fmtTime(r.time)}` : String(r.best);
};

/* ─────────────────────────────────────────────
   Рендер
   ───────────────────────────────────────────── */

const statHTML = (label, value, cls = "") =>
  `<div class="stat ${cls}"><span class="stat__label">${label}</span><span class="stat__value tnum">${value}</span></div>`;

let lastCount = null;

function renderHero() {
  const mode = S.mode;
  const n = mode === "type" ? typeScore() : mapCounts().ok + mapCounts().late;
  ui.count.textContent = n;
  if (lastCount != null && n !== lastCount) {
    ui.count.classList.remove("is-bump");
    void ui.count.offsetWidth;
    ui.count.classList.add("is-bump");
    window.setTimeout(() => ui.count.classList.remove("is-bump"), 220);
  }
  lastCount = n;
  ui.caption.textContent = MODES.find((m) => m.id === mode).caption;
  const progress = mode === "type" ? n / TOTAL : S.map.qi / TOTAL;
  ui.bar.style.width = `${progress * 100}%`;
  ui.bar.classList.toggle("is-done", game().done);
  renderStats();
}

function renderStats() {
  const g = game();
  const time = statHTML("Время", fmtTime(g.elapsed), "stat--timer");
  const rec = statHTML("Рекорд", recordText(S.mode));
  if (S.mode === "type") {
    ui.stats.innerHTML = statHTML("Осталось", TOTAL - typeScore()) + rec + time;
  } else {
    ui.stats.innerHTML =
      statHTML("Осталось", TOTAL - S.map.qi) +
      statHTML("Ошибки", S.map.wrong, S.map.wrong ? "stat--alert" : "") +
      rec +
      time;
  }
}

function renderSegmented(animate = true) {
  ui.segmented.querySelectorAll("[data-mode]").forEach((b) => {
    b.setAttribute("aria-selected", String(b.dataset.mode === S.mode));
  });
  const active = ui.segmented.querySelector(`[data-mode="${S.mode}"]`);
  if (!animate) ui.thumb.classList.remove("is-ready");
  ui.thumb.style.width = `${active.offsetWidth}px`;
  ui.thumb.style.transform = `translateX(${active.offsetLeft}px)`;
  if (!animate) requestAnimationFrame(() => ui.thumb.classList.add("is-ready"));
}

function stateClass(fips) {
  if (S.mode === "type") {
    if (S.type.guessed.includes(fips)) return "is-on";
    return S.type.done ? "is-miss" : "";
  }
  const r = S.map.results[fips];
  if (r) return `is-${r}`;
  return S.map.done ? "" : "is-open";
}

function paintMap() {
  shapeEls.forEach((nodes, fips) => {
    const cls = stateClass(fips);
    nodes.forEach((node) => node.setAttribute("class", `${node.dataset.base}${cls ? ` ${cls}` : ""}`));
  });
  ui.mapCard.classList.toggle("is-playing", S.mode === "map" && !S.map.done);
}

function animateShape(fips, cls, ms) {
  (shapeEls.get(fips) || []).forEach((node) => {
    node.classList.remove(cls);
    void node.getBoundingClientRect();
    node.classList.add(cls);
    window.setTimeout(() => node.classList.remove(cls), ms);
  });
}

function renderRows() {
  const guessed = new Set(S.type.guessed);
  rowEls.forEach((row, fips) => {
    const on = guessed.has(fips);
    const miss = !on && S.type.done;
    row.classList.toggle("is-on", on || miss);
    row.classList.toggle("is-miss", miss);
  });
  ui.regions.querySelectorAll(".region").forEach((reg) => {
    const rows = [...reg.querySelectorAll(".c")];
    const n = rows.filter((r) => guessed.has(r.dataset.fips)).length;
    reg.querySelector(".region__meter i").style.width = `${(n / rows.length) * 100}%`;
    reg.querySelector(".region__count").textContent = `${n} / ${rows.length}`;
    reg.classList.toggle("is-complete", n === rows.length);
  });
}

function renderLegend() {
  if (S.mode === "type") {
    ui.legend.innerHTML = S.type.done
      ? `<span><i style="background:var(--st-on)"></i>Названы</span><span><i style="background:var(--st-miss)"></i>Пропущены</span>`
      : "";
    return;
  }
  ui.legend.innerHTML = `
    <span><i style="background:var(--st-ok)"></i>С первого раза</span>
    <span><i style="background:var(--st-late)"></i>Со 2–3 попытки</span>
    <span><i style="background:var(--st-fail)"></i>Не нашли</span>`;
}

function renderPrompt(enter = false) {
  const g = S.map;
  if (g.done) return;
  const s = byFips.get(g.queue[g.qi]);
  ui.promptLabel.innerHTML = lastHit
    ? `<span class="prompt__ok">✓ ${byFips.get(lastHit).ru}</span> · Найдите на карте`
    : "Найдите на карте";
  ui.target.textContent = s.ru;
  ui.target.classList.remove("is-reveal");
  if (enter) {
    ui.target.classList.remove("is-enter");
    void ui.target.offsetWidth;
    ui.target.classList.add("is-enter");
  }
  ui.tries.innerHTML = Array.from({ length: MAX_TRIES }, (_, i) => `<i class="${i < g.tries ? "is-used" : ""}"></i>`).join("");
  ui.qcount.textContent = `${g.qi + 1} из ${TOTAL}`;
  ui.skip.disabled = busy;
}

function renderResult() {
  const g = game();
  if (!g.done) {
    ui.result.hidden = true;
    return;
  }
  const badge = lastRecordBroken ? `<span class="result__badge">Новый рекорд</span>` : "";
  let emoji, title, sub, stats;
  if (S.mode === "type") {
    const n = typeScore();
    const all = n === TOTAL;
    emoji = all ? "🏆" : n >= 40 ? "🎯" : n >= 25 ? "👍" : "🗺️";
    title = all ? "Все 50 штатов названы" : `Названо ${n} из ${TOTAL}`;
    sub = all ? `Вся карта Америки у вас в голове. ${fmtTime(g.elapsed)}` : "Пропущенные штаты отмечены красным на карте и в списке.";
    stats =
      statHTML("Названо", n) +
      statHTML("Пропущено", TOTAL - n, TOTAL - n ? "stat--alert" : "") +
      statHTML("Время", fmtTime(g.elapsed), "stat--timer") +
      statHTML("Рекорд", recordText("type"), "stat--good");
  } else {
    const c = mapCounts();
    emoji = c.ok === TOTAL ? "🏆" : c.ok >= 40 ? "🎯" : c.ok >= 25 ? "👍" : "🧭";
    title = c.ok === TOTAL ? "Идеально" : c.ok >= 40 ? "Отлично" : c.ok >= 25 ? "Неплохо" : "Есть куда расти";
    sub = `С первого раза ${c.ok} ${plural(c.ok, STATE_FORMS)} из ${TOTAL}. Наведите на штат, чтобы увидеть название.`;
    stats =
      statHTML("С первого раза", c.ok, "stat--good") +
      statHTML("Со 2–3 попытки", c.late) +
      statHTML("Не нашли", c.fail, c.fail ? "stat--alert" : "") +
      statHTML("Время", fmtTime(g.elapsed), "stat--timer") +
      statHTML("Рекорд", recordText("map"));
  }
  ui.result.innerHTML = `
    <div class="result view-enter">
      <div class="result__emoji">${emoji}</div>
      <h2 class="result__title">${title}</h2>
      ${badge}
      <p class="result__sub">${sub}</p>
      <div class="result__row">${stats}</div>
      <button class="btn btn--primary btn--lg" type="button" data-again>Сыграть снова</button>
    </div>`;
  ui.result.hidden = false;
}

function renderAll({ animateThumb = true } = {}) {
  const typeMode = S.mode === "type";
  const g = game();
  ui.entry.hidden = !typeMode || g.done;
  ui.prompt.hidden = typeMode || g.done;
  ui.regions.hidden = !typeMode;
  ui.input.value = "";
  ui.clear.classList.remove("is-visible");
  resetGiveUp();
  renderSegmented(animateThumb);
  renderHero();
  renderResult();
  paintMap();
  renderLegend();
  renderRows();
  if (!typeMode) renderPrompt(true);
  hideTip();
  syncTimer();
}

/* ─────────────────────────────────────────────
   Тост и подсказка на карте
   ───────────────────────────────────────────── */

let toastTimer = null;

function toast(text, { fips = null, note = false } = {}) {
  ui.toast.querySelector(".toast__icon").innerHTML = fips ? silhouette(fips) : note ? "ℹ️" : "";
  ui.toast.querySelector(".toast__name").textContent = text;
  ui.toast.classList.toggle("is-note", note);
  ui.toast.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => ui.toast.classList.remove("is-visible"), note ? 2600 : 1400);
}

let tipTimer = null;

function showTip(html, clientX, clientY, wrong = false) {
  const box = ui.mapCard.getBoundingClientRect();
  ui.tip.innerHTML = html;
  ui.tip.classList.toggle("is-wrong", wrong);
  const x = Math.min(box.width - 60, Math.max(60, clientX - box.left));
  ui.tip.style.left = `${x}px`;
  ui.tip.style.top = `${Math.max(34, clientY - box.top)}px`;
  ui.tip.classList.add("is-visible");
}

function hideTip() {
  window.clearTimeout(tipTimer);
  ui.tip.classList.remove("is-visible");
}

const tipName = (s) => `${s.ru}<small>${s.en}</small>`;

/* Название видно только у открытых штатов, чтобы не подсказывать */
function revealed(fips) {
  if (S.mode === "type") return S.type.done || S.type.guessed.includes(fips);
  return S.map.done || Boolean(S.map.results[fips]);
}

/* ─────────────────────────────────────────────
   Режим «Вписать штаты»
   ───────────────────────────────────────────── */

function shake() {
  ui.entry.classList.remove("is-shake");
  void ui.entry.offsetWidth;
  ui.entry.classList.add("is-shake");
  window.setTimeout(() => ui.entry.classList.remove("is-shake"), 340);
}

function onInput() {
  const g = S.type;
  const value = ui.input.value;
  ui.clear.classList.toggle("is-visible", value.length > 0);
  if (g.done || !value.trim()) return;
  const key = normalize(value);
  const s = nameIndex.get(key);
  if (s) {
    start();
    ui.input.value = "";
    ui.clear.classList.remove("is-visible");
    if (g.guessed.includes(s.fips)) {
      toast(`${s.ru} уже назван`, { note: true });
      return;
    }
    g.guessed.push(s.fips);
    save();
    renderHero();
    renderRows();
    paintMap();
    animateShape(s.fips, "is-pop", 520);
    const row = rowEls.get(s.fips);
    row.classList.remove("is-new");
    void row.offsetWidth;
    row.classList.add("is-new");
    toast(s.ru, { fips: s.fips });
    if (g.guessed.length === TOTAL) finishType(false);
    return;
  }
  const note = notStateIndex.get(key);
  if (note) {
    ui.input.value = "";
    ui.clear.classList.remove("is-visible");
    shake();
    toast(note.text, { note: true });
  }
}

function finishType(gaveUp) {
  const g = S.type;
  if (g.done) return;
  g.done = true;
  g.gaveUp = gaveUp;
  lastRecordBroken = commitRecord("type", g.guessed.length, g.elapsed);
  save();
  renderAll();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

let giveUpArmed = null;

function resetGiveUp() {
  window.clearTimeout(giveUpArmed);
  giveUpArmed = null;
  ui.giveup.textContent = "Сдаться";
}

function onGiveUp() {
  if (S.type.done) return;
  if (!giveUpArmed) {
    ui.giveup.textContent = "Точно сдаться?";
    giveUpArmed = window.setTimeout(resetGiveUp, 3000);
    return;
  }
  resetGiveUp();
  finishType(true);
}

/* ─────────────────────────────────────────────
   Режим «Найти на карте»
   ───────────────────────────────────────────── */

function advance() {
  const g = S.map;
  g.qi += 1;
  g.tries = 0;
  if (g.qi >= TOTAL) {
    g.done = true;
    lastRecordBroken = commitRecord("map", mapCounts().ok, g.elapsed);
    save();
    renderAll();
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  save();
  renderHero();
  renderPrompt(true);
}

function failCurrent() {
  const g = S.map;
  const target = g.queue[g.qi];
  g.results[target] = "fail";
  busy = true;
  lastHit = null;
  save();
  paintMap();
  renderHero();
  animateShape(target, "is-reveal", 1100);
  ui.promptLabel.textContent = "Вот он";
  ui.target.classList.add("is-reveal");
  ui.skip.disabled = true;
  window.setTimeout(() => {
    busy = false;
    advance();
  }, 1200);
}

function onMapClick(e) {
  const node = e.target.closest("[data-fips]");
  if (!node) return;
  const fips = node.dataset.fips;
  if (S.mode !== "map") {
    if (revealed(fips)) showTip(tipName(byFips.get(fips)), e.clientX, e.clientY);
    return;
  }
  const g = S.map;
  if (g.done) {
    showTip(tipName(byFips.get(fips)), e.clientX, e.clientY);
    return;
  }
  if (busy || g.results[fips]) return;
  start();
  const target = g.queue[g.qi];
  if (fips === target) {
    g.results[fips] = g.tries === 0 ? "ok" : "late";
    paintMap();
    animateShape(fips, "is-pop", 520);
    lastHit = fips;
    hideTip();
    advance();
    return;
  }
  g.tries += 1;
  g.wrong += 1;
  animateShape(fips, "is-wrong", 700);
  showTip(`Это ${byFips.get(fips).ru}`, e.clientX, e.clientY, true);
  window.clearTimeout(tipTimer);
  tipTimer = window.setTimeout(hideTip, 1100);
  renderStats();
  if (g.tries >= MAX_TRIES) {
    failCurrent();
  } else {
    save();
    renderPrompt(false);
  }
}

function onSkip() {
  const g = S.map;
  if (g.done || busy) return;
  start();
  failCurrent();
}

/* ─────────────────────────────────────────────
   События
   ───────────────────────────────────────────── */

ui.input.addEventListener("input", onInput);
ui.input.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    ui.input.value = "";
    ui.clear.classList.remove("is-visible");
  } else if (e.key === "Enter" && ui.input.value.trim()) {
    shake();
  }
});
ui.clear.addEventListener("click", () => {
  ui.input.value = "";
  ui.clear.classList.remove("is-visible");
  ui.input.focus();
});
ui.giveup.addEventListener("click", onGiveUp);
ui.skip.addEventListener("click", onSkip);

ui.segmented.addEventListener("click", (e) => {
  const b = e.target.closest("[data-mode]");
  if (!b || b.dataset.mode === S.mode) return;
  S.mode = b.dataset.mode;
  lastRecordBroken = false;
  lastCount = null;
  busy = false;
  lastHit = null;
  ui.toast.classList.remove("is-visible");
  save();
  renderAll();
  if (S.mode === "type" && !S.type.done) ui.input.focus();
  if (S.mode === "map" && !S.map.done) ensureMapVisible();
});

/* Во время игры на карте вся карта должна быть в экране: докручиваем так, чтобы подсказка прилипла сверху */
function ensureMapVisible() {
  requestAnimationFrame(() => {
    if (ui.mapCard.getBoundingClientRect().bottom <= window.innerHeight) return;
    const top = ui.prompt.getBoundingClientRect().top + window.scrollY - 12;
    window.scrollTo({ top, behavior: "smooth" });
  });
}

function restart() {
  if (S.mode === "type") S.type = freshType();
  else S.map = freshMap();
  lastRecordBroken = false;
  lastCount = null;
  busy = false;
  lastHit = null;
  save();
  renderAll();
  if (S.mode === "type") ui.input.focus();
  else ensureMapVisible();
}

ui.reset.addEventListener("click", restart);
ui.result.addEventListener("click", (e) => {
  if (e.target.closest("[data-again]")) restart();
});

ui.map.addEventListener("click", onMapClick);
ui.map.addEventListener("pointermove", (e) => {
  if (e.pointerType !== "mouse") return;
  const node = e.target.closest("[data-fips]");
  if (ui.tip.classList.contains("is-wrong") && ui.tip.classList.contains("is-visible")) return;
  if (node && revealed(node.dataset.fips)) showTip(tipName(byFips.get(node.dataset.fips)), e.clientX, e.clientY);
  else hideTip();
});
ui.map.addEventListener("pointerleave", () => {
  if (!ui.tip.classList.contains("is-wrong")) hideTip();
});

window.addEventListener("resize", () => renderSegmented(false));
document.addEventListener("keydown", (e) => {
  if (S.mode !== "type" || S.type.done) return;
  if (e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1) return;
  if (document.activeElement !== ui.input) ui.input.focus();
});

/* ─────────────────────────────────────────────
   Старт
   ───────────────────────────────────────────── */

renderAll({ animateThumb: false });
if (S.mode === "type" && !S.type.done) ui.input.focus();
