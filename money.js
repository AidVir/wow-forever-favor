import { $, store, esc, gold, makeBook, listed, minPrice, loadPrices, loadJson, ago, bindFaction, wh, acquire, salesStats, marketTrend, projectPrice } from "./common.js";

// --- rules (explained on the page under "How this is calculated") -------------------------
const AH_CUT = 0.95;          // the AH keeps 5% of the sale price
const DEPOSIT = 0.15;         // deposit per listing as a share of the vendor sell price (Classic faction AH, 12 h)
const MIN_HOURS = 6;          // sales history needed before measured rates replace the listing-based guess
const GUESS_ABSORB = 0.25;    // without history: the market absorbs a quarter of what is listed, per day
const CROWD_DAYS = 2;         // above this many days of supply your share shrinks in proportion
const OVER_DAYS = 3;          // above this many days of supply the market is flagged oversupplied
const THIN = 1.15;            // a day's reagents costing 15%+ more than the top listings = thin reagent market
const SPIKE = 1.5;            // recent price 50%+ above the earlier average = possible manipulation
const SELL_DAYS = 1;          // a day's crafts sell over about a day: falling prices are projected this far
const FALLING = -0.05;        // price falling 5%+ a day = flagged
const SUPPLY_UP = 0.5;        // 50%+ more units listed than 24 h ago = flagged (competition piling up)
const VENDOR_CRAFTS = 20;     // crafts/day assumed when the vendor is the buyer (no demand limit)
const MAX_DEPTH = 200;        // never walk the order book for more than this many crafts
const SHOW_MAX = 200;         // rows rendered
const REFRESH_MS = 10 * 60e3; // reload prices and sales this often while the page is open
const RARE_STATIONS = new Set(["Black Anvil", "Black Forge", "Arcane Forge", "Moonwell", "Icebellow Anvil", "Master Forge", "Anarchist's Workbench"]);

// Raw materials a player can gather, for "I gather my own". Crafted items are never treated as gathered.
const HERBS = new Set([2447, 765, 2449, 785, 2450, 2452, 2453, 3355, 3356, 3357, 3358, 3369, 3818, 3819, 3820, 3821, 4625, 8153, 8831, 8836, 8838, 8839, 8845, 8846, 13463, 13464, 13465, 13466, 13467, 13468, 19726, 248821, 248822, 248823, 249274, 249399, 249424]);
const STONES_GEMS = new Set([2835, 2836, 2838, 7912, 12365, 774, 818, 1206, 1210, 1529, 1705, 3864, 7909, 7910, 12361, 12364, 12799, 12800]);
const CLOTH = new Set([2589, 2592, 4306, 4338, 14047, 14256]);
function gatherKind(id) {
  const n = ITEMS[id]?.n || "";
  if (HERBS.has(+id)) return "herb";
  if (STONES_GEMS.has(+id) || / Ore$/.test(n)) return "ore";
  if (CLOTH.has(+id)) return "cloth";
  if (/(Leather|Hide|hide|Scale|Leather Scraps)$/.test(n) && !/^(Cured|Enchanted) /.test(n)) return "leather";
  return null;
}

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const state = {
  faction: store.get("faction", "horde"),
  neutral: store.get("neutral", false),
  profs: (v => v && typeof v === "object" ? v : {})(store.get("mm:profs", {})), // name -> skill (missing = don't have it)
  share: (v => [0.1, 0.25, 0.5, 0.75, 1].includes(v) ? v : 0.5)(store.get("mm:share", 0.5)),
  // the default used to be 10s; an old saved 10 moves to 0 once
  minProfit: (v => v === 10 && !store.get("mm:minProfitV2", false) ? 0 : v)(num(store.get("mm:minProfit", 0), 0)),
  minMargin: num(store.get("mm:minMargin", 5), 5),
  time: num(store.get("mm:time", 0), 0),
  minSales: num(store.get("mm:minSales", 5), 5),
  // "all" used to be the default; old saved "all" choices move to "buyable" once
  patterns: (v => ["all", "buyable", "trainer"].includes(v) && !(v === "all" && !store.get("mm:patternsV2", false)) ? v : "buyable")(store.get("mm:patterns", "buyable")),
  sort: (v => ["daily", "craft", "margin"].includes(v) ? v : "daily")(store.get("mm:sort", "daily")),
  ownMode: (v => ["market", "free"].includes(v) ? v : "market")(store.get("mm:ownMode", "market")),
  own: new Set(store.get("mm:own", [])),
  rare: store.get("mm:rare", false),
  risky: store.get("mm:risky", false),
  all: store.get("mm:all", false),
  open: new Set(),
};
let PRICES, REC, ITEMS, SALES = null, RECIPE = new Map(), loadedAt = 0;

