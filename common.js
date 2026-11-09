// Shared helpers for all pages.
export const $ = s => document.querySelector(s);
export const store = {
  get(k, d) { try { const v = localStorage.getItem("wff:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("wff:" + k, JSON.stringify(v)); } catch {} },
};
export const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function gold(c, { short = false } = {}) {
  if (c == null || !isFinite(c)) return "—";
  const neg = c < 0; c = Math.abs(Math.round(c));
  const g = Math.floor(c / 10000), s = Math.floor((c % 10000) / 100), cp = c % 100;
  const parts = [];
  if (g) parts.push(`<span class="g">${g.toLocaleString("en-GB")}<i>g</i></span>`);
  if (s || (g && !short)) parts.push(`<span class="s">${s}<i>s</i></span>`);
  if (!g && (cp || !s)) parts.push(`<span class="c">${cp}<i>c</i></span>`);
  const out = short && g >= 100 ? parts[0] : parts.join(" ");
  return neg ? "−" + out : out;
}

// A price "book": itemId -> [[unitPrice, qty], ...] sorted cheapest first (mutable copy).
export function makeBook(DATA, faction, neutral) {
  const book = {};
  const srcs = [DATA.factions[faction]?.items || {}];
  if (neutral && DATA.factions.neutral) srcs.push(DATA.factions.neutral.items);
  for (const src of srcs) for (const [id, l] of Object.entries(src)) (book[id] ||= []).push(...l.map(x => x.slice()));
  for (const l of Object.values(book)) l.sort((a, b) => a[0] - b[0]);
  return book;
}
export function buyCost(book, id, qty) {
  let left = qty, cost = 0;
  for (const [u, q] of book[id] || []) {
    const take = Math.min(left, q);
    cost += take * u; left -= take;
    if (left <= 0) return cost;
  }
  return null;
}
export function consume(book, id, qty) {
  const l = book[id]; let left = qty;
  while (left > 0 && l && l.length) {
    const take = Math.min(left, l[0][1]);
    l[0][1] -= take; left -= take;
    if (l[0][1] <= 0) l.shift();
  }
}
export const listed = (book, id) => (book[id] || []).reduce((a, [, q]) => a + q, 0);
export const minPrice = (book, id) => book[id]?.[0]?.[0] ?? null;

export async function loadPrices() {
  const r = await fetch("data/prices.json?t=" + Math.floor(Date.now() / 300000), { cache: "no-store" });
  if (!r.ok) throw new Error("prices " + r.status);
  return r.json();
}
export async function loadJson(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(path + " " + r.status);
  return r.json();
}
export function ago(iso) {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return "just now"; if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

// Faction toggle wiring shared by every page header.
export function bindFaction(state, onChange) {
  document.querySelectorAll(".seg button").forEach(b => {
    b.onclick = () => { state.faction = b.dataset.faction; store.set("faction", state.faction); paintFaction(state); onChange(); };
  });
  paintFaction(state);
}
function paintFaction(state) {
  document.querySelectorAll(".seg button").forEach(b => b.setAttribute("aria-checked", b.dataset.faction === state.faction));
  document.body.dataset.faction = state.faction;
}
export const wh = (id, text) => `<a href="https://www.wowhead.com/forever/item=${id}" target="_blank" rel="noopener">${esc(text)}</a>`;

// --- cost / sales models used by money.js (leveling.js still has its own copies; it can switch to these) ---
// Cheapest way to get `qty` of an item right now: vendor (unlimited), AH (walks the order book for
// the whole quantity, it does not consume it), or crafting it from a recipe ctx.can(r) allows, up to
// 2 levels deep. ctx = { book, makers: Map(itemId -> recipes), items: recipes.json items,
// can(recipe) -> bool, own?(itemId) -> unit cost or null (reagents you gather yourself) }.
// Returns { cost, plan: [[kind, id, qty]] } with kind "ah" | "vendor" | "craft" (id = recipe id) | "own",
// or null when the item can't be had.
export function acquire(ctx, id, qty, depth = 0) {
  const own = ctx.own?.(id);
  if (own != null) return { cost: own * qty, plan: [["own", id, qty]] };
  const it = ctx.items[id];
  let best = null;
  const ah = buyCost(ctx.book, id, qty);
  if (ah != null) best = { cost: ah, plan: [["ah", id, qty]] };
  if (it?.v != null && (!best || it.v * qty < best.cost)) best = { cost: it.v * qty, plan: [["vendor", id, qty]] };
  if (depth < 2) {
    for (const r of ctx.makers.get(id) || []) {
      if (!ctx.can(r)) continue;
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

// Units sold per item, measured by the price bot (data/sales.json) for the given houses.
// hours = snapshot time covered by every house (the smallest); ok = enough history to trust a rate.
// stat(id) -> { units, value, perDay, avg } where avg is the average price a unit sold at.
export function salesStats(SALES, factions, minHours = 6) {
  const fs = factions.map(f => SALES?.factions?.[f]).filter(Boolean);
  const hours = fs.length ? Math.min(...fs.map(f => f.hours || 0)) : 0;
  const cache = new Map();
  const stat = id => {
    if (cache.has(id)) return cache.get(id);
    let units = 0, value = 0;
    for (const f of fs) for (const [, n, v] of f.items[id] || []) { units += n; value += v; }
    const s = { units, value, perDay: hours ? units / hours * 24 : 0, avg: units ? value / units : null };
    cache.set(id, s); return s;
  };
  return { fs, hours, ok: hours >= minHours, stat };
}

// --- market trends (data/trends.json from the price bot; sales.json as a fallback) -----------------
// marketTrend(...) -> { pct, perDay, supply, src } or null
//   pct     recent price change (for arrows and spike flags)
//   perDay  daily price change used to project sell prices (negative = falling)
//   supply  change in units listed over 24 h (positive = more competition piling up)
// The bot's price is the average of the cheapest 10% of listed units, so one cheap listing can't fake a crash.
export function marketTrend(TRENDS, SALES, faction, id) {
  const t = TRENDS?.factions?.[faction]?.[id];
  if (t) {
    const [p0, p24, p72, l0, l24] = t;
    const supply = l24 ? l0 / l24 - 1 : null;
    if (p0 && p72) return { pct: p24 ? p0 / p24 - 1 : p0 / p72 - 1, perDay: (p0 / p72) ** (1 / 3) - 1, supply, src: "market price, last 3 days" };
    if (p0 && p24) return { pct: p0 / p24 - 1, perDay: p0 / p24 - 1, supply, src: "market price, last 24 h" };
  }
  // Fallback until the bot has 24 h of history: average sold price of the last 6 h against the hours
  // before. Noisier, so it only counts half as a daily trend.
  const rows = SALES?.factions?.[faction]?.items?.[id];
  if (!rows?.length) return null;
  const now = Date.parse(SALES.updated || new Date().toISOString());
  let ru = 0, rv = 0, eu = 0, ev = 0;
  for (const [hr, n, v] of rows) {
    if (now - Date.parse(hr + ":00:00Z") < 6 * 3.6e6) { ru += n; rv += v; } else { eu += n; ev += v; }
  }
  if (ru < 3 || eu < 3) return null;
  const pct = (rv / ru) / (ev / eu) - 1;
  return { pct, perDay: Math.max(-0.25, pct / 2), supply: null, src: "average sold price, last 6 h vs earlier" };
}

// What `price` is likely to be in `days` days if a falling trend continues. Never projects a rise
// (you can't count on that), caps the fall at 50% a day and never goes below 40% of today's price.
export function projectPrice(price, tr, days) {
  if (price == null || !tr || !(tr.perDay < 0) || days <= 0) return price;
  return Math.floor(price * Math.max(0.4, (1 + Math.max(tr.perDay, -0.5)) ** days));
}

// "▼8%/day" style label for a trend (empty when flat)
export const trendLabel = (tr, perDay = false) => {
  const v = perDay ? tr?.perDay : tr?.pct;
  if (v == null || Math.abs(v) < 0.03) return "";
  return `<span class="trend ${v > 0 ? "up" : "down"}" title="${esc(tr.src)}">${v > 0 ? "▲" : "▼"}${Math.abs(Math.round(v * 100))}%${perDay ? "/day" : ""}</span>`;
};
