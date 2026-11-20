import { $, store, esc, gold, makeBook, buyCost, consume, listed, minPrice, loadPrices, loadJson, ago, bindFaction, wh, marketTrend, projectPrice, trendLabel } from "./common.js";
import { FISH_SECONDS, catchChance, catchesPerPoint, spotYield, lureOptions, openSpots, seasonFish, sameCatch, sameCatchText } from "./fishing.js";

const RARE_STATIONS = new Set(["Black Anvil", "Black Forge", "Arcane Forge", "Moonwell", "Icebellow Anvil", "Master Forge", "Anarchist's Workbench"]);
const state = {
  faction: store.get("faction", "horde"),
  neutral: store.get("neutral", false),
  prof: store.get("lv:prof", "Alchemy"),
  from: store.get("lv:from", 1),
  to: store.get("lv:to", 300),
  // "all" used to be the default; nobody owns every pattern, so old saved "all" choices move to "buyable" once
  patterns: (v => ["all", "buyable", "vendor", "trainer"].includes(v) && !(v === "all" && !store.get("lv:patternsV2", false)) ? v : "buyable")(store.get("lv:patterns", "buyable")),
  time: store.get("lv:time", 5),
  level: store.get("lv:level", 60),
  fast: store.get("lv:fast", true),
  sell: (v => ["ah", "vendor", "none"].includes(v) ? v : "ah")(store.get("lv:sell", "ah")),
  wait: (v => [1, 3, 7].includes(v) ? v : 3)(store.get("lv:wait", 3)),
  mining: store.get("lv:mining", false),
  stationsOff: new Set(store.get("lv:stationsOff", null) ?? [...RARE_STATIONS]),
  excluded: new Set(store.get("lv:excluded", [])),
  // fishing ("Fishing" and "Fishing + Cooking" in the profession list)
  ffrom: store.get("lv:ffrom", 1),
  fto: store.get("lv:fto", 300),
  castSec: store.get("lv:castSec", FISH_SECONDS),
  pole: store.get("lv:pole", 0),
  hourValue: store.get("lv:hourValue", 10),
  cookCatch: store.get("lv:cookCatch", true), // Fishing + Cooking: cook what you catch before buying anything
  owned: store.get("lv:owned", ""), // "Materials I already have": pasted "20x Linen Cloth" lines

};
let PRICES, REC, ITEMS, FISH, FISH_IDS = new Set(); // FISH_IDS: everything fishing can catch
const FISHING = "Fishing", FISH_COOK = "Fishing + Cooking";
const fishMode = () => state.prof === FISHING || state.prof === FISH_COOK;

// --- training ranks --------------------------------------------------------------------
// Each rank raises the skill cap; you can train it once you have the skill and character level.
const RANKS = [
  { name: "Journeyman", cap: 75, skill: 50, level: 10 },
  { name: "Expert", cap: 150, skill: 125, level: 20 },
  { name: "Artisan", cap: 225, skill: 200, level: 35 },
];
// Expert / Artisan trainers per profession (WoW Forever, from the wow-professions.com guides).
// Journeyman is taught by the trainers in every capital city.
const TRAINERS = {
  Alchemy: { Expert: { horde: "Doctor Herbert Halsey, Undercity", alliance: "Ainethil, Darnassus" }, Artisan: { horde: "Rogvar, Stonard (Swamp of Sorrows)", alliance: "Kylanna Windwhisper, Feathermoon Stronghold (Feralas)" } },
  Tailoring: { Expert: { horde: "Josef Gregorian, Undercity", alliance: "Georgio Bolero, Stormwind" }, Artisan: { horde: "Daryl Stack, Tarren Mill (Hillsbrad Foothills)", alliance: "Timothy Worthington, Theramore Isle (Dustwallow Marsh)" } },
  Blacksmithing: { Expert: { horde: "Saru Steelfury, Orgrimmar", alliance: "Bengus Deepforge, Ironforge" }, Artisan: { both: "Brikk Keencraft, Booty Bay (Stranglethorn Vale)" } },
  Leatherworking: { Expert: { horde: "Una, Thunder Bluff", alliance: "Telonis, Darnassus" }, Artisan: { horde: "Hahrana Ironhide, Camp Mojache (Feralas)", alliance: "Drakk Stonehand, Aerie Peak (The Hinterlands)" } },
  Enchanting: { Expert: { horde: "Hgarth, Sun Rock Retreat (Stonetalon Mountains)", alliance: "Kitta Firewind, Tower of Azora (Elwynn Forest)" }, Artisan: { both: "Annora, inside Uldaman (Badlands); bring a group" } },
  Engineering: { Expert: { horde: "Roxxik, Orgrimmar", alliance: "Springspindle Fizzlegear, Ironforge" }, Artisan: { both: "Buzzek Bracketswing, Gadgetzan (Tanaris)" } },
  Cooking: { Expert: { horde: "book \"Expert Cookbook\" from Wulan, Shadowprey Village (Desolace)", alliance: "book \"Expert Cookbook\" from Shandrina, Mystral Lake (Ashenvale)" }, Artisan: { both: "quest \"Clamlette Surprise\" from Dirge Quikcleave, Gadgetzan (12 Giant Egg, 10 Zesty Clam Meat, 20 Alterac Swiss)" } },
};
function trainerFor(prof, rank) {
  if (rank === "Journeyman") return "any capital-city trainer";
  const t = TRAINERS[prof]?.[rank];
  return t ? (t.both || t[state.faction]) : "trainer not confirmed for Forever yet";
}
// Highest skill this character can reach: each rank needs a character level.
function levelCap() {
  const trained = RANKS.filter(k => state.level >= k.level).length; // ranks are in level order
  return [75, 150, 225, 300][trained];
}
// Recipes needing more crafts than this per skill point are skipped while a faster one exists.
const MAX_CRAFTS_PER_POINT = 3;
// Stay on the current recipe unless another one is clearly cheaper (fewer, longer steps).
// Switch recipes only when the other one is clearly cheaper: STICK (15%) of its cost per point, and at least
// stickMin(skill) copper per point, which grows with skill level because everything costs more higher up.
// A short detour (a recipe usable only a few more points) must also save at least MIN_RUN points' worth in total.
const STICK = 0.15, MIN_RUN = 5;
const stickMin = s => 20 + s; // copper per point: 40c at skill 20, 1s 20c at 100, 2s 70c at 250
// Before the route is known, a pattern's price is spread over this many points.
const ONCE_SPREAD = 5; // 10%, at least 50 copper per point

const chance = (r, s) => s < r.yellow ? 1 : s >= r.grey ? 0 : (r.grey - s) / (r.grey - r.yellow);
const color = (r, s) => s < r.yellow ? "orange" : s < r.green ? "yellow" : s < r.grey ? "green" : "grey";

// Fishing has no recipes; "Fishing + Cooking" plans Cooking with the fish the fishing route catches.
function profData() {
  if (state.prof === FISHING) return { name: FISHING, recipes: [] };
  return REC.professions.find(p => p.name === (state.prof === FISH_COOK ? "Cooking" : state.prof));
}

// Cheapest way to get `qty` of an item right now: what earlier steps made (ctx.inv, valued at what you'd
// otherwise sell it for), vendor (unlimited), AH (consumes book; not for bind-on-pickup items) or craft it
// with this profession if a recipe is known at the current skill. Returns {cost, plan:[[kind,id,qty]]}.
function acquire(ctx, id, qty, depth = 0, noAh = false) {
  const have = ctx.inv ? Math.min(qty, ctx.inv.qty(id)) : 0;
  const invCost = have ? ctx.inv.valueOf(id, have) : 0;
  if (have === qty) return { cost: invCost, plan: [["inv", id, have, invCost]] };
  const need = qty - have;
  const it = ITEMS[id];
  let best = null;
  const ah = noAh ? null : buyCost(ctx.book, id, need);
  if (ah != null) best = { cost: ah, plan: [["ah", id, need]] };
  if (it?.v != null && (!best || it.v * need < best.cost)) best = { cost: it.v * need, plan: [["vendor", id, need]] };
  if (depth < 2) {
    for (const r of ctx.makers.get(id) || []) {
      if ((!r.helper && r.learn > ctx.skill) || !allowed(r)) continue;
      if (r.tools && ctx.hasTool && !r.tools.every(ctx.hasTool)) continue; // can't make it without its tool yet
      const crafts = Math.ceil(need / r.qty);
      let cost = 0, plan = [["craft", r.id, crafts]];
      for (const [rid, rq] of r.reagents) {
        const a = acquire(ctx, rid, rq * crafts, depth + 1);
        if (!a) { cost = null; break; }
        cost += a.cost; plan = plan.concat(a.plan);
      }
      if (cost != null && (!best || cost < best.cost)) best = { cost, plan };
    }
  }
  if (!best) return null;
  if (have) { best.cost += invCost; best.plan.unshift(["inv", id, have, invCost]); }
  return best;
}
let BOOK0 = {};
function allowed(r) {
  if (state.excluded.has(r.id)) return false;
  if (r.needs && state.stationsOff.has(r.needs)) return false;
  if (r.source === "item") {
    if (state.patterns === "trainer") return false;
    if (otherFaction(r) && patternCost(BOOK0, r).unknown) return false; // other faction's vendor / quest, not on the AH
    if (state.patterns === "vendor" && (!["vendor", "quest"].includes(r.src?.k) || otherFaction(r))) return false;
    if (state.patterns === "buyable" && patternCost(BOOK0, r).unknown) return false;
  }
  return true;
}
// A pattern whose vendor or quest is only for the other faction can only be bought on the AH.
const otherFaction = r => { const f = r.src?.faction; return !!f && f !== "Both" && f.toLowerCase() !== state.faction; };
// One-time cost to learn a pattern recipe: the cheapest of the teaching item on the AH, its vendor
// (Classic price), or free from a quest. Unknown = not listed and no vendor/quest source (cost 0).
function patternCost(book, r) {
  if (r.source === "trainer" && r.train) return { cost: r.train, how: "trainer" }; // trainer fee (Wowhead Forever data)
  if (r.source !== "item") return { cost: 0 };
  let best = null;
  for (const id of r.recipeItems) {
    const p = minPrice(book, id);
    if (p != null && (!best || p < best.cost)) best = { cost: p, id, how: "ah" };
  }
  const s = r.src;
  if (s?.k === "vendor" && s.cost != null && !otherFaction(r) && (!best || s.cost < best.cost)) best = { cost: s.cost, how: "vendor" };
  if (s?.k === "quest" && !otherFaction(r) && !best) best = { cost: 0, how: "quest" };
  return best || { cost: 0, unknown: true };
}
// Where a pattern comes from, for the step's tag and details.
function patternText(r, pc) {
  const s = r.src;
  if (pc?.how === "ah") return `pattern ${gold(pc.cost)} on AH`;
  if (s?.k === "vendor") return `pattern from ${esc(s.npc)}${s.faction && s.faction !== "Both" ? ` (${esc(s.faction)})` : ""}, ${gold(s.cost)}`;
  if (s?.k === "quest") return `pattern from the quest "${esc(s.quest)}"`;
  if (s?.k === "drop") return `pattern drops${s.from ? ` from ${esc(s.from)}` : ""}, not on the AH now`;
  if (s?.k === "new") return "new Forever pattern, source not in our data (Merchant's Favor vendors sell many)";
  return "pattern: vendor or drop, source not in our data";
}
// --- tools ------------------------------------------------------------------------------
// Recipes can need a tool (Blacksmith Hammer, Arclight Spanner, Gyromatic Micro-Adjustor, Runed rods…).
// The route gets each one once, the cheapest way: vendor, AH (not for bind-on-pickup rods) or crafting it.
const toolName = c => REC.tools?.categories?.[c]?.n || "tool";
function toolOptions(c) { return REC.tools?.categories?.[c]?.ok || []; }