const pl = c => c == null || !isFinite(c) ? "—"
  : `<span class="${Math.round(c) > 0 ? "pos" : Math.round(c) < 0 ? "neg" : ""}">${Math.round(c) > 0 ? "+" : ""}${gold(c)}</span>`;
const rate = n => !isFinite(n) ? "∞" : n >= 10 ? Math.round(n).toLocaleString("en-GB") : n >= 1 ? n.toFixed(1) : n > 0 ? n.toFixed(2) : "0";
const n0 = x => Math.round(x).toLocaleString("en-GB");
const pct = x => !isFinite(x) ? "∞" : `${Math.round(x * 100)}%`;

// Which professions count: the ones ticked, or all at 300 when none are.
function myProfs() {
  const picked = Object.entries(state.profs).filter(([, s]) => s > 0);
  return picked.length ? new Map(picked) : new Map(REC.professions.map(p => [p.name, 300]));
}
// A pattern whose vendor or quest is only for the other faction can only be bought on the AH.
const otherFaction = r => { const f = r.src?.faction; return !!f && f !== "Both" && f.toLowerCase() !== state.faction; };
function patternCost(book, r) {
  if (r.source !== "item") return null;
  let best = null;
  const vendorOk = !otherFaction(r);
  for (const id of r.recipeItems) for (const c of [minPrice(book, id), vendorOk ? ITEMS[id]?.v : null]) if (c != null && (!best || c < best.cost)) best = { cost: c, id };
  return best || { cost: null, unknown: true };
}
function usable(r, profs, book) {
  if ((profs.get(r.prof) ?? 0) < r.learn) return "skill";
  if (r.needs && RARE_STATIONS.has(r.needs) && !state.rare) return "station";
  if (r.source === "item") {
    if (state.patterns === "trainer") return "pattern";
    if (otherFaction(r) && patternCost(book, r).unknown) return "faction";
    if (state.patterns === "buyable" && patternCost(book, r).unknown) return "pattern";
  }
  return null;
}

// Price trend of an item: the bot's market history (data/trends.json: robust price 24 h / 72 h ago and
// units listed), falling back to the average sold price of the last 6 h against the hours before.
let TRENDS = null;
const trend = id => marketTrend(TRENDS, SALES, state.faction, id);
const arrow = t => !t || Math.abs(t.pct) < 0.1 ? ""
  : `<span class="mm-trend ${t.pct > 0 ? "up" : "down"}" title="${esc(t.src)}: ${t.pct > 0 ? "+" : ""}${Math.round(t.pct * 100)}%">${t.pct > 0 ? "▲" : "▼"}${Math.abs(Math.round(t.pct * 100))}%</span>`;

// Reagents for n crafts of r. Returns { cost, parts:[{id, q, cost, plan}] } or null if unavailable.
function reagentCost(r, n, env) {
  let cost = 0; const parts = [];
  for (const [id, q] of r.reagents) {
    const a = acquire(env.ctx, id, q * n);
    if (!a) return null;
    cost += a.cost; parts.push({ id, q, cost: a.cost / n, plan: a.plan });
  }
  return { cost, parts };
}

