// Extra recipe data that needs no Blizzard credentials: tools each recipe requires and where
// pattern recipes come from.
//
//  - Tools: the Forever client's SpellTotems lists the tool categories a craft needs (Blacksmith Hammer,
//    Arclight Spanner, Gyromatic Micro-Adjustor, Runed Copper..Arcanite Rod, Flint and Tinder) and
//    TotemCategory says which tool satisfies which: same type and the tool's mask contains the required
//    mask, so a Runed Silver Rod also counts as a Runed Copper Rod. ItemSparse gives each tool's prices
//    and binding (the rods are bind-on-pickup, so an enchanter has to make them).
//  - Pattern sources: Classic item data (nexus-devs/wow-classic-items) says whether a recipe item is sold
//    by a vendor (NPC + price), rewarded by a quest or dropped. Forever-only patterns are not in it.
//
//   node scripts/client-extras.mjs      patches data/recipes.json in place

import { parseCsv } from "./learn-levels.mjs";

// Tools sold by ordinary trade / profession supply vendors (everything else must be crafted or bought on the AH).
export const VENDOR_TOOLS = new Set([5956 /* Blacksmith Hammer */, 2901 /* Mining Pick */, 7005 /* Skinning Knife */, 4471 /* Flint and Tinder */]);
const IGNORE_CATEGORIES = new Set([12 /* Philosopher's Stone: transmutes, excluded anyway */]);

const wago = async (table, build) => {
  const r = await fetch(`https://wago.tools/db2/${table}/csv?build=${build}`);
  if (!r.ok) throw new Error(`${table} ${build}: ${r.status}`);
  return parseCsv(await r.text());
};

export async function loadTables(build, wci = null) {
  const [sla, totems, cats, sparse] = await Promise.all(["SkillLineAbility", "SpellTotems", "TotemCategory", "ItemSparse"].map(t => wago(t, build)));
  wci ||= await (await fetch("https://raw.githubusercontent.com/nexus-devs/wow-classic-items/master/data/json/data.json")).json();
  return { sla, totems, cats, sparse, wci };
}

export function addExtras(rec, { sla, totems, cats, sparse, wci }) {
  const spellOf = new Map(sla.map(r => [Number(r.ID), Number(r.Spell)]));
  const totemBySpell = new Map(totems.map(t => [Number(t.SpellID), t]));
  const sparseById = new Map(sparse.map(r => [Number(r.ID), r]));
  const wciById = new Map(wci.map(i => [i.itemId, i]));
  const catById = new Map(cats.map(c => [Number(c.ID), { name: c.Name_lang, type: Number(c.TotemCategoryType), mask: Number(c.TotemCategoryMask) >>> 0 }]));

  // Every item that is a tool, by category. A tool satisfies requirement R if same type and mask ⊇ R.mask.
  const toolItems = sparse.filter(r => Number(r.TotemCategoryID)).map(r => ({ id: Number(r.ID), cat: Number(r.TotemCategoryID) }));
  const satisfies = (toolCat, reqCat) => {
    const a = catById.get(toolCat), b = catById.get(reqCat);
    return a && b && a.type === b.type && (a.mask & b.mask) === b.mask;
  };
  const tools = { categories: {}, items: {} };
  const addToolItem = id => {
    const s = sparseById.get(id); if (!s) return;
    tools.items[id] = { cat: Number(s.TotemCategoryID) || 0, bop: Number(s.Bonding) === 1 ? 1 : 0, vendor: VENDOR_TOOLS.has(id) ? 1 : 0 };
    rec.items[id] ||= { n: s.Display_lang, q: "C", s: Number(s.SellPrice) || 0 };
    if (VENDOR_TOOLS.has(id)) rec.items[id].v = Number(s.BuyPrice) || rec.items[id].v;
  };

  let withTools = 0, withSource = 0;
  for (const p of rec.professions) for (const r of p.recipes) {
    delete r.tools; delete r.src;
    // --- tools ---
    const t = totemBySpell.get(spellOf.get(r.id));
    if (t) {
      const need = [];
      for (const k of ["RequiredTotemCategoryID_0", "RequiredTotemCategoryID_1"]) {
        const c = Number(t[k]); if (!c || IGNORE_CATEGORIES.has(c)) continue;
        // every tool item that satisfies this category, so the planner can pick the cheapest it can get
        const ok = toolItems.filter(x => satisfies(x.cat, c)).map(x => x.id);
        if (!ok.length) continue;
        tools.categories[c] ||= { n: catById.get(c).name, ok };
        ok.forEach(addToolItem);
        need.push(c);
      }
      for (const k of ["Totem_0", "Totem_1"]) {
        const id = Number(t[k]); if (!id) continue;
        const c = `i${id}`; // a specific item rather than a category
        tools.categories[c] ||= { n: sparseById.get(id)?.Display_lang || `Item ${id}`, ok: [id] };
        addToolItem(id);
        need.push(c);
      }
      if (need.length) { r.tools = need; withTools++; }
    }
    // --- pattern source (recipes learned from an item) ---
    if (r.source === "item") {
      const name = r.name.toLowerCase();
      const teach = wci.filter(i => /^(Recipe|Pattern|Plans|Schematic|Formula|Manual|Design): /.test(i.name) && i.name.replace(/^[^:]+: /, "").toLowerCase() === name);
      const order = { Vendor: 0, Quest: 1, "Boss Drop": 2, "Zone Drop": 3, "Rare Drop": 4 };
      const best = teach.filter(i => i.source && i.source.category in order).sort((a, b) => order[a.source.category] - order[b.source.category])[0];
      if (best) {
        const s = best.source;
        r.src = s.category === "Vendor" ? { k: "vendor", npc: s.name, cost: s.cost ?? best.buyPrice ?? null, faction: s.faction || "Both", item: best.itemId }
          : s.category === "Quest" ? { k: "quest", quest: s.quests?.[0]?.name || "a quest", item: best.itemId }
          : { k: "drop", from: s.name || null, item: best.itemId };
        withSource++;
      } else if (r.isNew) r.src = { k: "new" }; // Forever-only pattern: not in Classic data (many come from Merchant's Favor vendors)
    }
  }
  rec.tools = tools;
  return { withTools, withSource };
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/").replace(/^\//, "")}`) {
  const { readFile, writeFile } = await import("node:fs/promises");
  const file = new URL("../data/recipes.json", import.meta.url);
  const rec = JSON.parse(await readFile(file, "utf8"));
  console.log("downloading client tables for", rec.build, "and Classic item data");
  const n = addExtras(rec, await loadTables(rec.build));
  await writeFile(file, JSON.stringify(rec));
  console.log(`${n.withTools} recipes need a tool, ${n.withSource} patterns have a known source`);
}
