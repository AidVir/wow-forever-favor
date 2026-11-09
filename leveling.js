import { $, store, esc, gold, makeBook, buyCost, consume, listed, minPrice, loadPrices, loadJson, ago, bindFaction, wh, marketTrend, projectPrice, trendLabel } from "./common.js";

const RARE_STATIONS = new Set(["Black Anvil", "Black Forge", "Arcane Forge", "Moonwell", "Icebellow Anvil", "Master Forge", "Anarchist's Workbench"]);
const state = {
  faction: store.get("faction", "horde"),
  neutral: store.get("neutral", false),
  prof: store.get("lv:prof", "Alchemy"),
  from: store.get("lv:from", 1),
  to: store.get("lv:to", 300),
  patterns: (v => ["all", "buyable", "vendor", "trainer"].includes(v) ? v : "buyable")(store.get("lv:patterns", "buyable")),
  time: store.get("lv:time", 5),
  level: store.get("lv:level", 60),
  fast: store.get("lv:fast", true),
  sell: (v => ["ah", "vendor", "none"].includes(v) ? v : "ah")(store.get("lv:sell", "ah")),
  wait: (v => [1, 3, 7].includes(v) ? v : 3)(store.get("lv:wait", 3)),
  mining: store.get("lv:mining", false),
  stationsOff: new Set(store.get("lv:stationsOff", null) ?? [...RARE_STATIONS]),
  excluded: new Set(store.get("lv:excluded", [])),
};
let PRICES, REC, ITEMS;

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
const STICK = 0.10, STICK_MIN = 50;
// Before the route is known, a pattern's price is spread over this many points.
const ONCE_SPREAD = 5; // 10%, at least 50 copper per point

const chance = (r, s) => s < r.yellow ? 1 : s >= r.grey ? 0 : (r.grey - s) / (r.grey - r.yellow);
const color = (r, s) => s < r.yellow ? "orange" : s < r.green ? "yellow" : s < r.grey ? "green" : "grey";

function profData() { return REC.professions.find(p => p.name === state.prof); }