// --- selling the results -------------------------------------------------------------
// Blizzard's API shows listings, not sales. The price job compares hourly snapshots and counts
// listings that disappeared before they could expire (data/sales.json), which gives units sold per
// day. You can expect to sell at most your share of that demand while you keep relisting; the price
// is the lower of the cheapest listing now and the average price things actually sold at, minus the
// 5% cut. Until there are MIN_HOURS of sales history it falls back to the listing-based guess:
// at most a quarter of the units currently listed, at the cheapest listing.
const AH_CUT = 0.95, SHARE = 0.5, MIN_HOURS = 6, ABSORB = 0.25;
// Prices move while you level and sell: a falling price is projected to the middle of your selling time
// (plus half a day to craft), and your share of sales shrinks when more than CROWD_DAYS of supply is listed.
const CROWD_DAYS = 2;
let SALES = null, TRENDS = null;
function salesInfo() {
  const fs = [state.faction, ...(state.neutral ? ["neutral"] : [])].map(f => SALES?.factions?.[f]).filter(Boolean);
  const hours = fs.length ? Math.min(...fs.map(f => f.hours || 0)) : 0;
  return { fs, hours, ok: hours >= MIN_HOURS };
}
function saleModel(book0) {
  const info = salesInfo();
  const sold = new Map(), made = new Map();
  const stats = new Map();
  const stat = id => {
    if (stats.has(id)) return stats.get(id);
    let units = 0, value = 0;
    for (const f of info.fs) for (const [, n, v] of f.items[id] || []) { units += n; value += v; }
    const s = { perDay: info.hours ? units / info.hours * 24 : 0, avg: units ? value / units : null };
    stats.set(id, s); return s;
  };
  const trends = new Map();
  const trend = id => trends.has(id) ? trends.get(id) : trends.set(id, marketTrend(TRENDS, SALES, state.faction, id)).get(id);
  const sellDays = state.wait / 2 + 0.5; // when the average unit sells: mid selling window, after crafting
  const ahUnit = id => {
    const now = minPrice(book0, id), avg = stat(id).avg;
    const p = now != null && avg != null ? Math.min(now, avg) : now ?? avg;
    return p == null ? null : Math.floor(projectPrice(p, trend(id), sellDays) * AH_CUT);
  };
  // days of supply on the AH: units listed / units sold per day
  const supplyDays = id => { const d = stat(id).perDay; const n = listed(book0, id); return d > 0 ? n / d : n > 0 ? Infinity : 0; };
  const cap = id => {
    if (info.ok) {
      const sd = supplyDays(id);
      const share = sd > CROWD_DAYS ? SHARE * CROWD_DAYS / sd : SHARE; // crowded market: you get less of it
      return Math.floor(stat(id).perDay * state.wait * share);
    }
    const n = listed(book0, id);
    return n ? Math.max(2, Math.floor(n * ABSORB)) : 0;
  };
  // value of selling `units` more of item id; commit=true records the sale
  function value(id, units, commit) {
    const vend = ITEMS[id]?.s || 0;
    const unit = ahUnit(id);
    const room = unit != null && unit > vend ? Math.max(0, cap(id) - (sold.get(id) || 0)) : 0;
    const onAh = Math.min(units, room);
    if (commit) { made.set(id, (made.get(id) || 0) + units); if (onAh) sold.set(id, (sold.get(id) || 0) + onAh); }
    return { vendor: vend * units, ah: onAh * unit + (units - onAh) * vend, onAh, unit };
  }
  // a later step used `units` of what was made: they are not sold after all
  function unsell(id, units, onAh) {
    made.set(id, Math.max(0, (made.get(id) || 0) - units));
    sold.set(id, Math.max(0, (sold.get(id) || 0) - onAh));
  }
  return { value, unsell, sold, made, ahUnit, stat, info, trend, supplyDays };
}

// --- fishing route --------------------------------------------------------------------------
// Highest fishing skill this character can reach: Journeyman (past 75) needs level 10, the Expert book
// (past 150) level 20, the Artisan quest (past 225) level 35.
function fishLevelCap() {
  let cap = 75;
  for (const k of FISH.ranks) if (state.level >= k.level) cap = k.cap;
  return cap;
}
const FISH_STICK = 0.15; // stay at the current spot unless another is 15% better per point (travel isn't free)
// One-time costs of the fishing ranks: Journeyman 5s at a trainer, the Expert book (AH or vendor), Artisan quest free.
function fishRankCost(k, book) {
  if (k.name === "Journeyman") return 500;
  if (k.book) { const c = [minPrice(book, k.book), FISH.items[k.book]?.v].filter(x => x != null); return c.length ? Math.min(...c) : 0; }
  return 0;
}
// Where to fish for each skill point. The skill-up rate doesn't depend on the spot, only on how many casts
// get away, so each point picks the spot (and lure) with the lowest: hours x your time value + lure cost − what
// the catch is worth. The catch is valued like crafts (AH share or vendor), or at what buying it would cost
// when the cooking route needs it (`want`).
// `cookWant` (Fishing + Cooking, "cook them first"): fish id -> {n, v}: fish the cooking route could cook where it
// now buys its reagents, and what those reagents cost per craft. Catching them is worth that much more, until
// n are caught, so the route goes where the next cooking steps' fish bite (catfish, trout…) like the guides.
function fishRoute(sales, want, cookWant = null) {
  const combined = state.prof === FISH_COOK;
  const from = Math.max(1, combined ? state.ffrom : state.from), to = Math.min(300, combined ? state.fto : state.to);
  const end = Math.min(to, fishLevelCap());
  const book = makeBook(PRICES, state.faction, state.neutral);
  const spots = openSpots(FISH, state.faction, state.level);
  const hourValue = Math.max(0, Number(state.hourValue) || 0) * 10000;
  const sec = Math.max(5, Number(state.castSec) || FISH_SECONDS);
  const unitCache = new Map();
  const unit = id => {
    if (unitCache.has(id)) return unitCache.get(id);
    const v = sales.value(id, 1, false);
    let u = state.sell === "ah" ? v.ah : state.sell === "vendor" ? v.vendor : 0;
    if (want?.get(id) > 0) { const c = [minPrice(BOOK0, id), ITEMS[id]?.v].filter(x => x != null); if (c.length) u = Math.max(u, Math.floor(Math.min(...c) * 0.9)); }
    unitCache.set(id, u); return u;
  };
  const yields = new Map(spots.map(sp => [sp, spotYield(sp)]));
  const cookLeft = new Map([...(cookWant || new Map())].map(([id, w]) => [id, w.n]));
  const bonus = id => (cookLeft.get(id) || 0) > 0 ? cookWant.get(id).v : 0;
  const perCatchNow = sp => yields.get(sp).reduce((a, [id, n]) => a + n * (unit(id) + bonus(id)), 0);
  const steps = []; let stuck = null, cost = 0;
  const ranks = [];
  for (const k of FISH.ranks) if (from < k.cap - 75 + 1 && end > k.cap - 75) { const c = fishRankCost(k, book); ranks.push({ ...k, at: k.cap - 75, cost: c }); cost += c; }
  if (from <= 1) cost += 100; // Apprentice Fishing
  let last = null;
  for (let s = from; s < end; s++) {
    const cpp = catchesPerPoint(FISH, s);
    const opts = lureOptions(FISH, book, s);
    let best = null, here = null;
    const perCatch = new Map(spots.map(sp => [sp, perCatchNow(sp)]));
    for (const sp of spots) for (const o of opts) {
      const p = catchChance(sp, s + Number(state.pole || 0) + o.bonus);
      if (p <= 0) continue;
      const casts = cpp / p, hours = casts * sec / 3600;
      const c = { sp, o, p, casts, hours, value: cpp * perCatch.get(sp), lure: hours * o.perHour };
      c.score = hours * hourValue + c.lure - c.value;
      if (!best || c.score < best.score) best = c;
      if (last && last.sp === sp && (!here || c.score < here.score)) here = c;
    }
    if (!best) { stuck = s; break; }
    // moving to another spot has to be worth it: 15% better per point, and at least half a minute of your time
    if (here && here.sp !== best.sp && here.score - best.score < Math.max(Math.abs(best.score) * FISH_STICK, hourValue / 120, 20)) best = here;
    const rankBreak = [75, 150, 225].includes(s) && last && last.from < s;
    if (!last || last.sp !== best.sp || (last.o.lure?.id ?? 0) !== (best.o.lure?.id ?? 0) || rankBreak) {
      last = { fish: true, sp: best.sp, o: best.o, from: s, to: s, casts: 0, catches: 0, hours: 0, lureCost: 0, lures: 0, p: best.p, items: new Map(), vendor: 0, ah: 0, onAh: 0, kept: 0, used: new Map() };
      steps.push(last);
    }
    last.to = s + 1; last.casts += best.casts; last.catches += cpp; last.hours += best.hours; last.lureCost += best.lure;
    if (best.o.lure) last.lures += best.hours * 60 / best.o.lure.mins;
    last.pEnd = best.p;
    for (const [id, n] of yields.get(best.sp)) if (cookLeft.has(id)) cookLeft.set(id, cookLeft.get(id) - n * cpp);
  }
  for (const st of steps) {
    st.lures = Math.ceil(st.lures); st.lureCost = st.o.lure ? st.lures * st.o.price : 0; cost += st.lureCost;
    for (const [id, n] of yields.get(st.sp)) { const u = Math.round(n * st.catches); if (u > 0) st.items.set(id, u); }
  }
  return { steps, ranks, cost, stuck, from, to, end, capped: end < to ? end : null, hours: steps.reduce((a, x) => a + x.hours, 0), casts: steps.reduce((a, x) => a + x.casts, 0), catches: steps.reduce((a, x) => a + x.catches, 0), sec };
}

