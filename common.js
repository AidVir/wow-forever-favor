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
