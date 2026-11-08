// Builds data/recipes.json: every WoW Forever crafting recipe 1-300 with reagents and skill-up colours.
//
// Sources
//  - Blizzard Game Data API (static-forever-eu): professions, recipes, reagents, crafted items, item names.
//  - wago.tools SkillLineAbility for the live Forever client build: yellow / grey thresholds
//    (Forever changed some of these vs Classic, e.g. sharpening stones).
//  - nexus-devs/wow-classic-items: trainer skill requirement, recipe items that teach a recipe,
//    vendor buy prices for reagents (Classic data; Forever-only recipes fall back to a heuristic).
//
// Env: BLIZZARD_CLIENT_ID, BLIZZARD_CLIENT_SECRET. Optional FOREVER_BUILD (default 1.60.1.70862).
import { writeFile } from "node:fs/promises";
import { WRIT_ITEM_IDS } from "../data/writs.js";

const BUILD = process.env.FOREVER_BUILD || "1.60.1.70862";
const PROFS = { 186: "Mining", 171: "Alchemy", 164: "Blacksmithing", 333: "Enchanting", 202: "Engineering", 165: "Leatherworking", 197: "Tailoring", 185: "Cooking", 129: "First Aid" };
const OUT = new URL("../data/recipes.json", import.meta.url);

