import { $, store, esc, gold, makeBook, buyCost, consume, listed, minPrice, loadPrices, loadJson, ago, bindFaction, wh } from "./common.js";

const RARE_STATIONS = new Set(["Black Anvil", "Black Forge", "Arcane Forge", "Moonwell", "Icebellow Anvil", "Master Forge", "Anarchist's Workbench"]);
const state = {
  faction: store.get("faction", "horde"),
  neutral: store.get("neutral", false),
  prof: store.get("lv:prof", "Alchemy"),
  from: store.get("lv:from", 1),
  to: store.get("lv:to", 300),
  patterns: (v => typeof v === "string" ? v : "all")(store.get("lv:patterns", "all")),
  time: store.get("lv:time", 0),
  sellback: store.get("lv:sellback", true),
  mining: store.get("lv:mining", false),
  stationsOff: new Set(store.get("lv:stationsOff", null) ?? [...RARE_STATIONS]),
  excluded: new Set(store.get("lv:excluded", [])),
};
let PRICES, REC, ITEMS;

const chance = (r, s) => s < r.yellow ? 1 : s >= r.grey ? 0 : (r.grey - s) / (r.grey - r.yellow);
const color = (r, s) => s < r.yellow ? "orange" : s < r.green ? "yellow" : s < r.grey ? "green" : "grey";

function profData() { return REC.professions.find(p => p.name === state.prof); }

// Cheapest way to get `qty` of an item right now: vendor (unlimited), AH (consumes book), or craft it
// with this profession if a recipe is known at the current skill. Returns {cost, plan:[[kind,id,qty]]}.
function acquire(ctx, id, qty, depth = 0) {
  const it = ITEMS[id];
  let best = null;
  const ah = buyCost(ctx.book, id, qty);
  if (ah != null) best = { cost: ah, plan: [["ah", id, qty]] };
  if (it?.v != null && (!best || it.v * qty < best.cost)) best = { cost: it.v * qty, plan: [["vendor", id, qty]] };
  if (depth < 2) {
    for (const r of ctx.makers.get(id) || []) {
      if ((!r.helper && r.learn > ctx.skill) || !allowed(r)) continue;
      const crafts = Math.ceil(qty / r.qty);
      let cost = 0, plan = [["craft", r.id, crafts]];
      for (const [rid, rq] of r.reagents) {
        const a = acquire(ctx, rid, rq * crafts, depth + 1);
        if (!a) { cost = null; break; }
        cost += a.cost; plan = plan.concat(a.plan);
      }
      if (cost != null && (!best || cost < best.cost)) best = { cost, plan };
    }
  }
  return best;
}
let BOOK0 = {};
function allowed(r) {
  if (state.excluded.has(r.id)) return false;
  if (r.needs && state.stationsOff.has(r.needs)) return false;
  if (r.source === "item") {
    if (state.patterns === "trainer") return false;
    if (state.patterns === "buyable" && patternCost(BOOK0, r).unknown) return false;
  }
  return true;
}
// One-time cost to learn a pattern recipe: AH price of the cheapest teaching item, else vendor price, else unknown (0).
function patternCost(book, r) {
  if (r.source !== "item") return { cost: 0 };
  let best = null;
  for (const id of r.recipeItems) {
    const p = minPrice(book, id); const v = ITEMS[id]?.v;
    for (const c of [p, v]) if (c != null && (!best || c < best.cost)) best = { cost: c, id };
  }
  return best || { cost: 0, unknown: true };
}

