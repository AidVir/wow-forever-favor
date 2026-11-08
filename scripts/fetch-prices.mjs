// Fetches WoW Forever auction house data (EU, PvP ruleset) from the Blizzard Game Data API
// and writes data/prices.json with the cheapest listings for every item a Waylaid Crate needs.
//
// Env: BLIZZARD_CLIENT_ID, BLIZZARD_CLIENT_SECRET
// Optional: REGION (default eu), RULESET_ID (default 1 = PvP), PROBE=1 to just print the house index.
import { readFile, writeFile, mkdir } from "node:fs/promises";
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

async function scanHouse(houseId, wanted) {
  const raw = {};
  let lastModified = null, total = 0;
  const a = await api(`/data/wow/ruleset/${RULESET_ID}/auctions/${houseId}`, DYN, { allow404: true });
  if (a) {
    lastModified = a.lastModified;
    for (const x of a.json.auctions || []) {
      total++;
      const id = x.item?.id;
      if (!wanted.has(id) || !x.buyout) continue;
      // buyout is the price for the whole stack
      addListing(raw, id, Math.round(x.buyout / (x.quantity || 1)), x.quantity || 1);
    }
  }
  const c = await api(`/data/wow/ruleset/${RULESET_ID}/auctions/${houseId}/commodities`, DYN, { allow404: true });
  if (c) {
    lastModified = c.lastModified || lastModified; // track the commodities snapshot time
    for (const x of c.json.auctions || []) {
      total++;
      const id = x.item?.id;
      if (wanted.has(id)) addListing(raw, id, x.unit_price, x.quantity);
    }
  }
  const items = {};
  for (const [id, l] of Object.entries(raw)) items[id] = compress(l);
  return { lastModified, totalAuctions: total, items };
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
  const factions = {};
  for (const [faction, hid] of Object.entries(houses)) {
    const scan = await scanHouse(hid, wanted);
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
  console.log("wrote", OUT.pathname);
}

main().catch(e => { console.error(e); process.exit(1); });