// `future`: reagents (item id -> units) a first pass of the route used. Crafting those for skill-ups
// counts at what buying them would cost, and later steps use them up ("keep N for later"), like the
// written guides do with grinding stones, bolts and blasting powder.
// `usage`: skill points each recipe got in the first pass. A pattern or tool bought for a recipe is
// spread over those points (at least 1), so a pattern bought for 2 crafts carries its full price.
function plan(future = null, usage = null, cookWant = null) {
  const spread = r => Math.max(1, usage ? usage.get(r.id) ?? ONCE_SPREAD : ONCE_SPREAD);
  const prof = profData();
  BOOK0 = makeBook(PRICES, state.faction, state.neutral);
  const book = makeBook(PRICES, state.faction, state.neutral);
  const makers = new Map();
  const helpers = state.mining && prof.name !== "Mining" ? REC.professions.find(p => p.name === "Mining").recipes.map(r => ({ ...r, helper: true })) : [];
  for (const r of [...prof.recipes, ...helpers]) if (r.item) (makers.get(r.item) || makers.set(r.item, []).get(r.item)).push(r);
  const learned = new Map(); // recipe id -> pattern info (charged once)
  const steps = []; const shopping = new Map(); let total = 0, stuck = null;
  const sales = saleModel(BOOK0);
  let resaleVendor = 0, resaleAh = 0;
  const demand = new Map(); // reagents this route uses (for the next pass)
  const futureLeft = future ? new Map(future) : null;
  const timeCost = Math.max(0, Number(state.time) || 0) * 100; // silver per craft -> copper

  // --- inventory: what earlier steps made; later steps use it before buying more ---------------
  // Each lot remembers the sale credit already counted for it, so using it undoes that credit.
  const lots = new Map(); // item id -> [{st, n, vend, ah, onAh}] (credit per unit)
  seedOwned(lots); // "Materials I already have": free lots, first in line, so every step uses them before buying
  const inv = {
    qty: id => (lots.get(id) || []).reduce((a, l) => a + l.n, 0),
    // what a unit is worth if kept and sold instead (the cost of using it)
    // Caught fish in "Fishing + Cooking" (with "cook what I catch" on) count at their vendor price, so the
    // route cooks them; the totals still subtract what selling them raw would have paid.
    value: id => { const l = (lots.get(id) || []).find(x => x.n > 0); return !l ? 0 : lotUnit(l); },
    // total value of the next n units, in the order takeInv uses them (owned lots first, then step output)
    valueOf: (id, n) => {
      let sum = 0;
      for (const l of lots.get(id) || []) { if (n <= 0) break; const k = Math.min(n, l.n); if (k > 0) { sum += k * lotUnit(l); n -= k; } }
      return sum;
    },
  };
  function lotUnit(l) { return l.owned ? 0 : l.fish && state.cookCatch ? l.vend : state.sell === "ah" ? l.ah : state.sell === "vendor" ? l.vend : 0; }
  function takeInv(id, n, user) {
    for (const l of lots.get(id) || []) {
      if (n <= 0) break;
      const k = Math.min(n, l.n); if (!k) continue;
      l.n -= k; n -= k;
      l.st.vendor -= k * l.vend; l.st.ah -= k * l.ah; l.st.onAh -= k * l.onAh;
      resaleVendor -= k * l.vend; resaleAh -= k * l.ah;
      if (!l.owned) sales.unsell(id, k, k * l.onAh); // your own materials were never counted as sold
      l.st.kept += k;
      if (l.owned) takeOwned(l.st, user, id, k);
      else if (user && user !== l.st) user.used.set(id, (user.used.get(id) || 0) + k);
    }
  }
  // the output of n crafts of a step goes to the inventory, counted as sold unless a later step uses it
  function sellOutput(st, n) {
    if (!st.r.item || n <= 0) return;
    const units = st.r.qty * n;
    const v = sales.value(st.r.item, units, true);
    st.vendor += v.vendor; st.ah += v.ah; st.onAh += v.onAh;
    resaleVendor += v.vendor; resaleAh += v.ah;
    (lots.get(st.r.item) || lots.set(st.r.item, []).get(st.r.item)).push({ st, n: units, vend: v.vendor / units, ah: v.ah / units, onAh: v.onAh / units });
    if (futureLeft?.has(st.r.item)) futureLeft.set(st.r.item, Math.max(0, futureLeft.get(st.r.item) - units));
  }
  // An intermediate the route needs later is worth what buying it would cost (slightly less).
  const replaceUnit = id => {
    const c = [minPrice(BOOK0, id), ITEMS[id]?.v].filter(x => x != null);
    return c.length ? Math.floor(Math.min(...c) * 0.9) : 0;
  };

  // --- tools -----------------------------------------------------------------------------
  const owned = new Set();
  const hasTool = c => toolOptions(c).some(id => owned.has(id));
  function toolGet(ctx, c) {
    let best = null;
    for (const id of toolOptions(c)) {
      const a = acquire(ctx, id, 1, 0, !!REC.tools?.items?.[id]?.bop); // bind-on-pickup tools can't come from the AH
      if (a && (!best || a.cost < best.cost)) best = { ...a, id };
    }
    return best;
  }
  // one-time cost of the tools r needs that the route doesn't have yet; null = can't get one
  function toolsNeeded(ctx, r) {
    let cost = 0; const gets = [];
    for (const c of r.tools || []) {
      if (hasTool(c)) continue;
      const g = toolGet(ctx, c); if (!g) return null;
      cost += g.cost; gets.push([c, g]);
    }
    return { cost, gets };
  }

  // carry out an acquire() plan: take from inventory, buy from AH / vendor; returns the gold spent
  // (items from inventory cost no gold, their lost sale credit is handled by takeInv)
  function applyPlan(a, s, user) {
    let invCost = 0;
    for (const [kind, iid, qq, ic] of a.plan) {
      if (kind === "craft") continue;
      if (kind === "inv") { takeInv(iid, qq, user); invCost += ic || 0; continue; }
      if (kind === "ah") consume(book, iid, qq);
      const e = shopping.get(iid) || { id: iid, ah: 0, vendor: 0, pre: 0 };
      e[kind] += qq; if (s < 225) e.pre += qq; // bought before Artisan (level 35)
      shopping.set(iid, e);
    }
    return a.cost - invCost;
  }
  // buy + consume reagents for n crafts of r at skill s; returns gold spent
  function craft(r, n, s, st) {
    let spent = 0;
    for (let k = 0; k < n; k++) {
      const ctx2 = { book, makers, skill: s, inv, hasTool };
      for (const [id, q] of r.reagents) {
        const fromInv = Math.min(q, inv.qty(id)); // what the inventory covers isn't demand for the next pass
        if (q > fromInv) demand.set(id, (demand.get(id) || 0) + q - fromInv);
        const a = acquire(ctx2, id, q);
        if (a) spent += applyPlan(a, s, st);
      }
    }
    return spent;
  }
  // close a step: buy whatever whole crafts its expected count still needs
  function settle(st) {
    if (!st) return;
    const need = Math.max(1, Math.round(st.exp)) - st.crafts;
    if (need > 0) {
      const spent = craft(st.r, need, st.to - 1, st);
      st.crafts += need; st.cost += spent; total += spent; sellOutput(st, need);
    }
  }

  // --- fishing: the route's catches are sold like crafts, or kept for cooking ---------------------
  const fish = fishMode() ? fishRoute(sales, futureLeft, cookWant) : null;
  if (fish) {
    total += fish.cost;
    for (const st of fish.steps) for (const [id, units] of st.items) {
      if (units <= 0) continue;
      const v = sales.value(id, units, true);
      st.vendor += v.vendor; st.ah += v.ah; st.onAh += v.onAh;
      resaleVendor += v.vendor; resaleAh += v.ah;
      (lots.get(id) || lots.set(id, []).get(id)).push({ st, n: units, vend: v.vendor / units, ah: v.ah / units, onAh: v.onAh / units, fish: true });
    }
  }

  const end = state.prof === FISHING ? 0 : Math.min(300, state.to, levelCap());
  const rankFees = []; // [{name, cap, fee}] rank training paid along the route (null = not a trainer fee, e.g. a book)
  if (state.from <= 1 && REC.ranks?.[prof.name]?.Apprentice) total += REC.ranks[prof.name].Apprentice;
  for (let s = Math.max(1, state.from); s < end; ) {
    const ctx = { book, makers, skill: s, inv, hasTool };
    let best = null, bestFast = null, cur = null;
    const cands = []; // every usable recipe at this point (for the step's alternative)
    const prev = steps[steps.length - 1];
    for (const r of prof.recipes) {
      if (r.learn > s || s >= r.grey || !allowed(r)) continue;
      const c = chance(r, s); if (c <= 0) continue;
      let cost = 0, plan = [];
      for (const [id, q] of r.reagents) {
        const a = acquire(ctx, id, q);
        if (!a) { cost = null; break; }
        cost += a.cost; plan = plan.concat(a.plan);
      }
      if (cost == null) continue;
      const tools = r.tools ? toolsNeeded(ctx, r) : null;
      if (r.tools && !tools) continue; // needs a tool the route can't get yet
      // Credit for the result in the chosen selling mode. Vendor credit is capped so "almost free" crafts
      // don't win with 100 green crafts per point; AH credit is limited by what the market can absorb.
      let back = 0;
      if (r.item && state.sell !== "none") {
        const v = sales.value(r.item, r.qty, false);
        back = state.sell === "ah" && v.onAh > 0 ? v.ah : Math.min(v.vendor, cost * 0.75);
      }
      // an intermediate later steps need is worth what buying it would cost (up to what they need)
      const left = r.item ? futureLeft?.get(r.item) || 0 : 0;
      if (left > 0) {
        const u = Math.min(r.qty, left), rep = replaceUnit(r.item);
        if (rep) back = Math.max(back, Math.min(cost, u * rep + (r.qty - u) * (back / r.qty)));
      }
      const pat = learned.has(r.id) ? 0 : patternCost(book, r).cost;
      // cost per skill point. A profitable craft (net < 0) is scored by its profit per craft, not divided by
      // the skill-up chance, otherwise low-chance green recipes would look "better" the less they level you.
      const net = cost - back;
      const once = pat + (tools?.cost || 0); // pattern + tools: paid once
      const run = ((net >= 0 ? net / c : net) + timeCost / c) / r.ups; // per point, without one-time costs
      const per = run + once / spread(r); // one-time costs spread over the points this recipe gets
      const cand = { r, per, run, once, cost, back, c, plan, tools, slow: 1 / (c * r.ups) > MAX_CRAFTS_PER_POINT };
      // made from fish you caught (Fishing + Cooking): every fish it needs is in the catch you're carrying
      cand.ownFish = !!fish && r.reagents.some(([id]) => FISH_IDS.has(id)) && r.reagents.every(([id, q]) => !FISH_IDS.has(id) || inv.qty(id) >= q);
      cands.push(cand);
      if (!best || per < best.per) best = cand;
      if (!cand.slow && (!bestFast || per < bestFast.per)) bestFast = cand;
      if (prev && prev.r === r) cur = cand;
    }
    // Skip recipes that need more than MAX_CRAFTS_PER_POINT crafts per point while a faster one exists.
    if (state.fast && bestFast) best = bestFast;
    // "Cook the fish I catch first": a recipe made from your catch beats anything bought, as long as it still
    // gives skill-ups (and isn't a slow one while "avoid slow recipes" is on)
    if (fish && state.cookCatch) {
      const own = cands.filter(x => x.ownFish && !(state.fast && x.slow));
      if (own.length) {
        best = own.reduce((a, x) => x.per < a.per ? x : a);
        if (cur && !cur.ownFish) cur = null;
      }
    }
    // Keep crafting the current recipe unless the best one is clearly cheaper, so the route doesn't
    // switch back and forth for a few copper.
    // points a recipe can still be crafted for before it needs more than MAX_CRAFTS_PER_POINT crafts a point
    const room = rr => Math.max(0, Math.floor(rr.grey - (rr.grey - rr.yellow) / MAX_CRAFTS_PER_POINT) - s);
    if (best && cur && cur !== best && !(state.fast && cur.slow && bestFast)) {
      const gain = cur.per - best.per; // saved per skill point by switching
      const clearlyCheaper = gain > Math.max(Math.abs(best.per) * STICK, stickMin(s));
      // a short detour has to be worth it in total: what it saves over the points it can be used for
      // must beat MIN_RUN points of the minimum saving (unless the current recipe is about to run out)
      const worthIt = room(cur.r) < MIN_RUN || gain * Math.min(room(best.r), MIN_RUN * 4) >= stickMin(s) * MIN_RUN;
      if (!clearlyCheaper || !worthIt) best = cur;
    }
    if (!best) {
      // which reagents ran out?
      const miss = new Map();
      for (const r of prof.recipes) {
        if (r.learn > s || s >= r.grey || !allowed(r)) continue;
        for (const [id, q] of r.reagents) if (!acquire(ctx, id, q)) miss.set(id, (miss.get(id) || 0) + 1);
      }
      stuck = { s, miss: [...miss.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id]) => id) };
      break;
    }
    const { r } = best;
    // runner-up at this point: the cheapest other recipe (a fast one when "avoid slow recipes" is on)
    const others = cands.filter(x => x.r !== r);
    const pool = state.fast && others.some(x => !x.slow) ? others.filter(x => !x.slow) : others;
    const alt = pool.reduce((a, x) => !a || x.per < a.per ? x : a, null);
    let patPaid = 0;
    if (!learned.has(r.id)) {
      const pc = patternCost(book, r); learned.set(r.id, pc);
      if (pc.cost) { total += pc.cost; patPaid = pc.cost; if (pc.how === "ah") consume(book, pc.id, 1); }
    }
    // get the tools this recipe needs (once): buy them, or craft them with this profession
    const got = [];
    for (const [c, g] of best.tools?.gets || []) {
      if (hasTool(c)) continue;
      const cash = applyPlan(g, s, null);
      total += cash; owned.add(g.id);
      got.push({ id: g.id, c, cost: cash, how: g.plan.find(x => x[0] !== "inv")?.[0] || "inv" });
    }
    let last = steps[steps.length - 1];
    const rankBreak = last && last.from < s && RANKS.some(k => k.cap === s); // train here: start a new step
    for (const k of RANKS) if (s >= k.cap && state.from < k.cap && !rankFees.some(f => f.name === k.name)) {
      const fee = REC.ranks?.[prof.name]?.[k.name];
      rankFees.push({ name: k.name, cap: k.cap, fee: fee ?? null });
      if (fee) total += fee;
    }
    if (!last || last.r !== r || rankBreak) {
      settle(last);
      last = { r, from: s, to: s, crafts: 0, cost: 0, exp: 0, vendor: 0, ah: 0, onAh: 0, pattern: learned.get(r.id), kept: 0, used: new Map(), toolsGot: [], once: 0, patPaid: 0 };
      steps.push(last);
    }
    last.toolsGot.push(...got);
    // one-time costs belong to the step that pays them, so its cost and profit are honest
    const toolPaid = got.reduce((a, t) => a + t.cost, 0);
    last.cost += patPaid + toolPaid; last.once += patPaid + toolPaid; last.patPaid += patPaid;
    // the step's alternative: the runner-up at its first point; add up what it would cost over the step
    if (!last.alt && alt) last.alt = { r: alt.r, extra: 0, pts: 0, once: alt.once, slow: alt.slow, c: alt.c };
    if (last.alt) {
      const a = cands.find(x => x.r === last.alt.r);
      if (a) { last.alt.extra += (a.run - best.run) * r.ups; last.alt.pts += r.ups; }
    }
    // buy the whole crafts this step has "earned" so far, so later prices reflect what we bought
    last.exp += 1 / best.c; last.to = s + r.ups;
    const due = Math.floor(last.exp + 1e-9) - last.crafts;
    if (due > 0) {
      const spent = craft(r, due, s, last);
      last.crafts += due; last.cost += spent; total += spent; sellOutput(last, due);
    }
    s += r.ups;
  }
  settle(steps[steps.length - 1]);
  const sellList = [...sales.made.entries()].filter(([, m]) => m > 0).map(([id, made]) => {
    const n = sales.sold.get(id) || 0, unit = sales.ahUnit(id), vend = ITEMS[id]?.s || 0;
    return { id, made, n, unit, vend, stat: sales.stat(id), value: n * (unit || 0) + (made - n) * vend };
  }).sort((a, b) => b.value - a.value);
  const capped = state.prof === FISHING ? null : !stuck && end < Math.min(300, state.to) ? end : null; // character level stops the route
  const feeOf = name => rankFees.find(f => f.name === name);
  // Fishing + Cooking: cooking steps that buy their reagents where a fish recipe would also give skill-ups:
  // the fishing route of the next pass tries to catch those fish (see fishRoute's cookWant).
  let fishWant = null;
  if (fish && state.cookCatch) {
    fishWant = new Map();
    const fishRecipes = prof.recipes.filter(r => allowed(r) && r.reagents.some(([id]) => FISH_IDS.has(id)));
    for (const st of steps) {
      if (st.r.reagents.some(([id]) => FISH_IDS.has(id)) || !st.crafts) continue;
      const perCraft = st.cost / st.crafts;
      for (let k = st.from; k < st.to; k++) {
        let br = null, bc = 0;
        for (const r of fishRecipes) { if (r.learn > k || k >= r.grey) continue; const c = chance(r, k); if (c > bc) { bc = c; br = r; } }
        if (!br) continue;
        const [fid, q] = br.reagents.find(([id]) => FISH_IDS.has(id));
        const w = fishWant.get(fid) || fishWant.set(fid, { n: 0, v: 0 }).get(fid);
        w.v = (w.v * w.n + perCraft / bc) / (w.n + q / bc); w.n += q / bc;
      }
    }
  }
  return { fish, fishWant, steps, shopping: [...shopping.values()], total, resaleVendor, resaleAh, stuck, capped, rankFees, feeOf, book, sellList, salesInfo: sales.info, stat: sales.stat, trend: sales.trend, supplyDays: sales.supplyDays, demand,
    usage: steps.reduce((m, st) => m.set(st.r.id, (m.get(st.r.id) || 0) + (st.to - st.from)), new Map()) };
}

