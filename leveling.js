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
  sell: (v => ["ah", "vendor", "none"].includes(v) ? v : "ah")(store.get("lv:sell", "ah")),
  wait: (v => [1, 3, 7].includes(v) ? v : 3)(store.get("lv:wait", 3)),
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

// --- selling the results -------------------------------------------------------------
// Blizzard's API shows listings, not sales. The price job compares hourly snapshots and counts
// listings that disappeared before they could expire (data/sales.json), which gives units sold per
// day. You can expect to sell at most your share of that demand while you keep relisting; the price
// is the lower of the cheapest listing now and the average price things actually sold at, minus the
// 5% cut. Until there are MIN_HOURS of sales history it falls back to the listing-based guess:
// at most a quarter of the units currently listed, at the cheapest listing.
const AH_CUT = 0.95, SHARE = 0.5, MIN_HOURS = 6, ABSORB = 0.25;
let SALES = null;
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
  const ahUnit = id => {
    const now = minPrice(book0, id), avg = stat(id).avg;
    const p = now != null && avg != null ? Math.min(now, avg) : now ?? avg;
    return p == null ? null : Math.floor(p * AH_CUT);
  };
  const cap = id => {
    if (info.ok) return Math.floor(stat(id).perDay * state.wait * SHARE);
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
  return { value, sold, made, ahUnit, stat, info };
}

