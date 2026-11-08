import { $, store, esc, gold, makeBook, buyCost, listed, minPrice, loadPrices, loadJson, ago, bindFaction, wh } from "./common.js";
import { WRITS, ENVELOPES, WRIT_REP } from "./data/writs.js";

const PROFS = ["Alchemy", "Blacksmithing", "Engineering", "Leatherworking", "Tailoring"];
const state = {
  faction: store.get("faction", "horde"),
  neutral: store.get("neutral", false),
  own: store.get("wr:own", "have"),
  profs: new Set(store.get("wr:profs", [])),
  rank: store.get("wr:rank", "All"),
  prof: store.get("wr:prof", "All"),
};
let PRICES, REC, ITEMS, MAKERS;

// Cheapest way to get qty of an item: AH or vendor; one level of crafting for reagents.
function obtain(book, id, qty, depth = 0) {
  let best = null;
  const ah = buyCost(book, id, qty);
  if (ah != null) best = { cost: ah, how: "buy" };
  const v = ITEMS[id]?.v;
  if (v != null && (!best || v * qty < best.cost)) best = { cost: v * qty, how: "vendor" };
  if (depth < 2) for (const { r, prof } of MAKERS.get(id) || []) {
    if (prof !== "Mining" && !state.profs.has(prof)) continue;
    const crafts = Math.ceil(qty / r.qty);
    let cost = 0;
    for (const [rid, rq] of r.reagents) {
      const o = obtain(book, rid, rq * crafts, depth + 1);
      if (!o) { cost = null; break; }
      cost += o.cost;
    }
    if (cost != null && (!best || cost < best.cost)) best = { cost, how: "craft", r, prof };
  }
  return best;
}

function rows(book) {
  return WRITS.map(w => {
    const fill = obtain(book, w.item, w.qty);
    const writCost = state.own === "have" ? 0 : buyCost(book, w.id, 1);
    const total = fill && writCost != null ? fill.cost + writCost : null;
    return { w, fill, writCost, total, per100: total != null ? total / w.rep * 100 : null };
  });
}

