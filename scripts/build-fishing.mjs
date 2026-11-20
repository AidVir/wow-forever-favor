// Builds data/fishing.json: where to fish, what each spot catches and how fast fishing levels.
// No Blizzard credentials needed:
//   node scripts/build-fishing.mjs
//
// Sources
//  - Classic 1.12 server data (cmangos/classic-db): `skill_fishing_base_level` (each zone's base skill) and
//    `fishing_loot_template` + `reference_loot_template` (what a successful cast catches, per zone / subzone).
//    Its "no get-away" skills (base + 95) match the WoW Forever fishing table on timesaver.gg (25 / 75 / 150 /
//    225 / 300 / 425), so Forever kept Classic's fishing zones.
//  - Catch chance (cmangos GameObject.cpp): you need skill >= base; chance = skill − base + 5 %, capped at 100.
//    Skill here includes the pole, lure and gear bonus.
//  - Catches per skill-up: Warcraft Tavern's Classic fishing guide table (1 up to 100, then +1 every 25 points,
//    10 at 290–300; about 1,280 catches for 1–300). Only successful catches count; the zone doesn't matter.
//  - Ranks: Journeyman at 50 / level 10 from any fishing trainer, Expert with the book "Expert Fishing - The Bass
//    and You" (Old Man Heming, Booty Bay) at 125 / level 20, Artisan from the quest "Nat Pagle, Angler Extreme"
//    (Dustwallow Marsh) at 225 / level 35 (wow-professions.com and timesaver.gg Forever guides).
//  - Item names and vendor prices: nexus-devs/wow-classic-items. Zone names: the Forever client's AreaTable.
import { writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { parseCsv } from "./learn-levels.mjs";

const BUILD = "1.60.1.70862";
const DB = "https://raw.githubusercontent.com/cmangos/classic-db/master/Full_DB/ClassicDB_1_12_1_z2815.sql.gz";
const WCI = "https://raw.githubusercontent.com/nexus-devs/wow-classic-items/master/data/json/data.json";

// Zones you can fish in the open world: Classic level range, and the faction for capital cities.
// Instances (Deadmines, Wailing Caverns, Scholomance…) are left out: you don't level fishing in a dungeon.
const ZONES = {
  // starting zones and the level 10–20 zones are one faction's territory (guards, no flight paths for the other)
  1: [1, 10, "alliance"], 12: [1, 10, "alliance"], 141: [1, 10, "alliance"], 14: [1, 10, "horde"], 215: [1, 10, "horde"], 85: [1, 10, "horde"],
  148: [10, 20, "alliance"], 38: [10, 20, "alliance"], 40: [10, 20, "alliance"], 130: [10, 20, "horde"], 17: [10, 25, "horde"],
  44: [15, 25], 406: [15, 27], 331: [18, 30], 10: [18, 30], 267: [20, 30], 11: [20, 30],
  400: [25, 35], 36: [30, 40], 45: [30, 40], 405: [30, 40], 33: [30, 45], 15: [35, 45], 8: [35, 45],
  357: [40, 50], 47: [40, 50], 440: [40, 50], 16: [45, 55], 490: [48, 55], 361: [48, 55], 493: [1, 60],
  46: [50, 58], 28: [51, 58], 139: [53, 60], 618: [53, 60], 1377: [55, 60], 41: [55, 60],
  1637: [1, 60, "horde"], 1638: [1, 60, "horde"], 1497: [1, 60, "horde"],
  1519: [1, 60, "alliance"], 1537: [1, 60, "alliance"], 1657: [1, 60, "alliance"],
};
// Winter Squid (winter) / Raw Summer Bass (summer): cmangos conditions 322 / 323 on reference 13755.
const SEASONAL = 13755;

const CATCHES_PER_POINT = [[1, 100, 1], [100, 115, 2], [115, 140, 3], [140, 165, 4], [165, 190, 5], [190, 215, 6], [215, 240, 7], [240, 265, 8], [265, 290, 9], [290, 300, 10]];
// Lures: +skill for 10 minutes (the Attractor 5). Skill needed to use them, from timesaver.gg's Forever table.
const LURES = [
  { id: 6529, bonus: 25, skill: 1, mins: 10 },   // Shiny Bauble (vendor)
  { id: 6530, bonus: 50, skill: 50, mins: 10 },  // Nightcrawlers (vendor)
  { id: 6811, bonus: 50, skill: 50, mins: 10 },  // Aquadynamic Fish Lens (Engineering, AH)
  { id: 6532, bonus: 75, skill: 100, mins: 10 }, // Bright Baubles (vendor)
  { id: 7307, bonus: 75, skill: 100, mins: 10 }, // Flesh Eating Worm (AH)
  { id: 6533, bonus: 100, skill: 100, mins: 5 }, // Aquadynamic Fish Attractor (Engineering, AH)
];
// Lures sold by fishing-supply vendors (the others only come from the AH).
const VENDOR_LURES = new Set([6529, 6530, 6532]);
// lvl / skill = character level and Fishing skill needed to equip (client ItemSparse). 285094 Ravaged Fishing Pole
// is Forever-only (drops from Lord Angler, Dustwallow Marsh), so it isn't in Classic item data; its name is added below.
const POLES = [
  { id: 6256, bonus: 0 }, { id: 12225, bonus: 3, skill: 1 }, { id: 6365, bonus: 5, lvl: 5, skill: 10 },
  { id: 285094, bonus: 15, lvl: 20, skill: 50, from: "Lord Angler (Dustwallow Marsh)" },
  { id: 6367, bonus: 20, lvl: 25, skill: 100 }, { id: 19022, bonus: 25, skill: 100 }, { id: 19970, bonus: 35, skill: 300 },
];
const RANKS = [
  { name: "Journeyman", cap: 150, skill: 50, level: 10, how: "any fishing trainer" },
  { name: "Expert", cap: 225, skill: 125, level: 20, book: 16083, how: "book \"Expert Fishing - The Bass and You\" from Old Man Heming, Booty Bay (Stranglethorn Vale), or the AH" },
  { name: "Artisan", cap: 300, skill: 225, level: 35, quest: 6607, how: "quest \"Nat Pagle, Angler Extreme\" from Nat Pagle, Tidefury Cove (Dustwallow Marsh): catch Feralas Ahi, Misty Reed Mahi Mahi, Sar'theris Striker and Savage Coast Blue Sailfin" },
];

// --- SQL dump parsing (only the tables we need) --------------------------------------------
function rows(sql, table) {
  const out = [];
  const re = new RegExp("INSERT INTO `" + table + "` VALUES (.*?);\\n", "gs");
  for (const m of sql.matchAll(re)) {
    const s = m[1];
    for (let i = 0; i < s.length; i++) {
      if (s[i] !== "(") continue;
      const row = []; let cur = "", q = false, j = i + 1;
      for (; j < s.length; j++) {
        const c = s[j];
        if (q) { if (c === "\\") { cur += s[++j]; continue; } if (c === "'") { q = false; continue; } cur += c; continue; }
        if (c === "'") { q = true; continue; }
        if (c === ",") { row.push(cur); cur = ""; continue; }
        if (c === ")") { row.push(cur); break; }
        cur += c;
      }
      out.push(row); i = j;
    }
  }
  return out;
}

// Expected units of each item per successful cast, from loot rows [item, chance, group, mincountOrRef, maxcount, condition].
// Group 1: exactly one item; rows with chance 0 share what the explicit chances leave. Group 0: each row rolls on its own.
// Negative chance = quest item (only with the quest), skipped. A reference row pulls in another table.
function expand(lootRows, refs, out = new Map(), mult = 1, seasonal = []) {
  const add = (id, n) => out.set(id, (out.get(id) || 0) + n);
  const groups = new Map();
  for (const r of lootRows) {
    const [item, chance, group, minOrRef, maxc, cond] = r.map(Number);
    if (chance < 0) continue;
    if (minOrRef < 0) { // reference
      const ref = -minOrRef;
      if (ref === SEASONAL) { seasonal.push(chance / 100 * mult); continue; }
      expand(refs.get(ref) || [], refs, out, mult * chance / 100, seasonal);
      continue;
    }
    if (cond) continue;
    const avg = (minOrRef + maxc) / 2;
    if (!group) { add(item, mult * chance / 100 * avg); continue; }
    (groups.get(group) || groups.set(group, []).get(group)).push([item, chance, avg]);
  }
  for (const g of groups.values()) {
    const set = g.reduce((a, [, c]) => a + c, 0), zero = g.filter(([, c]) => !c).length;
    const rest = Math.max(0, 100 - set) / (zero || 1);
    for (const [item, c, avg] of g) add(item, mult * (c || rest) / 100 * avg);
  }
  return { out, seasonal };
}

async function main() {
  console.log("downloading Classic server data, zone names and item data");
  const [gz, areaCsv, wci] = await Promise.all([
    fetch(DB).then(r => r.arrayBuffer()),
    fetch(`https://wago.tools/db2/AreaTable/csv?build=${BUILD}`).then(r => r.text()),
    fetch(WCI).then(r => r.json()),
  ]);
  const sql = gunzipSync(Buffer.from(gz)).toString("utf8");
  const area = new Map(parseCsv(areaCsv).map(a => [Number(a.ID), { name: a.AreaName_lang, parent: Number(a.ParentAreaID) }]));
  const items = new Map(wci.map(i => [i.itemId, i]));
  const base = new Map(rows(sql, "skill_fishing_base_level").map(([a, s]) => [Number(a), Number(s)]));
  const refs = new Map();
  for (const [e, ...r] of rows(sql, "reference_loot_template")) (refs.get(+e) || refs.set(+e, []).get(+e)).push(r);
  const loot = new Map();
  // The comment on each shared-table row lists every area that uses it ("Zone Area: (38),(40)…" or
  // "Feralas (357) / …"), including areas whose own rows only hold a quest fish (Loch Modan, the Feralas coast).
  const member = new Map(); // area -> shared reference table
  for (const [e, ...r] of rows(sql, "fishing_loot_template")) {
    (loot.get(+e) || loot.set(+e, []).get(+e)).push(r);
    const ref = -Number(r[3]);
    if (ref > 0 && ref !== SEASONAL) for (const m of r[6].matchAll(/\((\d+)\)/g)) if (!member.has(+m[1])) member.set(+m[1], ref);
  }
  // an area whose own rows give no ordinary catch uses the shared table its comment puts it in
  const hasCatch = rs => rs.some(r => Number(r[1]) > 0 && Number(r[2]) > 0 || (Number(r[3]) < 0 && -Number(r[3]) !== SEASONAL));
  for (const [a, ref] of member) {
    const own = loot.get(a) || [];
    if (!hasCatch(own)) loot.set(a, [...own, [String(ref), "100", "1", String(-ref), "1", "0", ""]]);
  }

  const zoneOf = id => { let a = id; for (let k = 0; k < 5 && area.get(a)?.parent; k++) a = area.get(a).parent; return a; };
  // Every fishable area in an open-world zone: the zone itself and subzones with their own loot table.
  const spots = new Map(); // key -> spot
  const areas = new Set([...loot.keys(), ...base.keys()]);
  for (const a of areas) {
    const z = zoneOf(a);
    if (!ZONES[z]) continue;
    const rowsHere = loot.get(a) || loot.get(z);
    if (!rowsHere) continue;
    const skill = base.get(a) ?? base.get(z);
    if (skill == null) continue;
    const { out, seasonal } = expand(rowsHere, refs);
    if ([...out.values()].reduce((x, y) => x + y, 0) < 0.5) continue; // only quest fish here
    const fish = [...out.entries()].filter(([, n]) => n > 0.0005).sort((x, y) => y[1] - x[1]).map(([id, n]) => [id, Math.round(n * 10000) / 10000]);
    const key = z + "|" + skill + "|" + JSON.stringify(fish) + "|" + seasonal.join();
    const s = spots.get(key);
    if (s) { if (a !== z) s.sub.push(area.get(a)?.name || String(a)); else s.main = true; continue; }
    const [lo, hi, faction] = ZONES[z];
    spots.set(key, { zoneId: z, zone: area.get(z)?.name || String(z), main: a === z, sub: a === z ? [] : [area.get(a)?.name || String(a)], base: skill, levels: [lo, hi], faction: faction || null, fish, seasonal: seasonal.length ? Math.round(seasonal.reduce((x, y) => x + y, 0) * 1000) / 1000 : 0 });
  }
  const list = [...spots.values()].map(s => ({
    zoneId: s.zoneId,
    name: s.main ? s.zone : `${s.zone}: ${s.sub.sort().slice(0, 3).join(", ")}${s.sub.length > 3 ? ` +${s.sub.length - 3} more` : ""}`,
    where: s.main ? (s.sub.length ? `most of the zone (also ${s.sub.length} subzone${s.sub.length > 1 ? "s" : ""})` : "the whole zone") : s.sub.sort().join(", "),
    base: s.base, full: s.base + 95, levels: s.levels, faction: s.faction, fish: s.fish, seasonal: s.seasonal,
  })).sort((a, b) => a.base - b.base || a.name.localeCompare(b.name));

  const ids = new Set([...list.flatMap(s => s.fish.map(f => f[0])), 13755, 13756, ...LURES.map(l => l.id), ...POLES.map(p => p.id), 16083]);
  const itemInfo = {};
  for (const id of [...ids].sort((a, b) => a - b)) {
    const i = items.get(id); if (!i) continue;
    itemInfo[id] = { n: i.name, q: (i.quality || "")[0], s: i.sellPrice || 0, ...(i.vendorPrice && (VENDOR_LURES.has(id) || POLES.some(p => p.id === id && [6256, 6365].includes(id))) ? { v: i.vendorPrice } : {}) };
  }
  itemInfo[16083] = { ...itemInfo[16083], v: items.get(16083)?.vendorPrice ?? 10000 };
  itemInfo[285094] ||= { n: "Ravaged Fishing Pole", q: "", s: 0 }; // Forever-only, not in Classic item data
  const data = {
    note: "Built by scripts/build-fishing.mjs from Classic 1.12 server data (cmangos classic-db), the Forever client's zone names and Classic item data. fish = expected units per successful cast. A cast succeeds with chance (skill + bonus − base + 5)% and needs skill + bonus >= base; full = base + 95 (no fish get away). seasonal = extra Winter Squid (Oct–Mar) / Raw Summer Bass (Apr–Sep) per cast.",
    build: BUILD,
    catchesPerPoint: CATCHES_PER_POINT,
    lures: LURES, poles: POLES, ranks: RANKS,
    spots: list,
    items: itemInfo,
  };
  await writeFile(new URL("../data/fishing.json", import.meta.url), JSON.stringify(data));
  console.log(`${list.length} fishing spots, ${Object.keys(itemInfo).length} items`);
}
main().catch(e => { console.error(e); process.exit(1); });