function plan() {
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
  // record selling the output of n crafts of a step
  function sellOutput(st, n) {
    if (!st.r.item || n <= 0) return;
    const v = sales.value(st.r.item, st.r.qty * n, true);
    st.vendor += v.vendor; st.ah += v.ah; st.onAh += v.onAh;
    resaleVendor += v.vendor; resaleAh += v.ah;
  }
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
      st.crafts += need; st.cost += spent; total += spent; sellOutput(st, need);
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
      // Credit for the result in the chosen selling mode. Vendor credit is capped so "almost free" crafts
      // don't win with 100 green crafts per point; AH credit is limited by what the market can absorb.
      let back = 0;
      if (r.item && state.sell !== "none") {
        const v = sales.value(r.item, r.qty, false);
        back = state.sell === "ah" && v.onAh > 0 ? v.ah : Math.min(v.vendor, cost * 0.75);
      }
      const pat = learned.has(r.id) ? 0 : patternCost(book, r).cost;
      // cost per skill point. A profitable craft (net < 0) is scored by its profit per craft, not divided by
      // the skill-up chance, otherwise low-chance green recipes would look "better" the less they level you.
      const net = cost - back;
      const per = ((net >= 0 ? net / c : net) + timeCost / c + pat / 5) / r.ups; // amortise a pattern over ~5 points
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
      last = { r, from: s, to: s, crafts: 0, cost: 0, exp: 0, vendor: 0, ah: 0, onAh: 0, pattern: learned.get(r.id) };
      steps.push(last);
    }
    // buy the whole crafts this step has "earned" so far, so later prices reflect what we bought
    last.exp += 1 / best.c; last.to = s + r.ups;
    const due = Math.floor(last.exp + 1e-9) - last.crafts;
    if (due > 0) {
      const spent = craft(r, due, s);
      last.crafts += due; last.cost += spent; total += spent; sellOutput(last, due);
    }
    s += r.ups;
  }
  settle(steps[steps.length - 1]);
  const sellList = [...sales.made.entries()].map(([id, made]) => {
    const n = sales.sold.get(id) || 0, unit = sales.ahUnit(id), vend = ITEMS[id]?.s || 0;
    return { id, made, n, unit, vend, stat: sales.stat(id), value: n * (unit || 0) + (made - n) * vend };
  }).sort((a, b) => b.value - a.value);
  return { steps, shopping: [...shopping.values()], total, resaleVendor, resaleAh, stuck, book, sellList, salesInfo: sales.info, stat: sales.stat };
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
  return { ahBetter, vendorBetter: !ahBetter && st.vendor > 0, note };
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
  const p = plan();
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
      <div><span class="eyebrow">Skill</span><b>${state.from} → ${p.stuck ? p.stuck.s : state.to}</b></div>
    </div>`;
  $("#stuck").innerHTML = p.stuck ? `<p class="warn">Stopped at ${p.stuck.s}: the auction house doesn't have enough ${p.stuck.miss.map(id => wh(id, ITEMS[id]?.n || id)).join(", ") || "reagents"} for the remaining recipes. Try "I can smelt", Blackwater, more recipes or stations — or farm those yourself.</p>` : "";

  // Steps: the row shows what to craft, its reagents, cost and what you get back in the chosen mode.
  // Skill colours, the other selling mode, sales notes and recipe tags live in the expandable detail row.
  const retVendor = state.sell === "vendor";
  $("#retHead").textContent = retVendor ? "Vendor value" : "AH value (est.)";
  $("#steps").innerHTML = p.steps.map(st => {
    const r = st.r, key = `${r.id}@${st.from}`, open = OPEN_STEPS.has(key);
    const reag = r.reagents.map(([id, q]) => `${q} × ${wh(id, ITEMS[id]?.n || id)}`).join(", ");
    const pattern = r.source === "item" ? (st.pattern?.unknown ? "pattern: vendor/Favor/drop" : "pattern " + gold(st.pattern?.cost)) : "";
    const name = r.item ? wh(r.item, r.name) : esc(r.name);
    const s = sellInfo(st, p);
    const ret = !s ? `<td class="num c-ret"><span class="muted">—</span></td>`
      : `<td class="num c-ret${(retVendor ? s.vendorBetter : s.ahBetter) ? " better" : ""}" data-label="${retVendor ? "Vendor" : "AH"}">${gold(retVendor ? st.vendor : st.ah)}<small>${pl((retVendor ? st.vendor : st.ah) - st.cost)}</small></td>`;
    let html = `<tr class="row${open ? " open" : ""}" data-key="${key}" tabindex="0" aria-expanded="${open}">
      <td class="num rng">${st.from}–${st.to}</td>
      <td class="c-craft"><b>${st.crafts} × ${name}</b>${pattern ? ` <span class="tag pat" title="Learned from a pattern / recipe item">pattern</span>` : ""}<div class="meta">${reag}${r.needs ? ` · needs ${esc(r.needs)}` : ""}</div></td>
      <td class="num c-cost" data-label="Cost">${gold(st.cost)}</td>
      ${ret}
      <td class="num c-x"><button class="x" data-ex="${r.id}" title="Exclude this recipe and re-plan" aria-label="Exclude ${esc(r.name)} and re-plan">✕</button></td>
    </tr>`;
    if (open) {
      const tags = [
        pattern ? `<span class="tag pat">${pattern}</span>` : "",
        r.needs ? `<span class="tag">${esc(r.needs)}</span>` : "",
        r.isNew ? `<span class="tag new">new in Forever</span>` : "",
        r.est ? `<span class="tag">trainer skill est.</span>` : "",
      ].filter(Boolean).join(" ");
      html += `<tr class="detail"><td colspan="5"><div class="facts">
        <div><span class="k">Skill-up colours</span><span>learn ${r.learn} · <span class="o">${r.yellow}</span> <span class="y">${r.green}</span> <span class="gr">${r.grey}</span></span></div>
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
          <td class="num">${e.unit != null ? gold(e.unit) : "—"}${e.stat.avg != null ? `<small>sold avg ${gold(Math.round(e.stat.avg))}</small>` : ""}</td>
          <td class="num">${gold(e.vend)}</td>
          <td class="num">${gold(e.value)}</td></tr>`;
      }).join("")
    : `<tr><td colspan="7" class="empty">This route makes nothing that can be sold.</td></tr>`;

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

async function load() {
  try {
    [PRICES, REC, SALES] = await Promise.all([loadPrices(), loadJson("data/recipes.json"), loadJson("data/sales.json?t=" + Date.now()).catch(() => null)]);
    ITEMS = REC.items;
    $("#wait").value = state.wait;
    $("#prof").innerHTML = REC.professions.filter(p => p.name !== "Mining").map(p => `<option ${p.name === state.prof ? "selected" : ""}>${p.name}</option>`).join("");
    if (!REC.professions.some(p => p.name === state.prof)) state.prof = REC.professions[0].name;
    $("#from").value = state.from; $("#to").value = state.to;
    $("#patterns").value = state.patterns; $("#time").value = state.time; $("#sellmode").value = state.sell; $("#mining").checked = state.mining; $("#neutral").checked = state.neutral;
    $("#status").innerHTML = `Prices updated <b>${ago(PRICES.updated)}</b> · recipes from client build ${esc(REC.build)}`;
    bind(); render();
  } catch (e) {
    console.error(e);
    $("#status").textContent = "Could not load data. Try again shortly.";
    $("#status").classList.add("err");
  }
}
load();