function evaluate(r, env) {
  const id = r.item, it = ITEMS[id] || {};
  const st = env.sales.stat(id);
  const minList = minPrice(env.sellBook, id), nListed = listed(env.sellBook, id), levels = env.sellBook[id]?.length || 0;
  const vend = it.s > 0 ? it.s : null;
  if (minList == null && st.avg == null && !vend) return { r, skip: "nomarket" };
  const tr = trend(id);
  const today = minList != null && st.avg != null ? Math.min(minList, st.avg) : (minList ?? st.avg);
  const gross = projectPrice(today, tr, SELL_DAYS); // falling prices keep falling while you sell
  const guess = !env.sales.ok;
  const perDay = guess ? nListed * GUESS_ABSORB : st.perDay;
  const supplyDays = guess ? null : perDay > 0 ? nListed / perDay : nListed > 0 ? Infinity : 0;
  const over = supplyDays != null && supplyDays > OVER_DAYS;
  const deposit = vend ? Math.round(vend * DEPOSIT) * (over ? 2 : 1) : 0;
  const ahNet = gross != null ? Math.floor(gross * AH_CUT) - deposit : null;
  const toVendor = vend != null && (ahNet == null || ahNet <= vend);
  const sellUnit = toVendor ? vend : ahNet;
  let share = state.share;
  if (!toVendor && supplyDays != null && supplyDays > CROWD_DAYS) share *= CROWD_DAYS / supplyDays;
  let crafts = toVendor ? VENDOR_CRAFTS : perDay * share / r.qty;

  const top = reagentCost(r, 1, env);
  if (!top) return { r, skip: "noreagents" };
  let n = Math.min(MAX_DEPTH, Math.max(1, Math.ceil(crafts))), deep = n === 1 ? top : reagentCost(r, n, env), supplyCap = null;
  if (!deep) { // the AH can't supply a full day: find how many crafts it can supply
    let lo = 1, hi = n;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (reagentCost(r, m, env)) lo = m; else hi = m; }
    n = supplyCap = lo; deep = lo === 1 ? top : reagentCost(r, lo, env);
    crafts = Math.min(crafts, lo);
  }
  const cost = deep.cost / n;
  const profit = sellUnit * r.qty - cost - env.timeCost;
  const margin = cost > 0 ? profit / cost : profit > 0 ? Infinity : 0;
  const daily = profit * crafts;
  const pat = patternCost(env.book, r);

  const flags = [];
  if (!toVendor) {
    if (guess) flags.push(["guess", "info", "No measured sales yet: demand guessed from what is listed"]);
    if (!guess && st.units < state.minSales) flags.push(["few sales", "risk", `Only ${n0(st.units)} sold in ${Math.round(env.sales.hours)} h of history`]);
    if (st.units === 0 && levels <= 1) flags.push(["one listing", "risk", "The price rests on a single listing and nothing has sold"]);
    if (tr && tr.pct > SPIKE - 1) flags.push(["price spike", "risk", `Price is up ${Math.round(tr.pct * 100)}% (${tr.src}), possibly manipulated`]);
    else if (minList != null && st.avg != null && st.units >= 3 && minList > st.avg * SPIKE) flags.push(["listed high", "info", "Listings sit well above what it actually sold for; priced at the sold average"]);
    if (over) flags.push(["oversupplied", "warn", `${supplyDays === Infinity ? "Nothing sold" : rate(supplyDays) + " days of supply"} on the AH`]);
    if (tr && tr.perDay <= FALLING) flags.push(["price falling", "warn", `Down about ${Math.round(-tr.perDay * 100)}% a day (${tr.src}); priced for selling over the next day`]);
    if (tr?.supply != null && tr.supply >= SUPPLY_UP) flags.push(["supply rising", "warn", `${Math.round(tr.supply * 100)}% more listed than 24 h ago: others are making it too`]);
  } else if (gross != null) flags.push(["vendor it", "info", "The AH pays less than the vendor after the cut and deposit"]);
  if (deep.cost / n > top.cost * THIN && deep.cost / n - top.cost > 100) flags.push(["thin reagents", "warn", `A day's reagents cost ${Math.round((deep.cost / n / top.cost - 1) * 100)}% more than the cheapest listings`]);
  if (supplyCap != null) flags.push(["reagent supply", "warn", `The AH only has reagents for ${supplyCap} craft${supplyCap === 1 ? "" : "s"} right now`]);
  const risky = flags.some(f => f[1] === "risk");

  return { r, id, it, st, minList, nListed, levels, vend, gross, today, guess, perDay, supplyDays, over, deposit, ahNet, toVendor, sellUnit, share,
    crafts, n, top, deep, cost, profit, margin, daily, tr, pat, flags, risky, supplyCap };
}