async function token() {
  const r = await fetch("https://oauth.battle.net/token", {
    method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(`${process.env.BLIZZARD_CLIENT_ID}:${process.env.BLIZZARD_CLIENT_SECRET}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  return (await r.json()).access_token;
}
let TOKEN;
async function api(path) {
  for (let i = 0; i < 5; i++) {
    const r = await fetch(`https://eu.api.blizzard.com${path}${path.includes("?") ? "&" : "?"}namespace=static-forever-eu&locale=en_GB`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (r.status === 404) return null;
    if (r.ok) return r.json();
    await new Promise(s => setTimeout(s, 1500 * (i + 1)));
  }
  throw new Error("failed " + path);
}
async function pool(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

function parseCsv(text) {
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n") { row.push(cur.replace(/\r$/, "")); rows.push(row); row = []; cur = ""; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const h = rows.shift();
  return rows.map(r => Object.fromEntries(h.map((k, i) => [k, r[i]])));
}

async function main() {
  TOKEN = await token();
  console.log("downloading client SkillLineAbility", BUILD);
  const sla = new Map(parseCsv(await (await fetch(`https://wago.tools/db2/SkillLineAbility/csv?build=${BUILD}`)).text()).map(r => [Number(r.ID), r]));
  console.log("downloading wow-classic-items");
  const wci = await (await fetch("https://raw.githubusercontent.com/nexus-devs/wow-classic-items/master/data/json/data.json")).json();
  const wciById = new Map(wci.map(i => [i.itemId, i]));
  const wago = async t => parseCsv(await (await fetch(`https://wago.tools/db2/${t}/csv?build=${BUILD}`)).text());
  // Recipe items from the Forever client itself: "Pattern: X", "Plans: X", ... with required profession + rank.
  console.log("downloading client ItemSparse / spell focus tables");
  const recipeItems = new Map(); // `${profId}|${name}` -> [{id, skill, bop}]
  for (const r of await wago("ItemSparse")) {
    const m = (r.Display_lang || "").match(/^(Recipe|Pattern|Plans|Schematic|Formula|Manual|Blueprint|Design): (.+)$/);
    if (!m || !Number(r.RequiredSkill)) continue;
    const key = `${r.RequiredSkill}|${m[2].toLowerCase()}`;
    (recipeItems.get(key) || recipeItems.set(key, []).get(key)).push({ id: Number(r.ID), skill: Number(r.RequiredSkillRank) || 1, bop: Number(r.Bonding) === 1 });
  }
  const focusName = new Map((await wago("SpellFocusObject")).map(r => [Number(r.ID), r.Name_lang]));
  const cooldown = new Map((await wago("SpellCooldowns")).map(r => [Number(r.SpellID), Math.max(Number(r.CategoryRecoveryTime) || 0, Number(r.RecoveryTime) || 0)]));
  const spellFocus = new Map((await wago("SpellCastingRequirements")).filter(r => Number(r.RequiresSpellFocus)).map(r => [Number(r.SpellID), focusName.get(Number(r.RequiresSpellFocus))]));

  const professions = [];
  const itemIds = new Set();
  for (const [pid, pname] of Object.entries(PROFS)) {
    const p = await api(`/data/wow/profession/${pid}`);
    const refs = [];
    for (const t of p.skill_tiers) {
      const tier = await api(`/data/wow/profession/${pid}/skill-tier/${t.id}`);
      for (const c of tier.categories || []) for (const r of c.recipes) refs.push({ id: r.id, cat: c.name });
    }
    const details = await pool(refs, 16, async ref => ({ ref, d: await api(`/data/wow/recipe/${ref.id}`) }));
    const recipes = [];
    let heur = 0;
    for (const { ref, d } of details) {
      const s = sla.get(ref.id);
      if (!d || !s || Number(s.SkillLine) !== Number(pid)) continue;
      if (/season of discovery/i.test(ref.cat)) continue; // SoD leftovers, not obtainable in Forever
      const yellow = Number(s.TrivialSkillLineRankLow), grey = Number(s.TrivialSkillLineRankHigh);
      if (!grey) continue;
      const item = d.crafted_item?.id || d.alliance_crafted_item?.id || null;
      const reagents = (d.reagents || []).map(x => [x.reagent.id, x.quantity]);
      if (!reagents.length) continue;
      // learn requirement + how it is learned
      const ri = recipeItems.get(`${pid}|${d.name.toLowerCase()}`) || [];
      const cb = item ? (wciById.get(item)?.createdBy || []).find(x => x.category === pname) : null;
      const isNew = item ? !wciById.has(item) : false; // item did not exist in Classic
      let learn, source, est = false;
      if (Number(s.AcquireMethod) === 1) { learn = 1; source = "auto"; }
      else if (cb && cb.recipes?.length === 0 && !ri.length) { learn = cb.requiredSkill; source = "trainer"; }
      else if (ri.length) { learn = Math.min(...ri.map(x => x.skill)); source = "item"; }
      else if (cb) { learn = cb.requiredSkill; source = "trainer"; }
      else if (!isNew && !item) {
        // trainer enchant without Classic data: Classic trainers teach ~30 below yellow
        learn = Math.max(Number(s.MinSkillLineRank) || 1, Math.min(yellow, Math.max(1, yellow - 30)));
        source = "trainer"; est = true; heur++;
      } else continue; // new Forever recipe with no known source
      const noSkill = learn >= grey; // never gives a skill-up, but still useful to craft reagents (e.g. cloth bolts)
      if ((cooldown.get(Number(s.Spell)) || 0) >= 600000) continue; // transmutes etc.: cooldown makes them useless for leveling
      const recipeItemIds = source === "item" ? ri.filter(x => !x.bop).map(x => x.id) : [];
      const qty = d.crafted_quantity ? (d.crafted_quantity.value ?? ((d.crafted_quantity.minimum + d.crafted_quantity.maximum) / 2)) : 1;
      recipes.push({
        id: ref.id, name: d.name, cat: ref.cat, item, qty, reagents,
        learn, yellow: Math.max(yellow, learn), green: Math.floor((Math.max(yellow, learn) + grey) / 2), grey,
        ups: Number(s.NumSkillUps) || 1, source, recipeItems: recipeItemIds,
        ...(isNew ? { isNew: 1 } : {}), ...(est ? { est: 1 } : {}), ...(noSkill ? { noSkill: 1 } : {}),
        ...(spellFocus.get(Number(s.Spell)) ? { needs: spellFocus.get(Number(s.Spell)) } : {}),
      });
      reagents.forEach(([id]) => itemIds.add(id));
      if (item) itemIds.add(item);
      recipeItemIds.forEach(id => itemIds.add(id));
    }
    recipes.sort((a, b) => a.learn - b.learn || a.grey - b.grey);
    professions.push({ id: Number(pid), name: pname, recipes });
    console.log(`${pname}: ${recipes.length} recipes (${heur} with estimated trainer skill)`);
  }

  WRIT_ITEM_IDS.forEach(id => itemIds.add(id));
  // Item names (Blizzard) + vendor buy price (Classic data) + vendor sell price
  const ids = [...itemIds];
  const infos = await pool(ids, 16, async id => [id, await api(`/data/wow/item/${id}`)]);
  const items = {};
  for (const [id, it] of infos) {
    const w = wciById.get(id);
    items[id] = { n: it?.name || w?.name || `Item ${id}`, q: it?.quality?.type?.[0] || "C", s: it?.sell_price ?? w?.sellPrice ?? 0 };
    if (w?.vendorPrice) items[id].v = w.vendorPrice;
  }
  await writeFile(OUT, JSON.stringify({ build: BUILD, generated: new Date().toISOString(), professions, items }));
  console.log("items", ids.length, "->", OUT.pathname);
}
main().catch(e => { console.error(e); process.exit(1); });
