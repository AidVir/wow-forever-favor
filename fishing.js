// Fishing model shared by the leveling and money-making pages. Data: data/fishing.json (scripts/build-fishing.mjs).
//
// Rules (Classic 1.12 server logic, which WoW Forever keeps; see the build script for sources):
//  - A cast catches something with chance (skill − base + 5)% where skill includes pole and lure, and needs
//    skill >= the spot's base skill. At base + 95 nothing gets away.
//  - A catch gives a skill point every catchesPerPoint(skill) successful catches (1 below 100, 10 at 290–300).
//    Where you fish doesn't change that, only how often fish get away.
//  - Lures add skill for 10 minutes (the Attractor 5) and need a minimum fishing skill to use.
import { minPrice } from "./common.js";

export const FISH_SECONDS = 15; // default seconds per cast, bite and loot (casts last up to ~20 s)

export function catchChance(spot, skill) {
  if (skill < spot.base) return 0;
  return Math.min(1, (skill - spot.base + 5) / 100);
}
export function catchesPerPoint(F, skill) {
  for (const [a, b, n] of F.catchesPerPoint) if (skill >= a && skill < b) return n;
  return F.catchesPerPoint[F.catchesPerPoint.length - 1][2];
}
// Winter Squid from October to March, Raw Summer Bass from April to September.
export const seasonFish = (d = new Date()) => (d.getUTCMonth() >= 9 || d.getUTCMonth() <= 2 ? 13755 : 13756);
// Expected units per successful cast, with this season's extra fish.
export function spotYield(spot) {
  const out = spot.fish.map(([id, n]) => [id, n]);
  if (spot.seasonal) {
    const id = seasonFish(), hit = out.find(x => x[0] === id);
    if (hit) hit[1] += spot.seasonal; else out.push([id, spot.seasonal]);
  }
  return out;
}
// Price of one lure: vendor lures at the vendor, the rest from the AH (null = not available).
export function lurePrice(F, book, lure) {
  const v = F.items[lure.id]?.v, ah = minPrice(book, lure.id);
  return v != null ? (ah != null ? Math.min(v, ah) : v) : ah;
}
// Lure options at this skill: no lure, plus every lure you can use and get, with its cost per hour.
export function lureOptions(F, book, skill) {
  const opts = [{ lure: null, bonus: 0, perHour: 0 }];
  for (const l of F.lures) {
    if (skill < l.skill) continue;
    const p = lurePrice(F, book, l);
    if (p == null) continue;
    opts.push({ lure: l, bonus: l.bonus, price: p, perHour: p * 60 / l.mins });
  }
  return opts;
}
// Spots this character can fish: own faction's capitals only; `level` filters zones above the character.
export function openSpots(F, faction, level = 60) {
  return F.spots.filter(s => (!s.faction || s.faction === faction) && s.levels[0] <= level);
}
export const fishName = (F, ITEMS, id) => ITEMS?.[id]?.n || F.items[id]?.n || String(id);