// Cheapest way to get `qty` of an item right now: what earlier steps made (ctx.inv, valued at what you'd
// otherwise sell it for), vendor (unlimited), AH (consumes book; not for bind-on-pickup items) or craft it
// with this profession if a recipe is known at the current skill. Returns {cost, plan:[[kind,id,qty]]}.
function acquire(ctx, id, qty, depth = 0, noAh = false) {
  const have = ctx.inv ? Math.min(qty, ctx.inv.qty(id)) : 0;
  const invCost = have * (have ? ctx.inv.value(id) : 0);
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
    if (state.patterns === "vendor" && !["vendor", "quest"].includes(r.src?.k)) return false;
    if (state.patterns === "buyable" && patternCost(BOOK0, r).unknown) return false;
  }
  return true;
}
// One-time cost to learn a pattern recipe: the cheapest of the teaching item on the AH, its vendor
// (Classic price), or free from a quest. Unknown = not listed and no vendor/quest source (cost 0).
function patternCost(book, r) {
  if (r.source !== "item") return { cost: 0 };
  let best = null;
  for (const id of r.recipeItems) {
    const p = minPrice(book, id);
    if (p != null && (!best || p < best.cost)) best = { cost: p, id, how: "ah" };
  }
  const s = r.src;
  if (s?.k === "vendor" && s.cost != null && (!best || s.cost < best.cost)) best = { cost: s.cost, how: "vendor" };
  if (s?.k === "quest" && !best) best = { cost: 0, how: "quest" };
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

// `future`: reagents (item id -> units) a first pass of the route used. Crafting those for skill-ups
// counts at what buying them would cost, and later steps use them up ("keep N for later"), like the
// written guides do with grinding stones, bolts and blasting powder.
// `usage`: skill points each recipe got in the first pass. A pattern or tool bought for a recipe is
// spread over those points (at least 1), so a pattern bought for 2 crafts carries its full price.
function plan(future = null, usage = null) {
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
  const inv = {
    qty: id => (lots.get(id) || []).reduce((a, l) => a + l.n, 0),
    // what a unit is worth if kept and sold instead (the cost of using it)
    value: id => { const l = (lots.get(id) || []).find(x => x.n > 0); return !l ? 0 : state.sell === "ah" ? l.ah : state.sell === "vendor" ? l.vend : 0; },
  };
  function takeInv(id, n, user) {
    for (const l of lots.get(id) || []) {
      if (n <= 0) break;
      const k = Math.min(n, l.n); if (!k) continue;
      l.n -= k; n -= k;
      l.st.vendor -= k * l.vend; l.st.ah -= k * l.ah; l.st.onAh -= k * l.onAh;
      resaleVendor -= k * l.vend; resaleAh -= k * l.ah;
      sales.unsell(id, k, k * l.onAh);
      l.st.kept += k;
      if (user && user !== l.st) user.used.set(id, (user.used.get(id) || 0) + k);
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
        demand.set(id, (demand.get(id) || 0) + q);
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

  const end = Math.min(300, state.to, levelCap());
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
      cands.push(cand);
      if (!best || per < best.per) best = cand;
      if (!cand.slow && (!bestFast || per < bestFast.per)) bestFast = cand;
      if (prev && prev.r === r) cur = cand;
    }
    // Skip recipes that need more than MAX_CRAFTS_PER_POINT crafts per point while a faster one exists.
    if (state.fast && bestFast) best = bestFast;
    // Keep crafting the current recipe unless the best one is clearly cheaper, so the route doesn't
    // switch back and forth for a few copper.
    if (best && cur && cur !== best && !(state.fast && cur.slow && bestFast)
      && cur.per <= best.per + Math.max(Math.abs(best.per) * STICK, STICK_MIN)) best = cur;
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
  const capped = !stuck && end < Math.min(300, state.to) ? end : null; // character level stops the route
  return { steps, shopping: [...shopping.values()], total, resaleVendor, resaleAh, stuck, capped, book, sellList, salesInfo: sales.info, stat: sales.stat, trend: sales.trend, supplyDays: sales.supplyDays, demand,
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
    : st.onAh ? `${st.onAh}/${made} on AH · sells ~${perDay(rate)}/day${st.ah > st.cost ? ' · <span class="profit">profit</span>' : ""}`
    : rate > 0 ? `sells ~${perDay(rate)}/day, not above vendor` : "none sold";
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
const OPEN_STEPS = new Set(); // expanded step rows (not saved)

function render() {
  if (!PRICES || !REC) return;
  const prof = profData();
  $("#market").textContent = `${PRICES.region} · ${PRICES.ruleset.name} · ${PRICES.factions[state.faction].house.name}${state.neutral ? " + Blackwater" : ""}`;
  // station toggles for this profession
  const stations = [...new Set(prof.recipes.map(r => r.needs).filter(Boolean))].sort();
  $("#stations").innerHTML = stations.length ? stations.map(n => `<label class="chk"><input type="checkbox" data-station="${esc(n)}" ${state.stationsOff.has(n) ? "" : "checked"}> ${esc(n)}</label>`).join("") : `<span class="muted">None needed</span>`;

  const t0 = performance.now();
  const p1 = plan();
  const p = plan(p1.demand, p1.usage); // second pass knows which intermediates the route needs later and how long each recipe is used
  // The answer for the chosen selling mode is the big number; the other totals sit beside it.
  const sums = {
    none: { big: `Materials${state.patterns !== "trainer" ? " + patterns" : ""} cost`, small: "Materials", val: pl(-p.total), sub: "what you spend" },
    vendor: { big: "Profit / loss if you vendor everything", small: "If you vendor", val: pl(p.resaleVendor - p.total), sub: `vendor sales ${gold(p.resaleVendor)}` },
    ah: { big: "Profit / loss if you sell on the AH", small: "If you sell on AH", val: pl(p.resaleAh - p.total), sub: `AH + vendor sales ${gold(p.resaleAh)} (est.)` },
  };
  const main = sums[state.sell] || sums.none;
  const rest = ["none", "vendor", "ah"].filter(k => sums[k] !== main).map(k => sums[k]);
  $("#summary").innerHTML = `
    <div class="pick sum-main"><span class="eyebrow">${main.big}</span><b>${main.val}</b><small>${main.sub}</small></div>
    <div class="sum-stats">
      ${rest.map(x => `<div><span class="eyebrow">${x.small}</span><b>${x.val}</b><small>${x.sub}</small></div>`).join("")}
      <div><span class="eyebrow">Crafts</span><b>${p.steps.reduce((a, s) => a + s.crafts, 0).toLocaleString("en-GB")}</b></div>
      <div><span class="eyebrow">Skill</span><b>${state.from} → ${p.stuck ? p.stuck.s : p.capped ?? state.to}</b></div>
    </div>`;
  const nextRank = p.capped ? RANKS.find(k => k.cap === p.capped) : null;
  $("#stuck").innerHTML = p.stuck ? `<p class="warn">Stopped at ${p.stuck.s}: the auction house doesn't have enough ${p.stuck.miss.map(id => wh(id, ITEMS[id]?.n || id)).join(", ") || "reagents"} for the remaining recipes. Try "I can smelt", Blackwater, more recipes or stations — or farm those yourself.</p>`
    : nextRank ? `<p class="warn">Stops at ${p.capped}: ${nextRank.name} ${esc(prof.name)} needs character level ${nextRank.level} (you set ${state.level}). Change "Character level" under More options to plan further.</p>` : "";

  // Steps: the row shows what to craft, its reagents, cost and what you get back in the chosen mode.
  // Skill colours, the other selling mode, sales notes and recipe tags live in the expandable detail row.
  const retVendor = state.sell === "vendor";
  $("#retHead").textContent = retVendor ? "Vendor value" : "AH value (est.)";
  const trained = new Set();
  $("#steps").innerHTML = p.steps.map(st => {
    const r = st.r, key = `${r.id}@${st.from}`, open = OPEN_STEPS.has(key);
    // "Train the next rank" row before the first step past each rank cap
    let train = "";
    for (const k of RANKS) {
      if (trained.has(k.name) || st.from < k.cap || state.from >= k.cap) continue;
      trained.add(k.name);
      train += `<tr class="train"><td class="num rng">${k.cap}</td><td class="c-craft" colspan="4"><b>Train ${k.name} ${esc(prof.name)}</b> before skill ${k.cap}
        <span class="meta">needs skill ${k.skill} and level ${k.level} · ${esc(trainerFor(prof.name, k.name))}</span></td></tr>`;
    }
    const reag = r.reagents.map(([id, q]) => `${q} × ${wh(id, ITEMS[id]?.n || id)}`).join(", ");
    const pattern = r.source === "item" ? patternText(r, st.pattern) : "";
    // tools: what this step needs, and which ones the route gets right here (first time they're needed)
    const toolsGot = st.toolsGot.map(t => `${t.how === "craft" ? "craft" : t.how === "vendor" ? "buy (vendor)" : t.how === "ah" ? "buy (AH)" : "use"} ${wh(t.id, ITEMS[t.id]?.n || toolName(t.c))}${t.cost ? " " + gold(t.cost) : ""}`);
    const toolsNeed = (r.tools || []).map(toolName);
    // inventory: made here and used later / made earlier and used here
    const used = [...st.used.entries()].map(([id, n]) => `${n} × ${esc(ITEMS[id]?.n || id)}`);
    const kept = Math.round(st.kept);
    const name = r.item ? wh(r.item, r.name) : esc(r.name);
    const s = sellInfo(st, p);
    const ret = !s ? `<td class="num c-ret"><span class="muted">—</span></td>`
      : `<td class="num c-ret${(retVendor ? s.vendorBetter : s.ahBetter) ? " better" : ""}" data-label="${retVendor ? "Vendor" : "AH"}">${gold(retVendor ? st.vendor : st.ah)}<small>${pl((retVendor ? st.vendor : st.ah) - st.cost)}</small></td>`;
    let html = train + `<tr class="row${open ? " open" : ""}" data-key="${key}" tabindex="0" aria-expanded="${open}">
      <td class="num rng">${st.from}–${st.to}</td>
      <td class="c-craft"><b>${st.crafts} × ${name}</b>${pattern ? ` <span class="tag pat" title="${esc(pattern.replace(/<[^>]+>/g, ""))}">${st.patPaid ? "pattern " + gold(st.patPaid) : st.pattern?.unknown ? "pattern: price unknown" : st.pattern?.how === "quest" ? "pattern: quest" : st.pattern?.cost ? "pattern: bought earlier" : "pattern"}</span>` : ""}<div class="meta">${reag}${r.needs ? ` · needs ${esc(r.needs)}` : ""}${toolsNeed.length ? ` · needs ${toolsNeed.map(esc).join(", ")}` : ""}</div>${
        toolsGot.length || kept || used.length ? `<div class="meta step-notes">${toolsGot.length ? `<span class="tag toolget">first: ${toolsGot.join(", ")}</span> ` : ""}${used.length ? `<span class="tag inv">uses ${used.join(", ")} from earlier steps</span> ` : ""}${kept ? `<span class="tag keep">keep ${kept} for later steps</span>` : ""}</div>` : ""}</td>
      <td class="num c-cost" data-label="Cost">${gold(st.cost)}${st.once ? `<small>incl. ${[st.patPaid ? "pattern " + gold(st.patPaid) : "", st.once - st.patPaid > 0 ? "tools " + gold(st.once - st.patPaid) : ""].filter(Boolean).join(", ")}</small>` : ""}</td>
      ${ret}
      <td class="num c-x"><button class="x" data-ex="${r.id}" title="Exclude this recipe and re-plan" aria-label="Exclude ${esc(r.name)} and re-plan">✕</button></td>
    </tr>`;
    if (open) {
      const tags = [

        r.needs ? `<span class="tag">${esc(r.needs)}</span>` : "",
        r.isNew ? `<span class="tag new">new in Forever</span>` : "",
        r.est ? `<span class="tag">trainer skill est.</span>` : "",
      ].filter(Boolean).join(" ");
      html += `<tr class="detail"><td colspan="5"><div class="facts">
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
  }).join("") || `<tr><td colspan="5" class="empty">Nothing to plan.</td></tr>`;
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
  $("#patterns").onchange = e => set("patterns", e.target.value);
  $("#time").oninput = e => set("time", Math.max(0, Number(e.target.value) || 0));
  $("#level").oninput = e => set("level", Math.max(1, Math.min(60, Number(e.target.value) || 60)));
  $("#fast").onchange = e => set("fast", e.target.checked);
  $("#sellmode").onchange = e => set("sell", e.target.value);
  $("#wait").onchange = e => set("wait", Number(e.target.value));
  $("#mining").onchange = e => set("mining", e.target.checked);
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
  $("#excl").onclick = e => { const id = Number(e.target.dataset?.unex); if (id) { state.excluded.delete(id); store.set("lv:excluded", [...state.excluded]); render(); } };
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
    [PRICES, REC, SALES] = await Promise.all([loadPrices(), loadJson("data/recipes.json"), loadJson("data/sales.json?t=" + Date.now()).catch(() => null)]);
    TRENDS = await loadJson("data/trends.json?t=" + Date.now()).catch(() => null);
    setInterval(checkForNewPrices, 10 * 60e3);
    ITEMS = REC.items;
    $("#wait").value = state.wait;
    $("#prof").innerHTML = REC.professions.filter(p => p.name !== "Mining").map(p => `<option ${p.name === state.prof ? "selected" : ""}>${p.name}</option>`).join("");
    if (!REC.professions.some(p => p.name === state.prof)) state.prof = REC.professions[0].name;
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