function compute() {
  const book = makeBook(PRICES, state.faction, state.neutral);
  const sellBook = makeBook(PRICES, state.faction, false);
  const sales = salesStats(SALES, [state.faction], MIN_HOURS);
  const profs = myProfs();
  const recipes = REC.professions.flatMap(p => p.recipes);
  const makers = new Map();
  for (const r of recipes) if (r.item && !usable(r, profs, book)) (makers.get(r.item) || makers.set(r.item, []).get(r.item)).push(r);
  const ownUnit = id => {
    if (state.ownMode === "free") return 0;
    const p = minPrice(sellBook, id);
    return p != null ? Math.floor(p * AH_CUT) : ITEMS[id]?.s || 0;
  };
  const ctx = { book, makers, items: ITEMS, can: () => true, own: id => state.own.has(gatherKind(id)) ? ownUnit(id) : null };
  const env = { book, sellBook, sales, ctx, timeCost: Math.max(0, state.time) * 100 };
  const hidden = { enchant: 0, skill: 0, station: 0, pattern: 0, faction: 0, nomarket: 0, noreagents: 0, risky: 0, low: 0, loss: 0 };
  const rows = [];
  for (const r of recipes) {
    if (!profs.has(r.prof)) continue;
    const why = usable(r, profs, book);
    if (why) { hidden[why]++; continue; }
    if (!r.item) { hidden.enchant++; continue; }
    const e = evaluate(r, env);
    if (e.skip) { hidden[e.skip]++; continue; }
    if (!state.all) {
      if (e.profit <= 0) { hidden.loss++; continue; }
      if (e.profit < state.minProfit * 100 || e.margin * 100 < state.minMargin) { hidden.low++; continue; }
    }
    if (e.risky && !state.risky) { hidden.risky++; continue; }
    rows.push(e);
  }
  const key = { daily: e => e.daily, craft: e => e.profit, margin: e => e.margin }[state.sort];
  rows.sort((a, b) => key(b) - key(a) || b.profit - a.profit);
  return { rows, hidden, sales, profs, book, sellBook };
}

function sourceText(p, part, n) {
  const [kind, id] = p.plan[0];
  if (kind === "ah") return `AH · ${gold(part.cost / part.q)} each for ${n0(part.q * n)}`;
  if (kind === "vendor") return "vendor";
  if (kind === "own") return state.ownMode === "free" ? "own · free" : "own · valued at AH sell price";
  if (kind === "craft") return `craft · ${esc(RECIPE.get(id)?.name || "recipe")}`;
  return kind;
}