// Profit / loss: positive (green, "+") when you make money, negative (red, "−") when you lose it.
const pl = c => c == null || !isFinite(c) ? "—"
  : `<span class="${Math.round(c) > 0 ? "pos" : Math.round(c) < 0 ? "neg" : ""}">${Math.round(c) > 0 ? "+" : ""}${gold(c)}</span>`;

// Vendor and AH value of a step's crafts, side by side, each with the step's profit / loss under it.
const perDay = n => n >= 10 ? Math.round(n).toLocaleString("en-GB") : n >= 1 ? n.toFixed(1) : n > 0 ? n.toFixed(2) : "0";
function sellInfo(st, p) {
  if (!st.r.item) return null;
  const ahBetter = st.ah > st.vendor;
  const made = st.r.qty * st.crafts, rate = p.stat(st.r.item).perDay;
  const note = !p.salesInfo.ok ? (st.onAh ? `${st.onAh}/${made} on AH · guess from listings${st.ah > st.cost ? ' · <span class="profit">profit</span>' : ""}` : "not listed")
    : st.onAh ? `${st.onAh}/${made} on AH · ~${perDay(rate)}/day off the AH${st.ah > st.cost ? ' · <span class="profit">profit</span>' : ""}`
    : rate > 0 ? `~${perDay(rate)}/day off the AH, not above vendor` : "none sold";
  const tr = p.trend(st.r.item);
  const falling = tr && tr.perDay < -0.03 ? ` · price falling ${trendLabel(tr, true)}, priced for when you'd sell` : "";
  return { ahBetter, vendorBetter: !ahBetter && st.vendor > 0, note: note + falling };
}
// "Alternative" fact in a step's details: the runner-up recipe and what using it would change.
function altFact(st) {
  const a = st.alt; if (!a || !a.pts) return "";
  const r = a.r;
  const reag = r.reagents.map(([id, q]) => `${q} × ${esc(ITEMS[id]?.n || id)}`).join(", ");
  const diff = Math.round(a.extra);
  const stepPts = st.to - st.from;
  const span = a.pts < stepPts ? `over the ${a.pts} of ${stepPts} points where it still gives skill-ups` : `over these ${a.pts} points`;
  const cost = diff >= 0 ? `about ${gold(diff)} more ${span}` : `about ${gold(-diff)} cheaper ${span}; the route stays on one recipe rather than switching for a small saving`;
  const extras = [
    a.once > 0 ? `+ ${gold(a.once)} once for its ${r.source === "item" ? "pattern" : "tools"}` : "",
    r.source === "item" && !(a.once > 0) ? patternText(r, patternCost(BOOK0, r)) : "",
    a.c < 1 ? `${(1 / a.c).toFixed(1)} crafts per point` : "",
  ].filter(Boolean).join(" · ");
  return `<div class="alt-fact"><span class="k">Alternative</span><span>${r.item ? wh(r.item, r.name) : esc(r.name)}</span>
    <small>${reag}</small><small>${cost}${extras ? " · " + extras : ""}</small>
    <button class="chip" data-ex="${st.r.id}" title="Excludes ${esc(st.r.name)} from the whole route and re-plans">Use it instead</button></div>`;
}
// How a step's recipe is learned, as a short tag in the row and a sentence in the details:
// trainer (with the skill it is taught at and its fee), pattern (price or source, skill it can be used from),
// or known from the start.
function learnTag(st) {
  const r = st.r, at = r.learn;
  if (r.source === "auto") return ` <span class="tag learn" title="Every character knows this recipe">known from the start</span>`;
  if (r.source === "trainer") {
    const fee = st.patPaid ? ` · ${gold(st.patPaid)}` : r.train ? " · already learned" : " · fee not in our data";
    return ` <span class="tag learn train" title="Taught by your profession trainer">trainer · learn at skill ${at}${fee}</span>`;
  }
  if (r.source === "item") {
    const price = st.patPaid ? "pattern " + gold(st.patPaid) : st.pattern?.unknown ? "pattern: price unknown" : st.pattern?.how === "quest" ? "pattern: quest" : st.pattern?.cost ? "pattern: bought earlier" : "pattern";
    return ` <span class="tag pat" title="${esc(patternText(r, st.pattern).replace(/<[^>]+>/g, ""))}">${price} · usable at skill ${at}</span>`;
  }
  return "";
}
function learnText(st) {
  const r = st.r, at = r.learn;
  if (r.source === "auto") return "Known from the start (every character has it)";
  if (r.source === "trainer") return `From your ${esc(r.prof || state.prof)} trainer at skill ${at}${r.train ? `, costs ${gold(r.train)}` : ""}${st.patPaid ? " (paid on this step)" : r.train ? " (learned on an earlier step)" : ""}`;
  if (r.source === "item") return `${patternText(r, st.pattern)}; usable from skill ${at}`;
  return `Learn at skill ${at}`;
}
const OPEN_STEPS = new Set(); // expanded step rows (not saved)