function render() {
  if (!PRICES) return;
  $("#market").textContent = `${PRICES.region} · ${PRICES.ruleset.name} · ${PRICES.factions[state.faction].house.name}${state.neutral ? " + Blackwater" : ""}`;
  const book = makeBook(PRICES, state.faction, state.neutral);
  const all = rows(book);
  const other = state.faction === "horde" ? "Alliance" : "Horde";
  const shown = all.filter(x => x.w.side !== other && (state.rank === "All" || x.w.rank === state.rank) && (state.prof === "All" || x.w.prof === state.prof))
    .sort((a, b) => (a.per100 ?? Infinity) - (b.per100 ?? Infinity));

  // envelopes: buy a sealed envelope, get a random writ of that rank, fill it with the cheapest way
  const envHtml = Object.entries(ENVELOPES).map(([rank, id]) => {
    const pool = all.filter(x => x.w.rank === rank && x.w.side !== other && x.fill);
    const avgFill = pool.length ? pool.reduce((a, x) => a + x.fill.cost, 0) / pool.length : null;
    const env = minPrice(book, id);
    const tot = env != null && avgFill != null ? env + avgFill : null;
    return `<div class="alt"><span>Sealed ${rank}'s Writ<small>${env != null ? `envelope ${gold(env)}` : "no envelopes listed"} · avg fill ${gold(avgFill)} · ${WRIT_REP[rank]} rep</small></span>
      <b class="env-val">${tot != null ? gold(tot / WRIT_REP[rank] * 100) : "—"}</b></div>`;
  }).join("");

  const best = shown.find(x => x.per100 != null);
  $("#hero").innerHTML = best ? `<div class="hero-main"><div class="eyebrow">Cheapest reputation right now</div>
      <div class="hero-val">${gold(best.per100)} <span>per 100 rep</span></div>
      <div class="hero-what">${esc(ITEMS[best.w.id]?.n || "")} — ${best.fill.how === "craft" ? `craft it (${esc(best.fill.prof)})` : "buy"} ${best.w.qty > 1 ? best.w.qty + " × " : ""}${wh(best.w.item, ITEMS[best.w.item]?.n || best.w.item)} for ${gold(best.total)}, ${best.w.rep} rep</div></div>
      <div class="hero-alt"><div class="eyebrow">Or open sealed envelopes · per 100 rep</div>${envHtml}</div>` : "";

  const row = x => {
    const w = x.w, name = (ITEMS[w.id]?.n || "").replace(/^Craftsman's Writ: /, "");
    const how = !x.fill ? `<span class="muted">not available</span>`
      : x.fill.how === "craft" ? `<span class="craft">craft</span> ${x.fill.r.reagents.map(([id, q]) => `${q * Math.ceil(w.qty / x.fill.r.qty)} × ${esc(ITEMS[id]?.n || id)}`).join(", ")}`
      : x.fill.how === "vendor" ? "vendor" : `buy · ${listed(book, w.item)} listed`;
    return `<tr>
      <td class="c-name"><b>${wh(w.id, name)}</b><div class="meta"><span class="tier t-${w.rank.toLowerCase()}">${w.rank}</span> · ${w.prof} · skill ${w.skill}${w.side ? ` · <span class="side ${w.side.toLowerCase()}">${w.side} only</span>` : ""}</div></td>
      <td class="num c-rep" data-label="Rep">${w.rep}</td>
      <td class="c-fill">${w.qty > 1 ? w.qty + " × " : ""}${wh(w.item, ITEMS[w.item]?.n || w.item)}<div class="meta">${how}</div></td>
      <td class="num c-cost" data-label="Item">${gold(x.fill?.cost)}</td>
      <td class="num c-writ" data-label="Writ">${state.own === "have" ? `<span class="muted">${gold(minPrice(book, w.id))}</span>` : gold(x.writCost)}</td>
      <td class="num pf">${gold(x.per100)}</td>
    </tr>`;
  };
  // Writs that can't be priced right now (nothing listed to fill them) are folded away behind one row.
  const priced = shown.filter(x => x.per100 != null), unpriced = shown.filter(x => x.per100 == null);
  const fold = !unpriced.length ? ""
    : `<tr class="more-row"><td colspan="6"><button class="linkbtn" id="toggleUnpriced" aria-expanded="${showUnpriced}">${showUnpriced ? "Hide" : "Show"} ${unpriced.length} writ${unpriced.length > 1 ? "s" : ""} that can't be priced right now</button></td></tr>`;
  $("#rows").innerHTML = (priced.map(row).join("") + fold + (showUnpriced ? unpriced.map(row).join("") : ""))
    || `<tr><td colspan="6" class="empty">No writs for this filter.</td></tr>`;
}
let showUnpriced = false;

function chips(el, values, key) {
  el.innerHTML = values.map(v => `<button class="chip${v === state[key] ? " on" : ""}" aria-pressed="${v === state[key]}" data-v="${v}">${v}</button>`).join("");
  el.onclick = e => { const v = e.target.dataset?.v; if (v) { state[key] = v; store.set("wr:" + key, v); chips(el, values, key); render(); } };
}

function bind() {
  bindFaction(state, render);
  const own = $("#own"); own.value = state.own;
  own.onchange = () => { state.own = own.value; store.set("wr:own", state.own); render(); };
  const nt = $("#neutral"); nt.checked = state.neutral;
  nt.onchange = () => { state.neutral = nt.checked; store.set("neutral", state.neutral); render(); };
  document.querySelectorAll(".profs input").forEach(i => {
    i.checked = state.profs.has(i.value);
    i.onchange = () => { i.checked ? state.profs.add(i.value) : state.profs.delete(i.value); store.set("wr:profs", [...state.profs]); render(); };
  });
  $("#rows").onclick = e => { if (e.target.id === "toggleUnpriced") { showUnpriced = !showUnpriced; render(); $("#toggleUnpriced")?.focus(); } };
  chips($("#ranks"),["All", "Journeyman", "Expert", "Artisan"], "rank");
  chips($("#profFilter"), ["All", ...PROFS], "prof");
}

async function load() {
  try {
    [PRICES, REC] = await Promise.all([loadPrices(), loadJson("data/recipes.json")]);
    ITEMS = REC.items;
    MAKERS = new Map();
    for (const p of REC.professions) for (const r of p.recipes) if (r.item) (MAKERS.get(r.item) || MAKERS.set(r.item, []).get(r.item)).push({ r, prof: p.name });
    $("#status").innerHTML = `Prices updated <b>${ago(PRICES.updated)}</b>`;
    bind(); render();
  } catch (e) {
    console.error(e);
    $("#status").textContent = "Could not load data. Try again shortly.";
    $("#status").classList.add("err");
  }
}
load();