function detail(e, sales) {
  const r = e.r;
  const reag = e.deep.parts.map(p => `<li><span>${p.q} × ${wh(p.id, ITEMS[p.id]?.n || p.id)}<small class="muted"> — ${sourceText({ plan: p.plan }, p, e.n)}</small></span><b>${gold(p.cost)}</b></li>`).join("");
  const sell = e.toVendor
    ? `<li>Vendor sell price<b>${gold(e.vend)}</b></li>${e.gross != null ? `<li class="muted"><span>AH would net (after cut, deposit)</span><b>${gold(e.ahNet)}</b></li>` : ""}`
    : `<li>Cheapest listing${e.levels ? ` (${n0(e.nListed)} listed)` : ""}<b>${e.minList != null ? gold(e.minList) : "none"}</b></li>
       <li>Average sold price${e.st.units ? ` (${n0(e.st.units)} sold)` : ""}<b>${e.st.avg != null ? gold(Math.round(e.st.avg)) : "no sales yet"}</b></li>
       ${e.today !== e.gross ? `<li>Today (the lower)<b>${gold(e.today)}</b></li>
       <li>Falling ${Math.round(-e.tr.perDay * 100)}%/day: price when it sells<b>${gold(e.gross)}</b></li>` : `<li>Price used (the lower)<b>${gold(e.gross)}</b></li>`}
       <li>AH cut 5%<b>−${gold(e.gross - Math.floor(e.gross * AH_CUT))}</b></li>
       <li>Lost deposit${e.over ? " ×2 (oversupplied)" : ""}<b>${e.deposit ? "−" + gold(e.deposit) : gold(0)}</b></li>
       <li>Net per unit<b>${gold(e.ahNet)}</b></li>
       ${e.vend ? `<li class="muted"><span>Vendor would pay</span><b>${gold(e.vend)}</b></li>` : ""}`;
  const market = e.toVendor ? `<li>Vendors buy any amount; assumed ${VENDOR_CRAFTS} crafts/day${e.supplyCap != null ? `, capped at ${e.supplyCap} by AH reagents` : ""}.</li>`
    : `<li>${e.guess ? "Guessed demand (¼ of listed)" : `Sold per day (${Math.round(sales.hours)} h of history)`}<b>${rate(e.perDay)}</b></li>
       ${e.supplyDays != null ? `<li>Days of supply on the AH<b>${rate(e.supplyDays)}</b></li>` : ""}
       <li>Your share${e.share < state.share ? " (reduced by competition)" : ""}<b>${pct(e.share)}</b></li>
       <li>Crafts per day<b>${rate(e.crafts)}</b></li>`;
  const pat = e.pat ? `<p class="fine">Pattern: ${e.pat.unknown ? `not on the AH or a vendor (Merchant's Favor vendor, drop or quest)${r.recipeItems.length ? " · " + r.recipeItems.map(id => wh(id, ITEMS[id]?.n || "pattern")).join(", ") : ""}`
    : `${wh(e.pat.id, ITEMS[e.pat.id]?.n || "pattern")} costs ${gold(e.pat.cost)}${e.profit > 0 ? ` · pays back after ${n0(Math.ceil(e.pat.cost / e.profit))} crafts${e.daily > 0 ? ` (~${rate(e.pat.cost / e.daily)} days)` : ""}` : ""}`}</p>` : "";
  const flags = e.flags.length ? `<ul class="mm-flaglist">${e.flags.map(([t, k, why]) => `<li><span class="mm-flag ${k}">${t}</span> ${esc(why)}</li>`).join("")}</ul>` : "";
  return `<tr class="detail"><td colspan="7">
    <div class="mm-detail">
      <div><h3>Reagents per craft</h3><ul class="mm-kv">${reag}<li class="tot">Total${e.n > 1 ? ` (bought for ${n0(e.n)} crafts)` : ""}<b>${gold(e.cost)}</b></li>${e.n > 1 ? `<li class="muted"><span>Top listings only</span><b>${gold(e.top.cost)}</b></li>` : ""}</ul></div>
      <div><h3>Selling${r.qty > 1 ? ` (${r.qty} per craft)` : ""}</h3><ul class="mm-kv">${sell}</ul></div>
      <div><h3>Market</h3><ul class="mm-kv">${market}</ul></div>
    </div>
    ${flags}${pat}
    <p class="fine">${esc(r.prof)} · learn ${r.learn}${r.est ? " (est.)" : ""} · <span class="o">${r.yellow}</span> <span class="y">${r.green}</span> <span class="gr">${r.grey}</span>${r.needs ? ` · needs ${esc(r.needs)}` : ""}</p>
  </td></tr>`;
}

function render() {
  if (!PRICES || !REC) return;
  const t0 = performance.now();
  $("#market").textContent = `${PRICES.region} · ${PRICES.ruleset.name} · ${PRICES.factions[state.faction].house.name}`;
  const res = compute();
  const { rows, hidden, sales } = res;
  paintStatus();

  const best = rows.find(e => e.profit > 0);
  const profitable = rows.filter(e => e.profit > 0).length;
  $("#summary").innerHTML = `
    <div class="pick"><span class="eyebrow">Best by ${{ daily: "profit per day", craft: "profit per craft", margin: "margin" }[state.sort]}</span><b>${best ? (state.sort === "daily" ? pl(best.daily) : state.sort === "craft" ? pl(best.profit) : pct(best.margin)) : "—"}</b><small>${best ? esc(best.r.name) : "nothing profitable with these settings"}</small></div>
    <div><span class="eyebrow">Profitable crafts</span><b>${profitable}</b><small>${state.all ? "showing all" : `above ${state.minProfit}s and ${state.minMargin}%`}</small></div>
    <div><span class="eyebrow">Sales history</span><b>${SALES ? `${sales.hours < 10 ? sales.hours.toFixed(1) : Math.round(sales.hours)} h` : "—"}</b><small>${sales.ok ? "measured sales per day" : `guessing until ${MIN_HOURS} h`}</small></div>
    <div><span class="eyebrow">Your share</span><b>${pct(state.share)}</b><small>of each market's daily sales</small></div>`;
  $("#salesnote").innerHTML = !SALES ? `<p class="warn">Sales data could not be loaded, so demand is guessed from listings.</p>`
    : sales.ok ? (sales.hours < 48 ? `<p class="hint">Sales measured over ${Math.round(sales.hours)} h of snapshots — still a short window, treat daily rates as rough.</p>` : "")
    : `<p class="warn"><b>Not enough sales history yet</b> (${sales.hours.toFixed(1)} of ${MIN_HOURS} h). Demand is guessed as a quarter of the units listed per day and every row is marked <i>guess</i>. Measured sales take over automatically.</p>`;

  const shown = rows.slice(0, SHOW_MAX);
  $("#rows").innerHTML = shown.map(e => {
    const r = e.r, open = state.open.has(r.id);
    const tags = [
      `<span class="tag">${esc(r.prof)}</span>`,
      r.qty > 1 ? `<span class="tag">makes ${r.qty}</span>` : "",
      e.pat ? `<span class="tag pat" title="Learned from a pattern">${e.pat.unknown ? "pattern: no price" : "pattern " + gold(e.pat.cost, { short: true })}</span>` : "",
      r.needs && RARE_STATIONS.has(r.needs) ? `<span class="tag">${esc(r.needs)}</span>` : "",
      r.isNew ? `<span class="tag new">new in Forever</span>` : "",
      ...e.flags.map(([t, k, why]) => `<span class="mm-flag ${k}" title="${esc(why)}">${t}</span>`),
    ].join(" ");
    const market = e.toVendor ? `<span class="muted">vendor</span>`
      : `${rate(e.perDay)}/day${e.guess ? "*" : ""}<small>${n0(e.nListed)} listed${e.supplyDays != null && e.nListed ? ` · ${rate(e.supplyDays)} d` : ""}</small>`;
    return `<tr class="row${open ? " open" : ""}${e.profit <= 0 ? " mm-loss" : ""}" data-id="${r.id}" tabindex="0" aria-expanded="${open}">
      <td><div class="crate"><span class="caret">▸</span><div><b>${wh(e.id, r.name)}</b><div class="meta mm-tags">${tags}</div></div></div></td>
      <td class="num">${gold(e.sellUnit)}${arrow(e.tr)}<small>${e.toVendor ? "vendor price" : `you get · ${e.st.avg != null && e.minList != null && e.st.avg < e.minList ? "sold avg" : e.minList != null ? "listed" : "sold avg"} ${gold(e.today)}`}</small></td>
      <td class="num">${gold(e.cost)}${e.flags.some(f => f[0] === "thin reagents") ? `<small>top ${gold(e.top.cost)}</small>` : ""}</td>
      <td class="num">${pl(e.profit)}<small>${e.cost > 0 ? pct(e.margin) + " margin" : ""}</small></td>
      <td class="num">${market}</td>
      <td class="num">${e.toVendor ? `${n0(e.crafts * r.qty)}` : rate(e.crafts * r.qty)}<small>${rate(e.crafts)} craft${e.crafts === 1 ? "" : "s"}</small></td>
      <td class="num mm-daily">${pl(e.daily)}</td>
    </tr>${open ? detail(e, sales) : ""}`;
  }).join("") || `<tr><td colspan="7" class="empty">No crafts match. Try lowering the minimum profit or margin, raising your skill, or ticking “Show unprofitable”.</td></tr>`;

  const h = [];
  if (rows.length > SHOW_MAX) h.push(`top ${SHOW_MAX} of ${rows.length} shown`);
  if (hidden.loss) h.push(`${hidden.loss} lose money`);
  if (hidden.low) h.push(`${hidden.low} below your minimum profit or margin`);
  if (hidden.risky) h.push(`${hidden.risky} unreliable markets`);
  if (hidden.nomarket) h.push(`${hidden.nomarket} never listed or sold (no price; may be bind-on-pickup)`);
  if (hidden.noreagents) h.push(`${hidden.noreagents} with reagents not available right now`);
  if (hidden.station) h.push(`${hidden.station} need a rare station`);
  if (hidden.pattern) h.push(`${hidden.pattern} need a pattern you excluded`);
  if (hidden.faction) h.push(`${hidden.faction} need a pattern only the other faction can buy (none on the AH now)`);
  if (hidden.skill) h.push(`${hidden.skill} above your skill`);
  if (hidden.enchant) h.push(`${hidden.enchant} enchantments (can't be sold)`);
  $("#hidden").innerHTML = h.length ? `Hidden: ${h.join(" · ")}.` : "";
  $("#perf").textContent = `Priced ${rows.length + Object.values(hidden).reduce((a, b) => a + b, 0)} recipes in ${Math.round(performance.now() - t0)} ms. Click a row for the breakdown.${rows.some(e => e.guess) ? " * guessed demand." : ""}`;
}