function plan() {
  const prof = profData();
  BOOK0 = makeBook(PRICES, state.faction, state.neutral);
  const book = makeBook(PRICES, state.faction, state.neutral);
  const makers = new Map();
  const helpers = state.mining && prof.name !== "Mining" ? REC.professions.find(p => p.name === "Mining").recipes.map(r => ({ ...r, helper: true })) : [];
  for (const r of [...prof.recipes, ...helpers]) if (r.item) (makers.get(r.item) || makers.set(r.item, []).get(r.item)).push(r);
  const learned = new Map(); // recipe id -> pattern info (charged once)
  const steps = []; const shopping = new Map(); let total = 0, resale = 0, stuck = null;
  const timeCost = Math.max(0, Number(state.time) || 0) * 100; // silver per craft -> copper

  // buy + consume reagents for n crafts of r at skill s; returns gold spent
  function craft(r, n, s) {
    let spent = 0;
    for (let k = 0; k < n; k++) {
      const ctx2 = { book, makers, skill: s };
      for (const [id, q] of r.reagents) {
        const a = acquire(ctx2, id, q);
        if (!a) continue;
        spent += a.cost;
        for (const [kind, iid, qq] of a.plan) {
          if (kind === "craft") continue;
          if (kind === "ah") consume(book, iid, qq);
          const e = shopping.get(iid) || { id: iid, ah: 0, vendor: 0 };
          e[kind] += qq; shopping.set(iid, e);
        }
      }
    }
    return spent;
  }
  // close a step: buy whatever whole crafts its expected count still needs
  function settle(st) {
    if (!st) return;
    const need = Math.max(1, Math.round(st.exp)) - st.crafts;
    if (need > 0) {
      const spent = craft(st.r, need, st.to - 1);
      st.crafts += need; st.cost += spent; total += spent; resale += st.back * need;
    }
  }

  for (let s = Math.max(1, state.from); s < Math.min(300, state.to); ) {
    const ctx = { book, makers, skill: s };
    let best = null;
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
      // vendor value of the result, capped so "almost free" crafts don't win with 100 green crafts per point
      const back = state.sellback && r.item ? Math.min((ITEMS[r.item]?.s || 0) * r.qty, cost * 0.75) : 0;
      const pat = learned.has(r.id) ? 0 : patternCost(book, r).cost;
      const per = ((cost - back + timeCost) / c + pat / 5) / r.ups; // amortise a pattern over ~5 points
      if (!best || per < best.per) best = { r, per, cost, back, c, plan };
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
    if (!learned.has(r.id)) {
      const pc = patternCost(book, r); learned.set(r.id, pc);
      if (pc.id && pc.cost) { total += pc.cost; if (minPrice(book, pc.id) === pc.cost) consume(book, pc.id, 1); }
    }
    let last = steps[steps.length - 1];
    if (!last || last.r !== r) {
      settle(last);
      last = { r, from: s, to: s, crafts: 0, cost: 0, exp: 0, back: best.back, pattern: learned.get(r.id) };
      steps.push(last);
    }
    // buy the whole crafts this step has "earned" so far, so later prices reflect what we bought
    last.exp += 1 / best.c; last.to = s + r.ups;
    const due = Math.floor(last.exp + 1e-9) - last.crafts;
    if (due > 0) {
      const spent = craft(r, due, s);
      last.crafts += due; last.cost += spent; total += spent; resale += best.back * due;
    }
    s += r.ups;
  }
  settle(steps[steps.length - 1]);
  return { steps, shopping: [...shopping.values()], total, resale, stuck, book };
}