const hrs = h => h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : `${Math.floor(h)} h ${String(Math.round((h % 1) * 60)).padStart(2, "0")} min`;
// Fishing route table: one row per spot (and lure), with "Train" rows at each rank.
function renderFish(p) {
  const f = p.fish, retVendor = state.sell === "vendor";
  $("#fishRetHead").textContent = retVendor ? "Vendor value" : state.sell === "none" ? "Catch (not counted)" : "AH value (est.)";
  const worth = f.steps.reduce((a, st) => a + (retVendor ? st.vendor : st.ah), 0);
  const lures = f.steps.reduce((a, st) => a + st.lureCost, 0);
  $("#fishSummary").innerHTML = `
    <div class="pick sum-main"><span class="eyebrow">Fishing ${f.from} → ${f.stuck ?? f.end}</span><b>${hrs(f.hours)}</b><small>${Math.round(f.casts).toLocaleString("en-GB")} casts at ${f.sec} s, ${Math.round(f.catches).toLocaleString("en-GB")} catches</small></div>
    <div class="sum-stats">
      <div><span class="eyebrow">Catch worth</span><b>${state.sell === "none" ? "—" : gold(worth)}</b><small>${state.prof === FISH_COOK ? "after the fish kept for cooking" : retVendor ? "at the vendor" : "AH share + vendor (est.)"}</small></div>
      <div><span class="eyebrow">Lures + ranks</span><b>${gold(f.cost)}</b><small>lures ${gold(lures)}</small></div>
      <div><span class="eyebrow">Per hour</span><b>${state.sell === "none" || !f.hours ? "—" : pl((worth - f.cost) / f.hours)}</b><small>while leveling</small></div>
    </div>`;
  $("#fishStuck").innerHTML = f.stuck != null ? `<p class="warn">Stops at ${f.stuck}: no spot your character level allows catches anything at this skill.</p>`
    : f.capped ? `<p class="warn">Stops at ${f.capped}: the next fishing rank needs character level ${FISH.ranks.find(k => k.cap - 75 === f.capped)?.level}. Change "Character level" under More options.</p>` : "";
  const rankRow = k => `<tr class="train"><td class="num rng">${k.at}</td><td colspan="5"><b>${k.name} Fishing</b> before skill ${k.at} <span class="meta">needs skill ${k.skill} and level ${k.level} · ${esc(k.how)}${k.cost ? ` · ${gold(k.cost)}` : k.quest ? " · free" : ""}</span></td></tr>`;
  const done = new Set();
  // other spots with exactly the same catch at the same skill: fish whichever is convenient
  const open = openSpots(FISH, state.faction, state.level);

  $("#fishSteps").innerHTML = f.steps.map(st => {
    let pre = "";
    for (const k of f.ranks) if (!done.has(k.name) && st.from >= k.at) { done.add(k.name); pre += rankRow(k); }
    const sp = st.sp;
    const top = [...st.items.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id, n]) => `${n.toLocaleString("en-GB")} ${wh(id, ITEMS[id]?.n || FISH.items[id]?.n || id)}`).join(", ");
    const away = Math.round((1 - st.p) * 100), awayEnd = Math.round((1 - (st.pEnd ?? st.p)) * 100);
    const lure = st.o.lure ? `<span class="tag toolget">use ${wh(st.o.lure.id, ITEMS[st.o.lure.id]?.n || FISH.items[st.o.lure.id]?.n)} (+${st.o.bonus})</span> ` : "";
    const kept = Math.round(st.kept);
    const val = retVendor ? st.vendor : st.ah;
    return pre + `<tr><td class="num rng">${st.from}–${st.to}</td>
      <td><b>${esc(sp.name)}</b> <span class="tag">level ${sp.levels[0]}–${sp.levels[1]}</span> ${lure}${kept ? `<span class="tag keep">keep ${kept} for cooking</span>` : ""}
        <div class="meta">${away || awayEnd ? `${away === awayEnd ? away : `${away}→${awayEnd}`}% get away · ` : ""}none get away at ${sp.full}</div>
        <div class="meta">${top}</div>${(o => o.length ? `<div class="meta">Same catch: ${sameCatchText(FISH, ITEMS, o, esc)}</div>` : "")(sameCatch(open, sp))}</td>
      <td class="num">${Math.round(st.catches).toLocaleString("en-GB")}<small>${Math.round(st.casts).toLocaleString("en-GB")} casts</small></td>
      <td class="num">${hrs(st.hours)}</td>
      <td class="num">${st.lureCost ? gold(st.lureCost) : "—"}${st.lures ? `<small>${st.lures} × ${st.o.lure.mins} min</small>` : ""}</td>
      <td class="num">${state.sell === "none" ? "—" : gold(val)}${st.lureCost ? `<small>${pl(val - st.lureCost)}</small>` : ""}</td></tr>`;
  }).join("") + f.ranks.filter(k => !done.has(k.name)).map(rankRow).join("") || `<tr><td colspan="6" class="empty">Nothing to plan.</td></tr>`;
}