function paintStatus() {
  const s = SALES?.updated ? ` · sales ${ago(SALES.updated)}` : "";
  $("#status").classList.remove("err");
  $("#status").innerHTML = `Prices updated <b>${ago(PRICES.updated)}</b>${s} · rechecked every 10 min`;
  $("#status").title = `Last checked ${ago(new Date(loadedAt).toISOString())}. Blizzard publishes a new auction snapshot about once an hour.`;
  const up = $("#updated");
  if (up) up.textContent = `Prices from the ${PRICES.region} ${PRICES.ruleset.name} auction houses, updated ${ago(PRICES.updated)}.`;
}

function paintProfs() {
  const picked = Object.keys(state.profs).filter(k => state.profs[k] > 0);
  $("#profs").innerHTML = REC.professions.map(p => {
    const on = state.profs[p.name] > 0;
    return `<label class="mm-prof${on ? " on" : ""}"><input type="checkbox" data-prof="${esc(p.name)}" ${on ? "checked" : ""}> <span>${esc(p.name === "Mining" ? "Mining (smelting)" : p.name)}</span>
      <input type="number" min="1" max="300" data-skill="${esc(p.name)}" value="${on ? state.profs[p.name] : 300}" ${on ? "" : "disabled"} aria-label="${esc(p.name)} skill"></label>`;
  }).join("");
  $("#profhint").textContent = picked.length ? "Only recipes you can craft at these skills are listed. Smelting and other intermediates are used when they are cheaper than buying."
    : "None picked: showing every profession at 300. Tick yours and set your skill.";
}

