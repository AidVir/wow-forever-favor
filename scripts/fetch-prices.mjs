// Fetches WoW Forever auction house data (EU, PvP ruleset) from the Blizzard Game Data API
// and writes data/prices.json with the cheapest listings for every item a Waylaid Crate needs.
//
// Env: BLIZZARD_CLIENT_ID, BLIZZARD_CLIENT_SECRET
// Optional: REGION (default eu), RULESET_ID (default 1 = PvP), PROBE=1 to just print the house index.
import { readFile, writeFile, mkdir, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { CRATES, ITEMS } from "../data/crates.js";
import { WRIT_ITEM_IDS } from "../data/writs.js";

const REGION = process.env.REGION || "eu";
const RULESET_ID = Number(process.env.RULESET_ID || 1);
const HOST = `https://${REGION}.api.blizzard.com`;
const DYN = `dynamic-forever-${REGION}`;
const STATIC = `static-forever-${REGION}`;
const OUT = new URL("../data/prices.json", import.meta.url);
const CRATE_IDS = new URL("../data/crate-ids.json", import.meta.url);
const HOUSES_FILE = new URL("../data/houses.json", import.meta.url);
const MAX_UNITS = 1500; // keep enough cheap units per item to price a full 1-300 route
const SALES = new URL("../data/sales.json", import.meta.url);
// Previous snapshot's listings, kept between runs (GitHub Actions cache in CI, not committed).
const STATE = new URL("../.cache/ah-state.json", import.meta.url);
const SALES_DAYS = 7;

async function token() {
  const id = process.env.BLIZZARD_CLIENT_ID, secret = process.env.BLIZZARD_CLIENT_SECRET;
  if (!id || !secret) throw new Error("BLIZZARD_CLIENT_ID / BLIZZARD_CLIENT_SECRET not set");
  const r = await fetch("https://oauth.battle.net/token", {
    method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!r.ok) throw new Error(`token ${r.status} ${await r.text()}`);
  return (await r.json()).access_token;
}

let TOKEN;
async function api(path, ns, { allow404 = false, ims = null } = {}) {
  const sep = path.includes("?") ? "&" : "?";
  const url = `${HOST}${path}${sep}namespace=${ns}&locale=en_GB`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const headers = { Authorization: `Bearer ${TOKEN}`, "Accept-Encoding": "gzip" };
    if (ims) headers["If-Modified-Since"] = ims;
    const r = await fetch(url, { headers });
    if (r.status === 304) return { notModified: true, lastModified: ims };
    if (r.status === 404 && allow404) return null;
    if (r.status === 429 || r.status >= 500) { await new Promise(s => setTimeout(s, 2000 * (attempt + 1))); continue; }
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return { json: await r.json(), lastModified: r.headers.get("last-modified") };
  }
  throw new Error("retries exhausted " + url);
}

const nameOf = n => (typeof n === "string" ? n : n?.en_GB || n?.en_US || Object.values(n || {})[0] || "");

async function houseIndex() {
  for (const p of [`/data/wow/ruleset/${RULESET_ID}/auctions/`, `/data/wow/ruleset/${RULESET_ID}/auctions/index`]) {
    const res = await api(p, DYN, { allow404: true });
    if (res) return res.json.auctions.map(h => ({ id: h.id, name: nameOf(h.name) }));
  }
  throw new Error("auction house index not found");
}

// Which house is Alliance / Horde for this ruleset. Auto-detected by name, overridable via data/houses.json.
async function pickHouses(index) {
  if (existsSync(HOUSES_FILE)) {
    const cfg = JSON.parse(await readFile(HOUSES_FILE, "utf8"));
    if (cfg[REGION]?.[RULESET_ID]) return cfg[REGION][RULESET_ID];
  }
  const find = re => index.find(h => re.test(h.name));
  const a = find(/alliance/i), h = find(/horde/i);
  if (!a || !h) throw new Error("Could not detect faction houses: " + JSON.stringify(index));
  return { alliance: a.id, horde: h.id };
}

async function resolveCrateIds() {
  const cache = existsSync(CRATE_IDS) ? JSON.parse(await readFile(CRATE_IDS, "utf8")) : {};
  const missing = CRATES.filter(c => !cache[c.name]);
  if (!missing.length) return cache;
  // Known crate IDs cluster around 248680-248712 (e.g. 248682 Apprentice Herbs, 248710 Expert Parts).
  const ids = [];
  for (let id = 248670; id <= 248730; id++) ids.push(id);
  for (let i = 0; i < ids.length; i += 10) {
    await Promise.all(ids.slice(i, i + 10).map(async id => {
      const res = await api(`/data/wow/item/${id}`, STATIC, { allow404: true });
      const n = res && nameOf(res.json.name);
      if (n && /waylaid/i.test(n)) cache[n] = id;
    }));
  }
  await writeFile(CRATE_IDS, JSON.stringify(cache, null, 2) + "\n");
  const still = CRATES.filter(c => !cache[c.name]).map(c => c.name);
  if (still.length) console.warn("Crate IDs not found:", still);
  return cache;
}

function addListing(map, itemId, unit, qty) {
  if (!unit || !qty) return;
  (map[itemId] ||= []).push([unit, qty]);
}

function compress(listings) {
  const byPrice = new Map();
  for (const [u, q] of listings) byPrice.set(u, (byPrice.get(u) || 0) + q);
  const sorted = [...byPrice.entries()].sort((a, b) => a[0] - b[0]);
  const out = []; let units = 0;
  for (const [u, q] of sorted) { out.push([u, q]); units += q; if (units >= MAX_UNITS) break; }
  return out;
}

// Listings of wanted items, keyed by auction id: [itemId, quantity, unitPrice, timeLeft]
const TL = { SHORT: 0, MEDIUM: 1, LONG: 2, VERY_LONG: 3 };
async function scanHouse(houseId, wanted) {
  const raw = {};
  const snap = { auctions: { lm: null, list: {} }, commodities: { lm: null, list: {} } };
  let lastModified = null, total = 0;
  const a = await api(`/data/wow/ruleset/${RULESET_ID}/auctions/${houseId}`, DYN, { allow404: true });
  if (a) {
    lastModified = a.lastModified; snap.auctions.lm = a.lastModified;
    for (const x of a.json.auctions || []) {
      total++;
      const id = x.item?.id;
      if (!wanted.has(id) || !x.buyout) continue;
      // buyout is the price for the whole stack
      addListing(raw, id, Math.round(x.buyout / (x.quantity || 1)), x.quantity || 1);
      if (x.id) snap.auctions.list[x.id] = [id, x.quantity || 1, Math.round(x.buyout / (x.quantity || 1)), TL[x.time_left] ?? 0];
    }
  }
  const c = await api(`/data/wow/ruleset/${RULESET_ID}/auctions/${houseId}/commodities`, DYN, { allow404: true });
  if (c) {
    lastModified = c.lastModified || lastModified; // track the commodities snapshot time
    snap.commodities.lm = c.lastModified;
    for (const x of c.json.auctions || []) {
      total++;
      const id = x.item?.id;
      if (!wanted.has(id)) continue;
      addListing(raw, id, x.unit_price, x.quantity);
      if (x.id) snap.commodities.list[x.id] = [id, x.quantity, x.unit_price, TL[x.time_left] ?? 0];
    }
  }
  const items = {};
  for (const [id, l] of Object.entries(raw)) items[id] = compress(l);
  return { lastModified, totalAuctions: total, items, snap };
}

// --- sales tracking ---------------------------------------------------------------------
// The API only lists auctions; it never reports sales. We estimate them by comparing two
// consecutive snapshots: a listing that had at least 2 hours left (LONG / VERY_LONG) and is gone
// less than 2 hours later cannot have expired, so it was bought (or cancelled by its seller).
// A commodity listing whose quantity dropped was partly bought. Listings with less time left are
// ignored, so this undercounts real sales rather than counting expiries as sales.
function diffSnapshots(prev, cur) {
  if (!prev?.lm || !cur?.lm) return null;
  const gapH = (Date.parse(cur.lm) - Date.parse(prev.lm)) / 3.6e6;
  if (!(gapH > 0 && gapH <= 2)) return { gapH, sold: null };
  const sold = {};
  for (const [aid, [item, qty, unit, tl]] of Object.entries(prev.list)) {
    if (tl < TL.LONG) continue;
    const now = cur.list[aid];
    const gone = now ? Math.max(0, qty - now[1]) : qty;
    if (!gone) continue;
    const e = (sold[item] ||= [0, 0]);
    e[0] += gone; e[1] += gone * unit;
  }
  return { gapH, sold };
}

async function trackSales(factions) {
  const prevState = existsSync(STATE) ? JSON.parse(await readFile(STATE, "utf8")) : {};
  const sales = existsSync(SALES) ? JSON.parse(await readFile(SALES, "utf8")) : {};
  sales.note = "Estimated units sold per item: listings that disappeared between hourly snapshots before they could expire (includes listings cancelled by their sellers). items: {id: [[hour, units, totalCopper]]}; hours = snapshot time covered.";
  sales.factions ||= {};
  const cutoff = Date.now() - SALES_DAYS * 864e5;
  const newState = {};
  for (const [faction, d] of Object.entries(factions)) {
    newState[faction] = d.snap;
    const f = (sales.factions[faction] ||= { since: new Date().toISOString(), intervals: [], items: {} });
    for (const kind of ["commodities", "auctions"]) {
      const res = diffSnapshots(prevState[faction]?.[kind], d.snap[kind]);
      if (!res) { console.log(`${faction} ${kind}: no previous snapshot, baseline saved`); continue; }
      if (!res.sold) { console.log(`${faction} ${kind}: gap ${res.gapH.toFixed(2)} h, not counted`); continue; }
      if (kind === "commodities") f.intervals.push([d.snap[kind].lm, +res.gapH.toFixed(3)]);
      const hour = new Date(d.snap[kind].lm).toISOString().slice(0, 13);
      let units = 0;
      for (const [item, [n, value]] of Object.entries(res.sold)) {
        const h = (f.items[item] ||= []);
        const last = h[h.length - 1];
        if (last && last[0] === hour) { last[1] += n; last[2] += value; } else h.push([hour, n, value]);
        units += n;
      }
      console.log(`${faction} ${kind}: gap ${res.gapH.toFixed(2)} h, ${Object.keys(res.sold).length} items, ${units} units sold`);
    }
    // keep only the last SALES_DAYS days
    f.intervals = f.intervals.filter(([t]) => Date.parse(t) >= cutoff);
    for (const [item, h] of Object.entries(f.items)) {
      const kept = h.filter(([hr]) => Date.parse(hr + ":00:00Z") >= cutoff);
      if (kept.length) f.items[item] = kept; else delete f.items[item];
    }
    f.hours = +f.intervals.reduce((a, [, g]) => a + g, 0).toFixed(2);
  }
  sales.updated = new Date().toISOString();
  await mkdir(new URL("../.cache/", import.meta.url), { recursive: true });
  await writeFile(STATE, JSON.stringify(newState));
  await writeFile(SALES, JSON.stringify(sales));
}

async function main() {
  TOKEN = await token();
  const index = await houseIndex();
  if (process.env.PROBE) { console.log(JSON.stringify(index, null, 2)); return; }
  const houses = await pickHouses(index);
  // Blizzard publishes a new snapshot about once an hour. Skip the scan (and the commit) if nothing changed.
  const prevOut = existsSync(OUT) ? JSON.parse(await readFile(OUT, "utf8")) : null;
  if (prevOut && !process.env.FORCE) {
    let same = true;
    for (const [faction, hid] of Object.entries(houses)) {
      const known = prevOut.factions?.[faction]?.lastModified;
      if (!known) { same = false; break; }
      const r = await api(`/data/wow/ruleset/${RULESET_ID}/auctions/${hid}/commodities`, DYN, { allow404: true, ims: known });
      if (!r || (!r.notModified && r.lastModified !== known)) { same = false; break; }
    }
    if (same) { console.log("No new auction snapshot since", prevOut.factions.alliance?.lastModified, "- nothing to do"); return; }
  }
  const crateIds = await resolveCrateIds();
  const recipes = JSON.parse(await readFile(new URL("../data/recipes.json", import.meta.url), "utf8"));
  const crateItems = new Set([...Object.keys(ITEMS).map(Number), ...Object.values(crateIds)]);
  const wanted = new Set([...crateItems, ...Object.keys(recipes.items).map(Number), ...WRIT_ITEM_IDS]);
  const factions = {}, snaps = {};
  for (const [faction, hid] of Object.entries(houses)) {
    const scan = await scanHouse(hid, wanted);
    snaps[faction] = { snap: scan.snap }; delete scan.snap;
    factions[faction] = { house: { id: hid, name: index.find(h => h.id === hid)?.name || String(hid) }, ...scan };
    console.log(`${faction}: house ${hid}, ${scan.totalAuctions} auctions, ${Object.keys(scan.items).length} tracked items listed`);
  }
  const prev = existsSync(OUT) ? JSON.parse(await readFile(OUT, "utf8")) : null;
  const out = { updated: new Date().toISOString(), region: REGION.toUpperCase(), ruleset: { id: RULESET_ID, name: "PvP" }, crateIds, factions };
  // keep a short daily history of the cheapest unit price per item for trend arrows
  out.history = prev?.history || {};
  for (const [f, d] of Object.entries(factions)) {
    out.history[f] ||= {};
    for (const [id, l] of Object.entries(d.items)) {
      if (!crateItems.has(Number(id))) continue;
      const h = (out.history[f][id] ||= []);
      h.push([out.updated.slice(0, 13), l[0][0]]);
      while (h.length > 72) h.shift();
    }
  }
  await mkdir(new URL("../data/", import.meta.url), { recursive: true });
  await writeFile(OUT, JSON.stringify(out));
  await trackSales(snaps);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, "scanned=true\n");
  console.log("wrote", OUT.pathname);
}

main().catch(e => { console.error(e); process.exit(1); });