// Shopping-list export. Auctionator's import box (Shopping tab → Import) takes one list per line:
// `List name^term^term…`, where each term is an advanced search string of 14 ";"-separated fields:
// query;category;minItemLevel;maxItemLevel;minLevel;maxLevel;minCraftedLevel;maxCraftedLevel;
// minPrice;maxPrice;quality;tier;expansion;quantity. A query wrapped in "" is an exact-name search,
// tier "#" means none, empty fields mean any. Source (Auctionator v284, Classic build):
// Source/Shopping/ImportExport.lua (GetBatchExportString / BatchImportFromString split on "\n" and "^"),
// Source/Search/Advanced.lua (SplitAdvancedSearch / ReconstituteAdvancedSearch), Constants/Main.lua
// (AdvancedSearchDivider = ";"), mirrored at
// https://github.com/zhaochengw/WOW-AddOns-Classic/tree/HEAD/Auctionator/Source (upstream Auctionator repo is no longer on GitHub).
let EXPORT = { auc: "", txt: "" };
const aucTerm = (name, qty) => [`"${name}"`, "", "", "", "", "", "", "", "", "", "", "#", "", qty].join(";");
function shopExport(shop, listName) {
  const name = id => ITEMS[id]?.n;
  // "^", ";" and line breaks are the format's separators, so keep them out of names.
  const clean = s => String(s).replace(/[\^;\r\n"]/g, " ").trim();
  const ah = shop.filter(e => e.ah > 0 && name(e.id));
  const auc = ah.length ? [clean(listName), ...ah.map(e => aucTerm(clean(name(e.id)), e.ah))].join("^") : "";
  const lines = [
    ...ah.map(e => `${e.ah}x ${name(e.id)}`),
    ...shop.filter(e => e.vendor > 0).map(e => `${e.vendor}x ${name(e.id) || "item " + e.id} (vendor)`),
  ];
  return { auc, txt: lines.length ? `${listName}\n${lines.join("\n")}` : "" };
}

let copyTimer = 0;
async function copyText(text) {
  if (!text) return;
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch { /* insecure context or denied: fall back */ }
  if (!ok) {
    const ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    ta.remove();
  }
  const msg = $("#copyMsg");
  msg.textContent = ok ? "Copied" : "Couldn't copy: press Ctrl+C on the selected text below";
  // Last resort: show the text (whichever button was pressed) in the box, selected, for a manual copy.
  if (!ok) { $("details.export").open = true; const box = $("#aucStr"); box.value = text; box.focus(); box.select(); }
  clearTimeout(copyTimer); copyTimer = setTimeout(() => { msg.textContent = ""; }, 2000);
}

function render() {
  if (!PRICES || !REC) return;
  syncHash(); // keep the address bar's share link in step with the settings
  const prof = profData();
  $("#market").textContent = `${PRICES.region} · ${PRICES.ruleset.name} · ${PRICES.factions[state.faction].house.name}${state.neutral ? " + Blackwater" : ""}`;
  // station toggles for this profession
  const stations = [...new Set(prof.recipes.map(r => r.needs).filter(Boolean))].sort();
  $("#stations").innerHTML = stations.length ? stations.map(n => `<label class="chk"><input type="checkbox" data-station="${esc(n)}" ${state.stationsOff.has(n) ? "" : "checked"}> ${esc(n)}</label>`).join("") : `<span class="muted">None needed</span>`;

  const t0 = performance.now();
  const p1 = plan();
  const p = plan(p1.demand, p1.usage, p1.fishWant); // second pass knows which intermediates the route needs later and how long each recipe is used
  const fishOnly = state.prof === FISHING, combined = state.prof === FISH_COOK;
  $("#fishPanel").hidden = !p.fish;
  $("#routePanel").hidden = $("#shopPanel").hidden = fishOnly;
  $("#fishCtl").hidden = !p.fish; $("#stationsCtl").hidden = fishOnly;
  document.querySelectorAll(".fish-both").forEach(e => { e.hidden = !combined; });
  $("#fromLbl").textContent = combined ? "Cooking from skill" : "From skill";
  $("#toLbl").textContent = combined ? "Cooking to skill" : "To skill";
  if (p.fish) renderFish(p);
  // The answer for the chosen selling mode is the big number; the other totals sit beside it.
  const sums = {
    none: { big: `Materials${state.patterns !== "trainer" ? " + patterns" : ""} cost`, small: "Materials", val: pl(-p.total), sub: "what you spend" },
    vendor: { big: "Profit / loss if you vendor everything", small: "If you vendor", val: pl(p.resaleVendor - p.total), sub: `vendor sales ${gold(p.resaleVendor)}` },
    ah: { big: "Profit / loss if you sell on the AH", small: "If you sell on AH", val: pl(p.resaleAh - p.total), sub: `AH + vendor sales ${gold(p.resaleAh)} (est.)` },
  };
  if (fishOnly) { sums.none.big = "Lures + ranks cost"; sums.vendor.big = "Profit if you vendor the catch"; sums.ah.big = "Profit if you sell the catch on the AH"; }
  const main = sums[state.sell] || sums.none;
  const rest = ["none", "vendor", "ah"].filter(k => sums[k] !== main).map(k => sums[k]);
  $("#summary").innerHTML = `
    <div class="pick sum-main"><span class="eyebrow">${main.big}</span><b>${main.val}</b><small>${main.sub}</small></div>
    <div class="sum-stats">
      ${rest.map(x => `<div><span class="eyebrow">${x.small}</span><b>${x.val}</b><small>${x.sub}</small></div>`).join("")}
      ${fishOnly ? "" : `<div><span class="eyebrow">Crafts</span><b>${p.steps.reduce((a, s) => a + s.crafts, 0).toLocaleString("en-GB")}</b></div>
      <div><span class="eyebrow">${combined ? "Cooking" : "Skill"}</span><b>${state.from} → ${p.stuck ? p.stuck.s : p.capped ?? state.to}</b></div>`}
      ${p.fish ? `<div><span class="eyebrow">Fishing</span><b>${p.fish.from} → ${p.fish.stuck ?? p.fish.end}</b><small>${hrs(p.fish.hours)} · ${Math.round(p.fish.catches).toLocaleString("en-GB")} catches</small></div>` : ""}
    </div>`;
  const nextRank = p.capped ? RANKS.find(k => k.cap === p.capped) : null;
  $("#stuck").innerHTML = p.stuck ? `<p class="warn">Stopped at ${p.stuck.s}: the auction house doesn't have enough ${p.stuck.miss.map(id => wh(id, ITEMS[id]?.n || id)).join(", ") || "reagents"} for the remaining recipes. Try "I can smelt", Blackwater, more recipes or stations — or farm those yourself.</p>`
    : nextRank ? `<p class="warn">Stops at ${p.capped}: ${nextRank.name} ${esc(prof.name)} needs character level ${nextRank.level} (you set ${state.level}). Change "Character level" under More options to plan further.</p>` : "";

  // Steps: the row shows what to craft, its reagents, cost and what you get back in the chosen mode.
  // Skill colours, the other selling mode, sales notes and recipe tags live in the expandable detail row.
  const retVendor = state.sell === "vendor";
  $("#retHead").textContent = retVendor ? "Vendor value" : "AH value (est.)";
  // When selling on the AH, the vendor value sits next to it so you can compare (the better one is green).
  const showVend = !retVendor;
  $("#vendHead").hidden = !showVend;
  $("#stepsTable").classList.toggle("with-vendor", showVend);
  const cols = showVend ? 6 : 5;
  const trained = new Set();
  $("#steps").innerHTML = p.steps.map(st => {
    const r = st.r, key = `${r.id}@${st.from}`, open = OPEN_STEPS.has(key);
    // "Train the next rank" row before the first step past each rank cap
    let train = "";
    for (const k of RANKS) {
      if (trained.has(k.name) || st.from < k.cap || state.from >= k.cap) continue;
      trained.add(k.name);
      train += `<tr class="train"><td class="num rng">${k.cap}</td><td class="c-craft" colspan="${cols - 1}"><b>Train ${k.name} ${esc(prof.name)}</b> before skill ${k.cap}
        <span class="meta">needs skill ${k.skill} and level ${k.level} · ${esc(trainerFor(prof.name, k.name))}${(f => !f ? "" : f.fee ? ` · fee ${gold(f.fee)}` : " · no trainer fee (book or quest)")(p.feeOf(k.name))}</span></td></tr>`;
    }
    const reag = r.reagents.map(([id, q]) => `${q} × ${wh(id, ITEMS[id]?.n || id)}`).join(", ");
    const pattern = r.source === "item" ? patternText(r, st.pattern) : "";
    // tools: what this step needs, and which ones the route gets right here (first time they're needed)
    const toolsGot = st.toolsGot.map(t => `${t.how === "craft" ? "craft" : t.how === "vendor" ? "buy (vendor)" : t.how === "ah" ? "buy (AH)" : "use"} ${wh(t.id, ITEMS[t.id]?.n || toolName(t.c))}${t.cost ? " " + gold(t.cost) : ""}`);
    const toolsNeed = (r.tools || []).map(toolName);
    // inventory: made here and used later / made earlier and used here
    const used = [...st.used.entries()].map(([id, n]) => `${n} × ${esc(ITEMS[id]?.n || id)}`);
    const kept = Math.round(st.kept);
    const fromBags = bagsTag(st); // "Materials I already have" this step uses
    const name = r.item ? wh(r.item, r.name) : esc(r.name);
    const s = sellInfo(st, p);
    const vend = !showVend ? "" : !s ? `<td class="num c-vend"><span class="muted">—</span></td>`
      : `<td class="num c-vend${s.vendorBetter ? " better" : ""}" data-label="Vendor">${gold(st.vendor)}<small>${pl(st.vendor - st.cost)}</small></td>`;
    const ret = !s ? `<td class="num c-ret"><span class="muted">—</span></td>`
      : `<td class="num c-ret${(retVendor ? s.vendorBetter : s.ahBetter) ? " better" : ""}" data-label="${retVendor ? "Vendor" : "AH"}">${gold(retVendor ? st.vendor : st.ah)}<small>${pl((retVendor ? st.vendor : st.ah) - st.cost)}</small></td>`;
    let html = train + `<tr class="row${open ? " open" : ""}" data-key="${key}" tabindex="0" aria-expanded="${open}">
      <td class="num rng">${st.from}–${st.to}</td>
      <td class="c-craft"><b>${st.crafts} × ${name}</b>${learnTag(st)}<div class="meta">${reag}${r.needs ? ` · needs ${esc(r.needs)}` : ""}${toolsNeed.length ? ` · needs ${toolsNeed.map(esc).join(", ")}` : ""}</div>${
        toolsGot.length || kept || used.length || fromBags ? `<div class="meta step-notes">${toolsGot.length ? `<span class="tag toolget">first: ${toolsGot.join(", ")}</span> ` : ""}${fromBags}${used.length ? `<span class="tag inv">uses ${used.join(", ")} from earlier steps</span> ` : ""}${kept ? `<span class="tag keep">keep ${kept} for later steps</span>` : ""}</div>` : ""}</td>
      <td class="num c-cost" data-label="Cost">${gold(st.cost)}${st.once ? `<small>incl. ${[st.patPaid ? (r.source === "trainer" ? "training " : "pattern ") + gold(st.patPaid) : "", st.once - st.patPaid > 0 ? "tools " + gold(st.once - st.patPaid) : ""].filter(Boolean).join(", ")}</small>` : ""}</td>
      ${vend}${ret}
      <td class="num c-x"><button class="x" data-ex="${r.id}" title="Exclude this recipe and re-plan" aria-label="Exclude ${esc(r.name)} and re-plan">✕</button></td>
    </tr>`;
    if (open) {
      const tags = [

        r.needs ? `<span class="tag">${esc(r.needs)}</span>` : "",
        r.isNew ? `<span class="tag new">new in Forever</span>` : "",
        r.est ? `<span class="tag">trainer skill est.</span>` : "",
      ].filter(Boolean).join(" ");
      html += `<tr class="detail"><td colspan="${cols}"><div class="facts">
        <div><span class="k">How to learn</span><span>${learnText(st)}</span></div>
        <div><span class="k">Skill-up colours</span><span>learn ${r.learn} · <span class="o">${r.yellow}</span> <span class="y">${r.green}</span> <span class="gr">${r.grey}</span></span></div>
        ${pattern ? `<div><span class="k">Pattern</span><span>${pattern}</span></div>` : ""}
        ${toolsNeed.length ? `<div><span class="k">Tools</span><span>${toolsNeed.map(esc).join(", ")}</span><small>bought or made once, the first time a step needs them</small></div>` : ""}
        ${altFact(st)}
        <div><span class="k">Crafts per point</span><span>${(st.crafts / Math.max(1, st.to - st.from)).toFixed(1)}</span><small>${st.crafts} crafts for ${st.to - st.from} points</small></div>
        ${s ? `<div class="${s.vendorBetter ? "better" : ""}"><span class="k">Vendor everything</span><span>${gold(st.vendor)}</span><small>${pl(st.vendor - st.cost)}</small></div>
        <div class="${s.ahBetter ? "better" : ""}"><span class="k">Sell on the AH (est.)</span><span>${gold(st.ah)}</span><small>${pl(st.ah - st.cost)} · ${s.note}</small></div>` : ""}
        ${tags ? `<div><span class="k">Recipe</span><span>${tags}</span></div>` : ""}
      </div></td></tr>`;
    }
    return html;
  }).join("") || `<tr><td colspan="${cols}" class="empty">Nothing to plan.</td></tr>`;
  const si = p.salesInfo;
  $("#salesnote").innerHTML = !SALES ? "Sales data could not be loaded, so everything is valued at vendor price."
    : si.ok ? `Sales measured over the last <b>${Math.round(si.hours)} h</b> of snapshots${si.hours < 48 ? " — still a short window, so treat daily rates as rough" : ""}.`
    : `<b>Not enough sales history yet</b> (${si.hours.toFixed(1)} of ${MIN_HOURS} h). Until then AH sales use the old guess: up to a quarter of what is listed now, at the cheapest listing. Measured sales per day take over automatically.`;
  const n0 = x => x.toLocaleString("en-GB");
  $("#sell").innerHTML = p.sellList.length
    ? p.sellList.map(e => {
        const days = e.n && e.stat.perDay ? e.n / (e.stat.perDay * SHARE) : 0;
        return `<tr><td>${wh(e.id, ITEMS[e.id]?.n || e.id)}</td><td class="num">${n0(e.made)}</td>
          <td class="num">${si.ok ? perDay(e.stat.perDay) : '<span class="muted">collecting</span>'}<small>${n0(listed(BOOK0, e.id))} listed</small></td>
          <td class="num${e.n ? " better" : ""}">${n0(e.n)}${e.n && si.ok ? `<small>~${days < 1 ? "<1" : days.toFixed(1)} days</small>` : ""}</td>
          <td class="num">${e.unit != null ? gold(e.unit) : "—"}${trendLabel(p.trend(e.id), true)}${e.stat.avg != null ? `<small>sold avg ${gold(Math.round(e.stat.avg))}</small>` : ""}${si.ok && p.supplyDays(e.id) > CROWD_DAYS ? `<small class="neg">${p.supplyDays(e.id) === Infinity ? "nothing sold" : Math.round(p.supplyDays(e.id)) + " days of supply listed"}</small>` : ""}</td>
          <td class="num">${gold(e.vend)}</td>
          <td class="num">${gold(e.value)}</td></tr>`;
      }).join("")
    : `<tr><td colspan="7" class="empty">This route makes nothing that can be sold.</td></tr>`;

  const shop = p.shopping.filter(e => e.ah || e.vendor).sort((a, b) => (b.ah + b.vendor) - (a.ah + a.vendor));
  // Artisan (past 225) needs level 35, so say how much of each item is needed before that.
  const split = state.from < 225 && p.steps.some(st => st.to > 225);
  $("#shop").innerHTML = shop.map(e => `<tr><td>${wh(e.id, ITEMS[e.id]?.n || e.id)}${split ? `<small>${e.pre === e.ah + e.vendor ? "all before skill 225" : e.pre ? `${e.pre.toLocaleString("en-GB")} before skill 225` : "only after 225"}</small>` : ""}</td>
      <td class="num">${e.ah ? e.ah.toLocaleString("en-GB") : ""}</td><td class="num">${e.vendor ? e.vendor.toLocaleString("en-GB") : ""}</td>
      <td class="num">${e.ah ? `${listed(makeBook(PRICES, state.faction, state.neutral), e.id).toLocaleString("en-GB")} listed` : `vendor ${gold(ITEMS[e.id]?.v)}`}</td></tr>`).join("");
  const last = p.steps.length ? Math.min(p.steps[p.steps.length - 1].to, state.to) : state.from;
  EXPORT = shopExport(shop, `WFF ${prof.name} ${state.from}-${last}`);
  $("#aucStr").value = EXPORT.auc;
  $("#copyAuc").disabled = !EXPORT.auc; $("#copyTxt").disabled = !EXPORT.txt;
  renderOwned(); // "have N" on the shopping list, owned items the route needs but doesn't buy, the box's hint
  $("#excl").innerHTML = state.excluded.size ? `Excluded: ${[...state.excluded].map(id => { const r = prof.recipes.find(x => x.id === id); return r ? `<button class="chip" data-unex="${id}">${esc(r.name)} ✕</button>` : ""; }).join(" ")}` : "";
  $("#perf").textContent = `Planned in ${Math.round(performance.now() - t0)} ms`;
}

function bind() {
  bindFaction(state, render);
  const sel = $("#prof");
  const set = (k, v) => { state[k] = v; store.set(k === "neutral" ? "neutral" : "lv:" + k, v); render(); };
  sel.onchange = () => set("prof", sel.value);
  $("#from").oninput = e => set("from", Math.max(1, Math.min(299, Number(e.target.value) || 1)));
  $("#to").oninput = e => set("to", Math.max(2, Math.min(300, Number(e.target.value) || 300)));
  $("#patterns").onchange = e => { store.set("lv:patternsV2", true); set("patterns", e.target.value); };
  $("#time").oninput = e => set("time", Math.max(0, Number(e.target.value) || 0));
  $("#level").oninput = e => set("level", Math.max(1, Math.min(60, Number(e.target.value) || 60)));
  $("#fast").onchange = e => set("fast", e.target.checked);
  $("#sellmode").onchange = e => set("sell", e.target.value);
  $("#wait").onchange = e => set("wait", Number(e.target.value));
  $("#mining").onchange = e => set("mining", e.target.checked);
  $("#ffrom").oninput = e => set("ffrom", Math.max(1, Math.min(299, Number(e.target.value) || 1)));
  $("#fto").oninput = e => set("fto", Math.max(2, Math.min(300, Number(e.target.value) || 300)));
  $("#pole").onchange = e => set("pole", Number(e.target.value));
  $("#castsec").oninput = e => set("castSec", Math.max(5, Math.min(40, Number(e.target.value) || FISH_SECONDS)));
  $("#hourval").oninput = e => set("hourValue", Math.max(0, Number(e.target.value) || 0));
  $("#cookcatch").onchange = e => set("cookCatch", e.target.checked);
  $("#neutral").onchange = e => set("neutral", e.target.checked);
  $("#stations").onchange = e => {
    const n = e.target.dataset.station; if (!n) return;
    e.target.checked ? state.stationsOff.delete(n) : state.stationsOff.add(n);
    store.set("lv:stationsOff", [...state.stationsOff]); render();
  };
  const toggle = tr => { const k = tr.dataset.key; OPEN_STEPS.has(k) ? OPEN_STEPS.delete(k) : OPEN_STEPS.add(k); render(); $(`#steps tr.row[data-key="${k}"]`)?.focus(); };
  $("#steps").onclick = e => {
    const id = Number(e.target.dataset?.ex);
    if (id) { state.excluded.add(id); store.set("lv:excluded", [...state.excluded]); render(); return; }
    const tr = e.target.closest("tr.row");
    if (tr && !e.target.closest("a, button")) toggle(tr);
  };
  $("#steps").onkeydown = e => { const tr = e.target.closest("tr.row"); if (tr && e.target === tr && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); toggle(tr); } };
  $("#copyAuc").onclick = () => copyText(EXPORT.auc);
  $("#copyTxt").onclick = () => copyText(EXPORT.txt);
  $("#excl").onclick = e => { const id = Number(e.target.dataset?.unex); if (id) { state.excluded.delete(id); store.set("lv:excluded", [...state.excluded]); render(); } };
}

// --- materials I already have ---------------------------------------------------------------
// Pasted lines ("20x Linen Cloth", "Linen Cloth x20", "Linen Cloth 20", "20 Linen Cloth") become inventory
// lots worth nothing (you own them already), put first in line by plan(), so steps use them before vendor,
// AH or crafting. BAGS records what the last plan() took from them (render's second pass, the one shown).
let NAME_IDX = null, OWNED_CACHE = null, BAGS = null;
const normName = s => String(s).toLowerCase().replace(/[’‘`]/g, "'").replace(/\s+/g, " ").trim();
function nameIndex() {
  if (NAME_IDX) return NAME_IDX;
  const reagents = new Set(REC.professions.flatMap(p => p.recipes.flatMap(r => r.reagents.map(([id]) => id))));
  NAME_IDX = new Map();
  for (const [k, it] of Object.entries(ITEMS)) {
    if (!it?.n) continue;
    const id = Number(k), key = normName(it.n), cur = NAME_IDX.get(key);
    if (cur == null || (!reagents.has(cur) && reagents.has(id))) NAME_IDX.set(key, id); // same name twice: the one recipes use
  }
  return NAME_IDX;
}
// -> {items: Map(item id -> units), bad: [lines that match no item]}
function parseOwned(text) {
  const idx = nameIndex(), items = new Map(), bad = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.replace(/^[\s\-*•·]+/, "").replace(/[[\]]/g, "").trim();
    if (!line) continue;
    const tries = [
      [/^(\d+)\s*[x×*]\s*(.+)$/i, 2, 1], // 20x Linen Cloth
      [/^(\d+)\s+(.+)$/, 2, 1], // 20 Linen Cloth
      [/^(.+?)\s*[x×*]\s*(\d+)$/i, 1, 2], // Linen Cloth x20
      [/^(.+?)(?:\s*[:,;=\t]\s*|\s+)(\d+)$/, 1, 2], // Linen Cloth 20, Linen Cloth: 20
    ];
    let hit = null;
    for (const [re, ni, qi] of tries) {
      const m = line.match(re); if (!m) continue;
      const id = idx.get(normName(m[ni])), q = Number(m[qi]);
      if (id != null && q > 0) { hit = [id, Math.min(q, 1e6)]; break; }
    }
    if (!hit && idx.has(normName(line))) hit = [idx.get(normName(line)), 1]; // a name alone counts as 1
    if (hit) items.set(hit[0], (items.get(hit[0]) || 0) + hit[1]);
    else bad.push(raw.trim());
  }
  return { items, bad };
}
function ownedParsed() {
  if (!ITEMS || !REC) return { items: new Map(), bad: [] };
  if (OWNED_CACHE?.text !== state.owned) OWNED_CACHE = { text: state.owned, ...parseOwned(state.owned) };
  return OWNED_CACHE;
}
// plan(): put the owned units in the inventory before anything else (no sale credit to give up)
function seedOwned(lots) {
  BAGS = { bags: true, vendor: 0, ah: 0, onAh: 0, kept: 0, used: new Map(), taken: new Map() };
  for (const [id, n] of ownedParsed().items) lots.set(id, [{ st: BAGS, n, vend: 0, ah: 0, onAh: 0, owned: true }]);
}
// plan()'s takeInv: k owned units of id went to step `user` (null for tools)
function takeOwned(bags, user, id, k) {
  bags.taken.set(id, (bags.taken.get(id) || 0) + k);
  if (user) (user.bags ||= new Map()).set(id, (user.bags.get(id) || 0) + k);
}
function bagsTag(st) {
  if (!st.bags?.size) return "";
  return `<span class="tag bags">uses ${[...st.bags].map(([id, n]) => `${n.toLocaleString("en-GB")} × ${esc(ITEMS[id]?.n || id)}`).join(", ")} from your bags</span> `;
}
// Shopping list: "have N" next to bought items, rows for owned items the route needs but doesn't buy;
// and the hint under the box (what was recognised, what the route uses, lines that match nothing).
function renderOwned() {
  const { items, bad } = ownedParsed();
  const taken = BAGS?.taken || new Map();
  const tbody = $("#shop");
  const cols = tbody.closest("table")?.querySelectorAll("thead th").length || 4;
  const n0 = x => x.toLocaleString("en-GB");
  const extra = [];
  for (const [id, n] of taken) {
    const have = items.get(id) || 0;
    const note = `<small class="pos">have ${n0(have)}${n < have ? `, the route uses ${n0(n)}` : ""}</small>`;
    const a = tbody.querySelector(`a[href="https://www.wowhead.com/forever/item=${id}"]`);
    if (a) a.closest("td").insertAdjacentHTML("beforeend", note);
    else extra.push(`<tr class="owned-row"><td>${wh(id, ITEMS[id]?.n || id)}${note}</td><td colspan="${cols - 1}"><span class="muted">nothing to buy</span></td></tr>`);
  }
  tbody.insertAdjacentHTML("beforeend", extra.join(""));
  const unused = [...items.keys()].filter(id => !taken.has(id)).map(id => esc(ITEMS[id]?.n || id));
  const more = (list, k) => list.slice(0, k).join(", ") + (list.length > k ? ` and ${list.length - k} more` : "");
  const parts = [];
  if (items.size) parts.push(`${items.size} item${items.size === 1 ? "" : "s"} recognised, ${taken.size ? `${taken.size} used by this route` : "none used by this route"}.`);
  if (unused.length && taken.size) parts.push(`Not used: ${more(unused, 8)}.`);
  if (bad.length) parts.push(`<span class="neg">No item called: ${more(bad.map(esc), 6)}.</span>`);
  $("#ownedHint").innerHTML = parts.join(" ");
}

// --- share link: the plan's settings in the address (#p=Tailoring&from=1&to=300&…) -----------------
// Opening such a link overrides the saved settings (and saves them). Owned materials go in only while the
// list is short; without "own" in the link the reader's own list stays. Crafting stations aren't included.
const POLES = [0, 5, 20, 25, 35];
const isPlanHash = h => /(^|&)p=/.test(h);
let HASH_LIVE = false; // the first render writes the address only when the page was opened with a plan link
function ownedHashPart() {
  const s = [...ownedParsed().items].map(([id, n]) => `${id}x${n}`).join(".");
  return s && s.length <= 600 ? s : null;
}
function planHash() {
  const q = new URLSearchParams({ p: state.prof, from: state.from, to: state.to, sell: state.sell, pat: state.patterns, f: state.faction,
    lvl: state.level, t: state.time, wait: state.wait, fast: +state.fast, mine: +state.mining, bw: +state.neutral });
  if (fishMode()) { q.set("ff", state.ffrom); q.set("ft", state.fto); q.set("pole", state.pole); q.set("cast", state.castSec); q.set("hv", state.hourValue); q.set("cook", +state.cookCatch); }
  if (state.excluded.size) q.set("ex", [...state.excluded].join("."));
  const own = ownedHashPart(); if (own) q.set("own", own);
  return q.toString();
}
function syncHash() {
  if (!HASH_LIVE) { HASH_LIVE = true; if (!isPlanHash(location.hash.slice(1))) return; }
  const h = "#" + planHash();
  if (location.hash !== h) history.replaceState(history.state, "", h); // no history entry per change
}
function applyHash() {
  const raw = location.hash.slice(1);
  if (!isPlanHash(raw)) return;
  const q = new URLSearchParams(raw);
  const has = k => q.has(k) && q.get(k) !== "";
  const num = (k, lo, hi, int = true) => { if (!has(k)) return null; const v = Number(q.get(k)); return isFinite(v) ? Math.max(lo, Math.min(hi, int ? Math.round(v) : v)) : null; };
  const pick = (k, list) => list.includes(q.get(k)) ? q.get(k) : null;
  const bool = k => has(k) ? q.get(k) === "1" : null;
  const put = (k, v, key = "lv:" + k) => { if (v == null) return; state[k] = v; store.set(key, v); };
  const names = [...REC.professions.filter(p => p.name !== "Mining").map(p => p.name), FISHING, FISH_COOK];
  put("prof", pick("p", names));
  put("from", num("from", 1, 299)); put("to", num("to", 2, 300));
  put("sell", pick("sell", ["ah", "vendor", "none"]));
  const pat = pick("pat", ["buyable", "vendor", "trainer", "all"]);
  if (pat) { store.set("lv:patternsV2", true); put("patterns", pat); }
  put("faction", pick("f", ["alliance", "horde"]), "faction");
  put("level", num("lvl", 1, 60)); put("time", num("t", 0, 1e6, false));
  const w = num("wait", 1, 7); put("wait", [1, 3, 7].includes(w) ? w : null);
  put("fast", bool("fast")); put("mining", bool("mine")); put("neutral", bool("bw"), "neutral");
  put("ffrom", num("ff", 1, 299)); put("fto", num("ft", 2, 300));
  const pole = num("pole", 0, 35); put("pole", POLES.includes(pole) ? pole : null);
  put("castSec", num("cast", 5, 40)); put("hourValue", num("hv", 0, 1e6, false)); put("cookCatch", bool("cook"));
  if (state.from >= state.to) { if (has("to") && !has("from")) state.from = Math.max(1, state.to - 1); else state.to = Math.min(300, state.from + 1); store.set("lv:from", state.from); store.set("lv:to", state.to); }
  const known = new Set(); // only exclusions that name a recipe of this profession (or the Mining helper)
  for (const r of profData()?.recipes || []) known.add(r.id);
  for (const r of REC.professions.find(p => p.name === "Mining")?.recipes || []) known.add(r.id);
  state.excluded = new Set((q.get("ex") || "").split(".").map(Number).filter(n => n > 0 && known.has(n))); // the link's exclusions, or none
  store.set("lv:excluded", [...state.excluded]);
  // the link's materials are shown but not saved over your own list until you edit the box
  if (has("own")) state.owned = q.get("own").split(".").map(x => x.split("x").map(Number))
    .filter(([id, n]) => ITEMS[id]?.n && n > 0).map(([id, n]) => `${n}x ${ITEMS[id].n}`).join("\n");
}
async function copyPlanLink() {
  const url = location.href.split("#")[0] + "#" + planHash();
  HASH_LIVE = true; history.replaceState(history.state, "", url);
  let ok = false;
  try { await navigator.clipboard.writeText(url); ok = true; } catch { /* no clipboard access: show the link instead */ }
  const ownNote = ownedParsed().items.size && !ownedHashPart() ? " Your materials list is too long for a link, so it isn't included." : "";
  $("#shareMsg").innerHTML = ok ? `Link copied: it opens this plan, priced with the auction house of that moment.${ownNote}`
    : `Copy this link: <a href="${esc(url)}">${esc(url)}</a>${ownNote}`;
}
// the "Materials I already have" box, the share button, and pasted plan links in the same tab
function bindPlanExtras() {
  const box = $("#owned");
  box.value = state.owned;
  let timer = 0;
  box.oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.owned = box.value; store.set("lv:owned", box.value); render(); }, 400);
  };
  $("#shareLink").onclick = copyPlanLink;
  addEventListener("hashchange", () => { const h = location.hash.slice(1); if (isPlanHash(h) && h !== planHash()) location.reload(); });
}

// The bot publishes new prices about hourly. Re-planning by itself would move the route under the
// reader, so offer it instead.
async function checkForNewPrices() {
  try {
    const fresh = await loadPrices();
    if (!PRICES || fresh.updated === PRICES.updated) return;
    $("#status").innerHTML = `New prices are in (${ago(fresh.updated)}). <button class="chip" id="replan">Re-plan with them</button>`;
    $("#replan").onclick = async () => {
      [SALES, TRENDS] = await Promise.all([loadJson("data/sales.json?t=" + Date.now()).catch(() => SALES), loadJson("data/trends.json?t=" + Date.now()).catch(() => TRENDS)]);
      PRICES = fresh;
      $("#status").innerHTML = `Prices updated <b>${ago(PRICES.updated)}</b> · recipes from client build ${esc(REC.build)}`;
      render();
    };
  } catch { /* offline: try again next time */ }
}

async function load() {
  try {
    [PRICES, REC, SALES, FISH] = await Promise.all([loadPrices(), loadJson("data/recipes.json"), loadJson("data/sales.json?t=" + Date.now()).catch(() => null), loadJson("data/fishing.json")]);
    TRENDS = await loadJson("data/trends.json?t=" + Date.now()).catch(() => null);
    setInterval(checkForNewPrices, 10 * 60e3);
    ITEMS = REC.items;
    for (const [id, it] of Object.entries(FISH.items)) ITEMS[id] ||= it; // fish, lures and junk that no recipe uses
    FISH_IDS = new Set([...FISH.spots.flatMap(sp => sp.fish.map(f => f[0])), 13755, 13756]);
    applyHash(); bindPlanExtras(); // a shared link's settings override the saved ones
    $("#wait").value = state.wait;
    const names = [...REC.professions.filter(p => p.name !== "Mining").map(p => p.name), FISHING, FISH_COOK];
    if (!names.includes(state.prof)) state.prof = names[0];
    $("#prof").innerHTML = names.map(n => `<option ${n === state.prof ? "selected" : ""}>${esc(n)}</option>`).join("");
    $("#ffrom").value = state.ffrom; $("#fto").value = state.fto; $("#pole").value = String(state.pole); $("#castsec").value = state.castSec; $("#hourval").value = state.hourValue; $("#cookcatch").checked = state.cookCatch;
    $("#from").value = state.from; $("#to").value = state.to;
    $("#patterns").value = state.patterns; $("#time").value = state.time; $("#level").value = state.level; $("#fast").checked = state.fast; $("#sellmode").value = state.sell; $("#mining").checked = state.mining; $("#neutral").checked = state.neutral;
    $("#status").innerHTML = `Prices updated <b>${ago(PRICES.updated)}</b> · recipes from client build ${esc(REC.build)}`;
    bind(); render();
  } catch (e) {
    console.error(e);
    $("#status").textContent = "Could not load data. Try again shortly.";
    $("#status").classList.add("err");
  }
}
load();