function bind() {
  bindFaction(state, render);
  const set = (k, v, key = "mm:" + k) => { state[k] = v; store.set(key, v); render(); };
  $("#share").onchange = e => set("share", Number(e.target.value));
  $("#minprofit").oninput = e => store.set("mm:minProfitV2", true) || set("minProfit", Math.max(0, Number(e.target.value) || 0));
  $("#minmargin").oninput = e => set("minMargin", Math.max(0, Number(e.target.value) || 0));
  $("#time").oninput = e => set("time", Math.max(0, Number(e.target.value) || 0));
  $("#minsales").oninput = e => set("minSales", Math.max(0, Number(e.target.value) || 0));
  $("#patterns").onchange = e => { store.set("mm:patternsV2", true); set("patterns", e.target.value); };
  $("#sort").onchange = e => set("sort", e.target.value);
  $("#ownmode").onchange = e => set("ownMode", e.target.value);
  $("#neutral").onchange = e => set("neutral", e.target.checked, "neutral");
  $("#rare").onchange = e => set("rare", e.target.checked);
  $("#risky").onchange = e => set("risky", e.target.checked);
  $("#all").onchange = e => set("all", e.target.checked);
  document.querySelectorAll("[data-own]").forEach(c => {
    c.checked = state.own.has(c.dataset.own);
    c.onchange = () => { c.checked ? state.own.add(c.dataset.own) : state.own.delete(c.dataset.own); store.set("mm:own", [...state.own]); render(); };
  });
  $("#profs").onchange = e => {
    const t = e.target;
    if (t.dataset.prof) {
      const sk = $(`[data-skill="${CSS.escape(t.dataset.prof)}"]`);
      if (t.checked) state.profs[t.dataset.prof] = Math.max(1, Math.min(300, Number(sk.value) || 300)); else delete state.profs[t.dataset.prof];
      store.set("mm:profs", state.profs); paintProfs(); render();
    }
  };
  $("#profs").oninput = e => {
    const t = e.target;
    if (t.dataset.skill && state.profs[t.dataset.skill] > 0) {
      state.profs[t.dataset.skill] = Math.max(1, Math.min(300, Number(t.value) || 1));
      store.set("mm:profs", state.profs); render();
    }
  };
  const toggle = tr => { const id = Number(tr.dataset.id); state.open.has(id) ? state.open.delete(id) : state.open.add(id); render(); };
  $("#rows").onclick = e => { if (e.target.closest("a")) return; const tr = e.target.closest("tr.row"); if (tr) toggle(tr); };
  $("#rows").onkeydown = e => { const tr = e.target.closest("tr.row"); if (tr && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); toggle(tr); } };
}

