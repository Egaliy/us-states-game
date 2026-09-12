import { readFileSync, writeFileSync } from "node:fs";
import { feature, mesh } from "topojson-client";
import { geoPath } from "d3-geo";

const topo = JSON.parse(readFileSync("node_modules/us-atlas/states-albers-10m.json", "utf8"));
const states = feature(topo, topo.objects.states).features;
const path = geoPath(null).digits(1);
const round = (n) => Math.round(n * 10) / 10;

const out = states
  .map((f) => ({
    fips: f.id,
    name: f.properties.name,
    d: path(f),
    c: path.centroid(f).map(round),
    area: Math.round(path.area(f)),
    b: path.bounds(f).flat().map(round),
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

const borders = path(mesh(topo, topo.objects.states, (a, b) => a !== b));
const nation = path(mesh(topo, topo.objects.states, (a, b) => a === b));

writeFileSync(
  "src/map-data.js",
  `// Сгенерировано scripts/build-map.mjs из us-atlas (Albers USA, 975×610). Не править руками.\n` +
    `export const VIEWBOX = "0 0 975 610";\n` +
    `export const SHAPES = ${JSON.stringify(Object.fromEntries(out.map((s) => [s.fips, { d: s.d, c: s.c, area: s.area, b: s.b }])))};\n` +
    `export const BORDERS = ${JSON.stringify(borders)};\n` +
    `export const NATION = ${JSON.stringify(nation)};\n`,
);
console.log(out.length, "shapes");
console.log(out.map((s) => `${s.fips} ${s.name} area=${s.area}`).join("\n"));