function render() {
  if (!PRICES || !REC) return;
  const prof = profData();
  $("#market").textContent = `${PRICES.region} · ${PRICES.ruleset.name} · ${PRICES.factions[state.faction].house.name}${state.neutral ? " + Blackwater" : ""}`;
  // station toggles for this profession
  const stations = [...new Set(prof.recipes.map(r => r.needs).filter(Boolean))].sort();
  $("#stations").innerHTML = stations.length ? stations.map(n => `<label class="chk"><input type="checkbox" data-station="${esc(n)}" ${state.stationsOff.has(n) ? "" : "checked"}> ${esc(n)}</label>`).join("") : `<span class="muted">None needed</span>`;

  const t0 = performance.now();
  const p = plan();
  const net = p.total - p.resale;
  $("#summary").innerHTML = `
    <div><span class="eyebrow">Materials${state.patterns !== "trainer" ? " + patterns" : ""}</span><b>${gold(p.total)}</b></div>
    ${state.sellback ? `<div><span class="eyebrow">Vendor the results</span><b>−${gold(p.resale)}</b></div><div><span class="eyebrow">Net cost</span><b>${gold(net)}</b></div>` : ""}
    <div><span class="eyebrow">Crafts</span><b>${p.steps.reduce((a, s) => a + s.crafts, 0).toLocaleString("en-GB")}</b></div>
    <div><span class="eyebrow">Skill</span><b>${state.from} → ${p.stuck ? p.stuck.s : state.to}</b></div>`;
  $("#stuck").innerHTML = p.stuck ? `<p class="warn">Stopped at ${p.stuck.s}: the auction house doesn't have enough ${p.stuck.miss.map(id => wh(id, ITEMS[id]?.n || id)).join(", ") || "reagents"} for the remaining recipes. Try "I can smelt", Blackwater, more recipes or stations — or farm those yourself.</p>` : "";

  $("#steps").innerHTML = p.steps.map(st => {
    const r = st.r;
    const reag = r.reagents.map(([id, q]) => `${q} × ${wh(id, ITEMS[id]?.n || id)}`).join(", ");
    const tags = [
      r.source === "item" ? `<span class="tag pat" title="Learned from a pattern / recipe item">${st.pattern?.unknown ? "pattern: vendor/Favor/drop" : "pattern " + gold(st.pattern?.cost)}</span>` : "",
      r.needs ? `<span class="tag">${esc(r.needs)}</span>` : "",
      r.isNew ? `<span class="tag new">new in Forever</span>` : "",
      r.est ? `<span class="tag">trainer skill est.</span>` : "",
    ].join(" ");
    const name = r.item ? wh(r.item, r.name) : esc(r.name);
    return `<tr>
      <td class="num rng">${st.from}–${st.to}</td>
      <td><b>${st.crafts} × ${name}</b> ${tags}<div class="meta">${reag} · learn ${r.learn} · <span class="o">${r.yellow}</span> <span class="y">${r.green}</span> <span class="gr">${r.grey}</span></div></td>
      <td class="num">${gold(st.cost)}</td>
      <td class="num"><button class="x" data-ex="${r.id}" title="Exclude this recipe and re-plan">✕</button></td>
    </tr>`;
  }).join("") || `<tr><td colspan="4" class="empty">Nothing to plan.</td></tr>`;

  const shop = p.shopping.filter(e => e.ah || e.vendor).sort((a, b) => (b.ah + b.vendor) - (a.ah + a.vendor));
  $("#shop").innerHTML = shop.map(e => `<tr><td>${wh(e.id, ITEMS[e.id]?.n || e.id)}</td>
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
  $("#sellback").onchange = e => set("sellback", e.target.checked);
  $("#mining").onchange = e => set("mining", e.target.checked);
  $("#neutral").onchange = e => set("neutral", e.target.checked);
  $("#stations").onchange = e => {
    const n = e.target.dataset.station; if (!n) return;
    e.target.checked ? state.stationsOff.delete(n) : state.stationsOff.add(n);
    store.set("lv:stationsOff", [...state.stationsOff]); render();
  };
  $("#steps").onclick = e => { const id = Number(e.target.dataset?.ex); if (id) { state.excluded.add(id); store.set("lv:excluded", [...state.excluded]); render(); } };
  $("#excl").onclick = e => { const id = Number(e.target.dataset?.unex); if (id) { state.excluded.delete(id); store.set("lv:excluded", [...state.excluded]); render(); } };
}

async function load() {
  try {
    [PRICES, REC] = await Promise.all([loadPrices(), loadJson("data/recipes.json")]);
    ITEMS = REC.items;
    $("#prof").innerHTML = REC.professions.filter(p => p.name !== "Mining").map(p => `<option ${p.name === state.prof ? "selected" : ""}>${p.name}</option>`).join("");
    if (!REC.professions.some(p => p.name === state.prof)) state.prof = REC.professions[0].name;
    $("#from").value = state.from; $("#to").value = state.to;
    $("#patterns").value = state.patterns; $("#time").value = state.time; $("#sellback").checked = state.sellback; $("#mining").checked = state.mining; $("#neutral").checked = state.neutral;
    $("#status").innerHTML = `Prices from the ${PRICES.region} ${PRICES.ruleset.name} auction houses, updated <b>${ago(PRICES.updated)}</b>. Recipes from WoW Forever client build ${REC.build}.`;
    bind(); render();
  } catch (e) {
    console.error(e);
    $("#status").textContent = "Could not load data. Try again shortly.";
    $("#status").classList.add("err");
  }
}
load();
