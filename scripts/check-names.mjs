import { STATES, NOT_STATES } from "../src/states.js";
const normalize = (s) => String(s).toLowerCase().replaceAll("э", "е").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-zа-я0-9]/g, "").replace(/(.)\1+/g, "$1");
const keys = [];
STATES.forEach((s) => [s.ru, s.en, ...(s.aliases || [])].forEach((w) => keys.push([normalize(w), s.ru, w])));
NOT_STATES.forEach((n) => n.words.forEach((w) => keys.push([normalize(w), "НЕ ШТАТ", w])));
const seen = new Map(); let bad = 0;
for (const [k, who, w] of keys) { if (seen.has(k) && seen.get(k) !== who) { console.log("COLLISION", k, seen.get(k), who); bad++; } seen.set(k, who); }
/* ключ A — начало ключа B другого штата: при наборе B засчитается A раньше времени */
for (const [a, wa] of seen) for (const [b, wb] of seen) if (a !== b && wa !== wb && b.startsWith(a)) console.log("PREFIX", `«${a}» (${wa}) ⊂ «${b}» (${wb})`);
const probe = ["Нью Йорк", "нью-иорк", "Масачусетс", "Миссиссипи", "Тенесси", "Кентуки", "Иллинойз", "Делавер", "Мен", "Мериленд", "Нью-Хемпшир", "Вирджиния", "Западная вирджиния", "mississipi", "Род Айленд", "Пенсилвания", "Гаваи"];
for (const p of probe) console.log(p.padEnd(20), "→", seen.get(normalize(p)) || "НЕТ");
console.log("states:", STATES.length, "keys:", seen.size, "collisions:", bad);