async function fetchData() {
  const t = "?t=" + Date.now();
  const [prices, sales, trends] = await Promise.all([loadPrices(), loadJson("data/sales.json" + t).catch(() => null), loadJson("data/trends.json" + t).catch(() => null)]);
  PRICES = prices; SALES = sales; TRENDS = trends; loadedAt = Date.now();
}
// Keep the numbers live: recheck prices and sales every 10 minutes, and when a stale tab becomes visible.
async function refresh() {
  if (document.hidden) return;
  const before = PRICES?.updated;
  try { await fetchData(); } catch (e) { console.warn("refresh failed", e); return; }
  if (PRICES.updated !== before) render(); else paintStatus();
}

async function load() {
  try {
    const [rec] = await Promise.all([loadJson("data/recipes.json"), fetchData()]);
    REC = rec; ITEMS = REC.items;
    for (const p of REC.professions) for (const r of p.recipes) { r.prof = p.name; RECIPE.set(r.id, r); }
    $("#share").value = String(state.share);
    $("#minprofit").value = state.minProfit; $("#minmargin").value = state.minMargin; $("#time").value = state.time; $("#minsales").value = state.minSales;
    $("#patterns").value = state.patterns; $("#sort").value = state.sort; $("#ownmode").value = state.ownMode;
    $("#neutral").checked = state.neutral; $("#rare").checked = state.rare; $("#risky").checked = state.risky; $("#all").checked = state.all;
    paintProfs(); bind(); render();
    setInterval(refresh, REFRESH_MS);
    setInterval(() => PRICES && paintStatus(), 60e3);
    document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() - loadedAt > REFRESH_MS) refresh(); });
  } catch (e) {
    console.error(e);
    $("#status").textContent = "Could not load data. Try again shortly.";
    $("#status").classList.add("err");
  }
}
load();
