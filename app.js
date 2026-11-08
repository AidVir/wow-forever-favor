import { CRATES, ITEMS, RECIPES, ITEM_ID } from "./data/crates.js";

const $ = s => document.querySelector(s);
const store = {
  get(k, d) { try { const v = localStorage.getItem("wff:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("wff:" + k, JSON.stringify(v)); } catch {} },
};

const state = {
  faction: store.get("faction", "horde"),
  level: store.get("level", 60),
  bonus: store.get("bonus", 0),
  crateMode: store.get("crateMode", "buy"),
  profs: new Set(store.get("profs", [])),
  cat: store.get("cat", "All"),
  goal: store.get("goal", 1000),
  open: new Set(),
};
let DATA = null;

// ---------- money
function gold(c, { short = false } = {}) {
  if (c == null || !isFinite(c)) return "—";
  c = Math.round(c);
  const g = Math.floor(c / 10000), s = Math.floor((c % 10000) / 100), cp = c % 100;
  const parts = [];
  if (g) parts.push(`<span class="g">${g.toLocaleString("en-GB")}<i>g</i></span>`);
  if (s || (g && !short)) parts.push(`<span class="s">${s}<i>s</i></span>`);
  if (!g && (cp || !s)) parts.push(`<span class="c">${cp}<i>c</i></span>`);
  if (short && g >= 100) return parts[0];
  return parts.join(" ");
}

// ---------- pricing against a (mutable) copy of listings
function listingsFor(book, id) { return book[id] || []; }
// cost to buy qty units from cheapest listings; returns null if not enough listed
function buyCost(book, id, qty) {
  let left = qty, cost = 0;
  for (const [u, q] of listingsFor(book, id)) {
    const take = Math.min(left, q);
    cost += take * u; left -= take;
    if (left <= 0) return cost;
  }
  return null;
}
function consume(book, id, qty) {
  const l = book[id]; let left = qty;
  while (left > 0 && l && l.length) {
    const take = Math.min(left, l[0][1]);
    l[0][1] -= take; left -= take;
    if (l[0][1] <= 0) l.shift();
  }
}
function unitsListed(book, id) { return listingsFor(book, id).reduce((a, [, q]) => a + q, 0); }

// Cheapest way to obtain `qty` of item `name`: buy outright, or craft from raw mats if the profession is enabled.
function acquire(book, name, qty) {
  const id = ITEM_ID[name];
  const buy = buyCost(book, id, qty);
  let best = buy == null ? null : { cost: buy, how: "buy", mats: [[id, qty]] };
  const r = RECIPES[name];
  if (r && state.profs.has(r.prof)) {
    let cost = 0; const mats = [];
    for (const [m, per] of r.mats) {
      const need = Math.ceil(per * qty - 1e-9);
      const c = buyCost(book, ITEM_ID[m], need);
      if (c == null) { cost = null; break; }
      cost += c; mats.push([ITEM_ID[m], need]);
    }
    if (cost != null && (!best || cost < best.cost)) best = { cost, how: "craft", prof: r.prof, mats };
  }
  return best;
}

function expectedFavor(c) { return c.favor * (1 + 0.05 * state.bonus); }

function evalCrate(book, c) {
  const crateId = DATA?.crateIds?.[c.name];
  const crateCost = state.crateMode === "own" ? 0 : (crateId ? buyCost(book, crateId, 1) : null);
  const bundles = c.bundles.map(bd => {
    const name = ITEMS[bd.id];
    const a = acquire(book, name, bd.qty);
    return { ...bd, name, listed: unitsListed(book, bd.id), acq: a, cost: a?.cost ?? null };
  }).sort((x, y) => (x.cost ?? Infinity) - (y.cost ?? Infinity));
  const best = bundles[0]?.cost != null ? bundles[0] : null;
  const total = best && crateCost != null ? best.cost + crateCost : null;
  const fav = expectedFavor(c);
  return { c, crateId, crateCost, bundles, best, total, perFavor: total != null ? total / fav : null, fav };
}

// ---------- render
function bookFor(faction) {
  const src = DATA.factions[faction]?.items || {};
  const book = {};
  for (const [id, l] of Object.entries(src)) book[id] = l.map(x => x.slice());
  return book;
}

function available(c) { return c.level <= state.level; }

function render() {
  if (!DATA) return;
  document.querySelectorAll(".seg button").forEach(b => b.setAttribute("aria-checked", b.dataset.faction === state.faction));
  document.body.dataset.faction = state.faction;
  const f = DATA.factions[state.faction];
  $("#market").textContent = `${DATA.region} · ${DATA.ruleset.name} · ${f ? f.house.name : "—"}`;

  const book = bookFor(state.faction);
  const all = CRATES.map(c => evalCrate(book, c));
  const rows = all.filter(r => available(r.c) && (state.cat === "All" || r.c.cat === state.cat))
    .sort((a, b) => (a.perFavor ?? Infinity) - (b.perFavor ?? Infinity));

  renderHero(all.filter(r => available(r.c) && r.perFavor != null).sort((a, b) => a.perFavor - b.perFavor));
  renderCats();
  $("#rows").innerHTML = rows.map(rowHtml).join("") || `<tr><td colspan="7" class="empty">No crates for this filter.</td></tr>`;
  renderPlan();
}

function tierBadge(c) { return `<span class="tier t-${c.tier.toLowerCase()}">${c.tier}</span>`; }
function favorCell(r) {
  const est = r.c.favorEstimated ? ` <span class="est" title="Not published yet; estimated">est.</span>` : "";
  const exp = state.bonus ? `<small>${r.fav.toFixed(1)} avg</small>` : "";
  return `${r.c.favor}${est}${exp}`;
}
function bundleLabel(bd) {
  if (!bd) return `<span class="muted">Not enough listed</span>`;
  const craft = bd.acq?.how === "craft" ? ` <span class="craft" title="Cheaper to craft from raw materials">craft</span>` : "";
  return `${bd.qty} × ${bd.name}${craft}`;
}

function rowHtml(r) {
  const key = r.c.name;
  const open = state.open.has(key);
  const crateTxt = state.crateMode === "own" ? `<span class="muted">owned</span>` : (r.crateCost == null ? `<span class="muted">none listed</span>` : gold(r.crateCost));
  const short = r.c.name.replace("Waylaid Crate: ", "");
  let html = `<tr class="row${open ? " open" : ""}" data-key="${key}" tabindex="0">
    <td><div class="crate"><span class="caret">▸</span><div><b>${short}</b><div class="meta">${tierBadge(r.c)} ${r.c.cat} · lvl ${r.c.level}</div></div></div></td>
    <td class="num">${favorCell(r)}</td>
    <td>${bundleLabel(r.best)}</td>
    <td class="num">${gold(r.best?.cost)}</td>
    <td class="num">${crateTxt}</td>
    <td class="num"><b>${gold(r.total)}</b></td>
    <td class="num pf">${gold(r.perFavor)}</td>
  </tr>`;
  if (open) {
    html += `<tr class="detail"><td colspan="7"><div class="bundles">${r.bundles.map(bd => {
      const id = bd.id;
      const unit = listingsFor(DATA.factions[state.faction]?.items || {}, id)[0]?.[0];
      const craft = bd.acq?.how === "craft"
        ? `<div class="via">Craft with ${bd.acq.prof}: ${bd.acq.mats.map(([m, q]) => `${q} × ${ITEMS[m]}`).join(", ")}</div>` : "";
      return `<div class="bd${bd === r.best ? " best" : ""}">
        <div class="bd-name">${bd.qty} × <a href="https://www.wowhead.com/forever/item=${id}" target="_blank" rel="noopener">${bd.name}</a></div>
        <div class="bd-cost">${gold(bd.cost)}</div>
        <div class="bd-meta">from ${gold(unit)} each · ${bd.listed.toLocaleString("en-GB")} listed${trend(id)}</div>${craft}
      </div>`;
    }).join("")}</div>
    ${r.crateId ? `<p class="fine">Crate item: <a href="https://www.wowhead.com/forever/item=${r.crateId}" target="_blank" rel="noopener">${r.c.name}</a> · ${unitsListed(DATA.factions[state.faction]?.items || {}, r.crateId)} listed</p>` : ""}
    </td></tr>`;
  }
  return html;
}

function trend(id) {
  const h = DATA.history?.[state.faction]?.[id];
  if (!h || h.length < 2) return "";
  const now = h[h.length - 1][1];
  const dayAgo = (h.find(([t]) => Date.parse(t + ":00Z") >= Date.now() - 864e5) || h[0])[1];
  if (!dayAgo) return "";
  const pct = Math.round(((now - dayAgo) / dayAgo) * 100);
  if (Math.abs(pct) < 3) return "";
  return ` · <span class="${pct > 0 ? "up" : "down"}">${pct > 0 ? "▲" : "▼"} ${Math.abs(pct)}% 24h</span>`;
}

function renderHero(sorted) {
  const el = $("#hero");
  if (!sorted.length) { el.hidden = true; return; }
  el.hidden = false;
  const [b, ...rest] = sorted;
  const short = b.c.name.replace("Waylaid Crate: ", "");
  el.innerHTML = `
    <div class="hero-main">
      <div class="eyebrow">Cheapest Favor right now</div>
      <div class="hero-val">${gold(b.perFavor)} <span>per Favor</span></div>
      <div class="hero-what">${short} filled with <b>${b.best.qty} × ${b.best.name}</b>${b.best.acq.how === "craft" ? " (crafted)" : ""}
        — ${gold(b.total)} for ${b.c.favor} Favor${state.crateMode === "buy" ? ", crate included" : ""}</div>
    </div>
    <div class="hero-alt">
      <div class="eyebrow">Runners-up</div>
      ${rest.slice(0, 3).map(r => `<div class="alt"><span>${r.c.name.replace("Waylaid Crate: ", "")} · ${r.best.qty} × ${r.best.name}</span><b>${gold(r.perFavor)}</b></div>`).join("")}
    </div>`;
}

function renderCats() {
  const cats = ["All", ...new Set(CRATES.map(c => c.cat))];
  $("#cats").innerHTML = cats.map(c => `<button class="chip${c === state.cat ? " on" : ""}" data-cat="${c}">${c}</button>`).join("");
}

// Greedy plan: repeatedly take the cheapest marginal crate given what has already been bought.
function renderPlan() {
  const goal = Math.max(0, Number(state.goal) || 0);
  const book = bookFor(state.faction);
  const plan = new Map(); let favor = 0, cost = 0, guard = 0;
  while (favor < goal && guard++ < 2000) {
    const opts = CRATES.filter(available).map(c => evalCrate(book, c)).filter(r => r.perFavor != null);
    if (!opts.length) break;
    opts.sort((a, b) => a.perFavor - b.perFavor);
    const r = opts[0];
    const key = r.c.name + "|" + r.best.name + "|" + r.best.acq.how;
    const p = plan.get(key) || { r, n: 0, cost: 0, favor: 0 };
    p.n++; p.cost += r.total; p.favor += r.fav; plan.set(key, p);
    favor += r.fav; cost += r.total;
    for (const [id, q] of r.best.acq.mats) consume(book, id, q);
    if (r.crateId && state.crateMode === "buy") consume(book, r.crateId, 1);
  }
  const lines = [...plan.values()];
  const short = favor < goal;
  $("#plan").innerHTML = !lines.length ? `<p class="muted">Nothing on the auction house can fill a crate right now.</p>` : `
    <div class="plan-sum"><div><span class="eyebrow">Estimated cost</span><b>${gold(cost)}</b></div>
    <div><span class="eyebrow">Crates</span><b>${lines.reduce((a, p) => a + p.n, 0)}</b></div>
    <div><span class="eyebrow">Avg per Favor</span><b>${gold(cost / favor)}</b></div></div>
    ${short ? `<p class="warn">The auction house runs out after about ${Math.floor(favor)} Favor at these prices.</p>` : ""}
    <table class="plan"><thead><tr><th>Buy</th><th>Fill with</th><th class="num">Favor</th><th class="num">Cost</th></tr></thead><tbody>
    ${lines.map(p => `<tr><td>${p.n} × ${p.r.c.name.replace("Waylaid Crate: ", "")}</td>
      <td>${p.r.best.qty} × ${p.r.best.name} each${p.r.best.acq.how === "craft" ? ` <span class="craft">craft</span>` : ""}</td>
      <td class="num">${Math.round(p.favor)}</td><td class="num">${gold(p.cost)}</td></tr>`).join("")}
    </tbody></table>
    <p class="fine">Buys each crate from the cheapest listings still left after the previous ones, so it accounts for prices rising as you buy out the cheap stock.</p>`;
}

// ---------- events
function bind() {
  document.querySelectorAll(".seg button").forEach(b => b.onclick = () => { state.faction = b.dataset.faction; store.set("faction", state.faction); render(); });
  const lvl = $("#level"); lvl.value = state.level;
  lvl.oninput = () => { state.level = Number(lvl.value) || 60; store.set("level", state.level); render(); };
  const bonus = $("#bonus"); bonus.value = state.bonus;
  bonus.onchange = () => { state.bonus = Number(bonus.value); store.set("bonus", state.bonus); render(); };
  const cm = $("#crateMode"); cm.value = state.crateMode;
  cm.onchange = () => { state.crateMode = cm.value; store.set("crateMode", state.crateMode); render(); };
  document.querySelectorAll(".profs input").forEach(i => {
    i.checked = state.profs.has(i.value);
    i.onchange = () => { i.checked ? state.profs.add(i.value) : state.profs.delete(i.value); store.set("profs", [...state.profs]); render(); };
  });
  $("#cats").onclick = e => { const c = e.target.dataset?.cat; if (c) { state.cat = c; store.set("cat", c); render(); } };
  const toggle = tr => { const k = tr.dataset.key; state.open.has(k) ? state.open.delete(k) : state.open.add(k); render(); };
  $("#rows").onclick = e => { const tr = e.target.closest("tr.row"); if (tr && !e.target.closest("a")) toggle(tr); };
  $("#rows").onkeydown = e => { const tr = e.target.closest("tr.row"); if (tr && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); toggle(tr); } };
  const goal = $("#goal"); goal.value = state.goal;
  goal.oninput = () => { state.goal = Number(goal.value) || 0; store.set("goal", state.goal); renderPlan(); };
  const presets = [["Recipe (~180)", 180], ["Certification", 1000], ["Packmule Treat", 1500], ["Pack Kodo", 6000]];
  $("#presets").innerHTML = presets.map(([l, v]) => `<button class="chip" data-v="${v}">${l} · ${v}</button>`).join("");
  $("#presets").onclick = e => { const v = e.target.dataset?.v; if (v) { goal.value = v; goal.oninput(); } };
}

function ago(iso) {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return "just now"; if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

async function load() {
  bind();
  try {
    const r = await fetch("data/prices.json?t=" + Math.floor(Date.now() / 300000), { cache: "no-store" });
    if (!r.ok) throw new Error(r.status);
    DATA = await r.json();
    const f = Object.values(DATA.factions);
    $("#status").innerHTML = `Prices from the ${DATA.region} ${DATA.ruleset.name} auction houses, updated <b>${ago(DATA.updated)}</b>. Refreshes hourly.`;
    $("#updated").textContent = `Scanned ${new Date(DATA.updated).toLocaleString("en-GB")} · ${f.map(x => x.totalAuctions.toLocaleString("en-GB")).join(" / ")} auctions`;
    render();
  } catch (e) {
    $("#status").textContent = "Could not load price data yet. The hourly scan may not have run; try again shortly.";
    $("#status").classList.add("err");
  }
}
load();
