// Waylaid Crate definitions for WoW Forever.
// Sources (beta + launch-week guides): zockify.com/forever/waylaid-crates,
// forevermastery.com/en/guides/wow-forever-merchants-favor, wowforeverbuilds.com/merchants-favor.
// Favor: raw crates 5/10/15, crafted crates 10/20/30 (Apprentice/Journeyman/Expert).
// Artisan Favor is not published yet; we assume the pattern continues (20 raw / 40 crafted)
// and flag it in the UI as an estimate.

export const ITEMS = {
  // Herbs
  2447: "Peacebloom", 765: "Silverleaf", 2449: "Earthroot", 785: "Mageroyal", 2450: "Briarthorn",
  3820: "Stranglekelp", 2453: "Bruiseweed", 3355: "Wild Steelbloom", 3369: "Grave Moss", 3356: "Kingsblood",
  3357: "Liferoot", 3818: "Fadeleaf", 3821: "Goldthorn", 3358: "Khadgar's Whisker",
  3819: "Wintersbite", 4625: "Firebloom", 8831: "Purple Lotus", 8836: "Arthas' Tears",
  13464: "Golden Sansam", 8838: "Sungrass", 8839: "Blindweed", 8845: "Ghost Mushroom", 8846: "Gromsblood",
  13463: "Dreamfoil", 13465: "Mountain Silversage", 13466: "Plaguebloom", 13467: "Icecap",
  // Ore / stone / reagents
  2770: "Copper Ore", 2771: "Tin Ore", 2775: "Silver Ore", 2772: "Iron Ore", 2776: "Gold Ore",
  3858: "Mithril Ore", 7911: "Truesilver Ore", 10620: "Thorium Ore", 11370: "Dark Iron Ore",
  3857: "Coal", 2880: "Weak Flux", 7912: "Solid Stone", 4289: "Salt", 8150: "Deeprock Salt",
  7069: "Elemental Air", 7067: "Elemental Earth",
  // Cloth / leather / hides
  2589: "Linen Cloth", 2318: "Light Leather", 2592: "Wool Cloth", 4306: "Silk Cloth", 2319: "Medium Leather",
  4338: "Mageweave Cloth", 4234: "Heavy Leather", 14047: "Runecloth", 4304: "Thick Leather", 8170: "Rugged Leather",
  783: "Light Hide", 4232: "Medium Hide", 4235: "Heavy Hide", 8169: "Thick Hide",
  // Enchanting
  10940: "Strange Dust", 10939: "Greater Magic Essence", 10978: "Small Glimmering Shard", 11084: "Large Glimmering Shard",
  11083: "Soul Dust", 11082: "Greater Astral Essence", 11138: "Small Glowing Shard", 11139: "Large Glowing Shard",
  11137: "Vision Dust", 11135: "Greater Mystic Essence", 11177: "Small Radiant Shard", 11178: "Large Radiant Shard",
  11176: "Dream Dust", 11175: "Greater Nether Essence", 14343: "Small Brilliant Shard", 14344: "Large Brilliant Shard",
  // Fabrics
  4231: "Cured Light Hide", 2996: "Bolt of Linen Cloth", 2997: "Bolt of Woolen Cloth", 4305: "Bolt of Silk Cloth",
  4233: "Cured Medium Hide", 4339: "Bolt of Mageweave", 4236: "Cured Heavy Hide", 14048: "Bolt of Runecloth",
  8172: "Cured Thick Hide",
  // Bars
  2840: "Copper Bar", 3576: "Tin Bar", 2841: "Bronze Bar", 2842: "Silver Bar", 3575: "Iron Bar",
  3860: "Mithril Bar", 3859: "Steel Bar", 3577: "Gold Bar", 11371: "Dark Iron Bar", 6037: "Truesilver Bar",
  12359: "Thorium Bar",
  // Engineering parts
  4359: "Handful of Copper Bolts", 4361: "Copper Tube", 4363: "Copper Modulator", 4371: "Bronze Tube",
  4375: "Whirring Bronze Gizmo", 4382: "Bronze Framework", 10558: "Gold Power Core", 4387: "Iron Strut",
  10559: "Mithril Tube", 10560: "Unstable Trigger", 10561: "Mithril Casing", 15994: "Thorium Widget",
  18631: "Truesilver Transformer", 16000: "Thorium Tube",
};

const ID = Object.fromEntries(Object.entries(ITEMS).map(([id, n]) => [n, Number(id)]));
const b = (name, qty) => {
  if (!ID[name]) throw new Error("Unknown item " + name);
  return { id: ID[name], qty };
};

// crateId is filled in by the fetch script (resolved by name from the Blizzard API) when unknown.
export const CRATES = [
  // ---- Herbs (raw)
  { name: "Waylaid Crate: Apprentice Herbs", tier: "Apprentice", kind: "raw", cat: "Herbs", level: 10, favor: 5, bundles: [b("Peacebloom", 20), b("Silverleaf", 20), b("Earthroot", 10), b("Mageroyal", 10), b("Briarthorn", 10)] },
  { name: "Waylaid Crate: Journeyman Herbs", tier: "Journeyman", kind: "raw", cat: "Herbs", level: 10, favor: 10, bundles: [b("Stranglekelp", 10), b("Bruiseweed", 10), b("Wild Steelbloom", 10), b("Grave Moss", 10), b("Kingsblood", 10)] },
  { name: "Waylaid Crate: Earthly Expert Herbs", tier: "Expert", kind: "raw", cat: "Herbs", level: 20, favor: 15, bundles: [b("Liferoot", 20), b("Fadeleaf", 10), b("Goldthorn", 10), b("Khadgar's Whisker", 10)] },
  { name: "Waylaid Crate: Flowering Expert Herbs", tier: "Expert", kind: "raw", cat: "Herbs", level: 20, favor: 15, bundles: [b("Wintersbite", 10), b("Firebloom", 10), b("Purple Lotus", 20), b("Arthas' Tears", 10)] },
  { name: "Waylaid Crate: Earthly Artisan Herbs", tier: "Artisan", kind: "raw", cat: "Herbs", level: 35, favor: 20, favorEstimated: true, bundles: [b("Golden Sansam", 10), b("Sungrass", 20), b("Blindweed", 10), b("Ghost Mushroom", 10), b("Gromsblood", 10)] },
  { name: "Waylaid Crate: Flowering Artisan Herbs", tier: "Artisan", kind: "raw", cat: "Herbs", level: 35, favor: 20, favorEstimated: true, bundles: [b("Dreamfoil", 20), b("Mountain Silversage", 20), b("Plaguebloom", 20), b("Icecap", 20)] },
  // ---- Ore (raw)
  { name: "Waylaid Crate: Apprentice Ore", tier: "Apprentice", kind: "raw", cat: "Ore", level: 10, favor: 5, bundles: [b("Copper Ore", 20), b("Tin Ore", 20)] },
  { name: "Waylaid Crate: Journeyman Ore", tier: "Journeyman", kind: "raw", cat: "Ore", level: 10, favor: 10, bundles: [b("Silver Ore", 10), b("Iron Ore", 20)] },
  { name: "Waylaid Crate: Expert Ore", tier: "Expert", kind: "raw", cat: "Ore", level: 20, favor: 15, bundles: [b("Gold Ore", 10), b("Mithril Ore", 20)] },
  { name: "Waylaid Crate: Artisan Ore", tier: "Artisan", kind: "raw", cat: "Ore", level: 35, favor: 20, favorEstimated: true, bundles: [b("Truesilver Ore", 10), b("Thorium Ore", 20), b("Dark Iron Ore", 20)] },
  // ---- Textiles (raw)
  { name: "Waylaid Crate: Apprentice Textiles", tier: "Apprentice", kind: "raw", cat: "Textiles", level: 10, favor: 5, bundles: [b("Linen Cloth", 40), b("Light Leather", 20)] },
  { name: "Waylaid Crate: Journeyman Textiles", tier: "Journeyman", kind: "raw", cat: "Textiles", level: 10, favor: 10, bundles: [b("Wool Cloth", 20), b("Silk Cloth", 40), b("Medium Leather", 20)] },
  { name: "Waylaid Crate: Expert Textiles", tier: "Expert", kind: "raw", cat: "Textiles", level: 20, favor: 15, bundles: [b("Mageweave Cloth", 40), b("Heavy Leather", 20)] },
  { name: "Waylaid Crate: Artisan Textiles", tier: "Artisan", kind: "raw", cat: "Textiles", level: 35, favor: 20, favorEstimated: true, bundles: [b("Runecloth", 40), b("Thick Leather", 20), b("Rugged Leather", 20)] },
  // ---- Curiosities (raw)
  { name: "Waylaid Crate: Apprentice Curiosities", tier: "Apprentice", kind: "raw", cat: "Curiosities", level: 10, favor: 5, bundles: [b("Strange Dust", 20), b("Greater Magic Essence", 4), b("Small Glimmering Shard", 6), b("Large Glimmering Shard", 2)] },
  { name: "Waylaid Crate: Journeyman Curiosities", tier: "Journeyman", kind: "raw", cat: "Curiosities", level: 10, favor: 10, bundles: [b("Soul Dust", 20), b("Greater Astral Essence", 4), b("Small Glowing Shard", 6), b("Large Glowing Shard", 2)] },
  { name: "Waylaid Crate: Expert Curiosities", tier: "Expert", kind: "raw", cat: "Curiosities", level: 20, favor: 15, bundles: [b("Vision Dust", 20), b("Greater Mystic Essence", 4), b("Small Radiant Shard", 6), b("Large Radiant Shard", 2)] },
  { name: "Waylaid Crate: Artisan Curiosities", tier: "Artisan", kind: "raw", cat: "Curiosities", level: 35, favor: 20, favorEstimated: true, bundles: [b("Dream Dust", 20), b("Greater Nether Essence", 4), b("Small Brilliant Shard", 6), b("Large Brilliant Shard", 2)] },
  // ---- Fabrics (crafted)
  { name: "Waylaid Crate: Apprentice Fabrics", tier: "Apprentice", kind: "crafted", cat: "Fabrics", level: 10, favor: 10, bundles: [b("Cured Light Hide", 2), b("Bolt of Linen Cloth", 20)] },
  { name: "Waylaid Crate: Journeyman Fabrics", tier: "Journeyman", kind: "crafted", cat: "Fabrics", level: 10, favor: 20, bundles: [b("Bolt of Woolen Cloth", 6), b("Bolt of Silk Cloth", 10), b("Cured Medium Hide", 2)] },
  { name: "Waylaid Crate: Expert Fabrics", tier: "Expert", kind: "crafted", cat: "Fabrics", level: 20, favor: 30, bundles: [b("Bolt of Mageweave", 8), b("Cured Heavy Hide", 2)] },
  { name: "Waylaid Crate: Artisan Fabrics", tier: "Artisan", kind: "crafted", cat: "Fabrics", level: 35, favor: 40, favorEstimated: true, bundles: [b("Bolt of Runecloth", 8), b("Cured Thick Hide", 2)] },
  // ---- Ingots (crafted)
  { name: "Waylaid Crate: Apprentice Ingots", tier: "Apprentice", kind: "crafted", cat: "Ingots", level: 10, favor: 10, bundles: [b("Copper Bar", 20), b("Tin Bar", 20), b("Bronze Bar", 10)] },
  { name: "Waylaid Crate: Journeyman Ingots", tier: "Journeyman", kind: "crafted", cat: "Ingots", level: 10, favor: 20, bundles: [b("Silver Bar", 10), b("Iron Bar", 20)] },
  { name: "Waylaid Crate: Expert Ingots", tier: "Expert", kind: "crafted", cat: "Ingots", level: 20, favor: 30, bundles: [b("Mithril Bar", 20), b("Steel Bar", 15), b("Gold Bar", 10)] },
  { name: "Waylaid Crate: Artisan Ingots", tier: "Artisan", kind: "crafted", cat: "Ingots", level: 35, favor: 40, favorEstimated: true, bundles: [b("Dark Iron Bar", 2), b("Truesilver Bar", 10), b("Thorium Bar", 20)] },
  // ---- Parts (crafted)
  { name: "Waylaid Crate: Apprentice Parts", tier: "Apprentice", kind: "crafted", cat: "Parts", level: 10, favor: 10, bundles: [b("Handful of Copper Bolts", 16), b("Copper Tube", 16), b("Copper Modulator", 4)] },
  { name: "Waylaid Crate: Journeyman Parts", tier: "Journeyman", kind: "crafted", cat: "Parts", level: 10, favor: 20, bundles: [b("Bronze Tube", 8), b("Whirring Bronze Gizmo", 7), b("Bronze Framework", 4), b("Gold Power Core", 45)] },
  { name: "Waylaid Crate: Expert Parts", tier: "Expert", kind: "crafted", cat: "Parts", level: 20, favor: 30, bundles: [b("Iron Strut", 8), b("Mithril Tube", 5), b("Unstable Trigger", 12), b("Mithril Casing", 5)] },
  { name: "Waylaid Crate: Artisan Parts", tier: "Artisan", kind: "crafted", cat: "Parts", level: 35, favor: 40, favorEstimated: true, bundles: [b("Thorium Widget", 5), b("Truesilver Transformer", 5), b("Thorium Tube", 2)] },
];

// Raw materials needed to craft ONE unit of a crafted input (per wowforeverbuilds.com chains).
// Used for the optional "craft it yourself" price. prof = profession needed.
export const RECIPES = {
  "Cured Light Hide": { prof: "Leatherworking", mats: [["Light Hide", 1], ["Salt", 1]] },
  "Cured Medium Hide": { prof: "Leatherworking", mats: [["Medium Hide", 1], ["Salt", 1]] },
  "Cured Heavy Hide": { prof: "Leatherworking", mats: [["Heavy Hide", 1], ["Salt", 3]] },
  "Cured Thick Hide": { prof: "Leatherworking", mats: [["Thick Hide", 1], ["Deeprock Salt", 1]] },
  "Bolt of Linen Cloth": { prof: "Tailoring", mats: [["Linen Cloth", 2]] },
  "Bolt of Woolen Cloth": { prof: "Tailoring", mats: [["Wool Cloth", 3]] },
  "Bolt of Silk Cloth": { prof: "Tailoring", mats: [["Silk Cloth", 4]] },
  "Bolt of Mageweave": { prof: "Tailoring", mats: [["Mageweave Cloth", 5]] },
  "Bolt of Runecloth": { prof: "Tailoring", mats: [["Runecloth", 5]] },
  "Copper Bar": { prof: "Mining", mats: [["Copper Ore", 1]] },
  "Tin Bar": { prof: "Mining", mats: [["Tin Ore", 1]] },
  "Bronze Bar": { prof: "Mining", mats: [["Copper Ore", 0.5], ["Tin Ore", 0.5]] },
  "Silver Bar": { prof: "Mining", mats: [["Silver Ore", 1]] },
  "Iron Bar": { prof: "Mining", mats: [["Iron Ore", 1]] },
  "Gold Bar": { prof: "Mining", mats: [["Gold Ore", 1]] },
  "Mithril Bar": { prof: "Mining", mats: [["Mithril Ore", 1]] },
  "Steel Bar": { prof: "Mining", mats: [["Iron Ore", 1], ["Coal", 1]] },
  "Truesilver Bar": { prof: "Mining", mats: [["Truesilver Ore", 1]] },
  "Thorium Bar": { prof: "Mining", mats: [["Thorium Ore", 1]] },
  "Dark Iron Bar": { prof: "Mining", mats: [["Dark Iron Ore", 8]] },
  "Handful of Copper Bolts": { prof: "Engineering", mats: [["Copper Ore", 1]] },
  "Copper Tube": { prof: "Engineering", mats: [["Copper Ore", 2], ["Weak Flux", 1]] },
  "Copper Modulator": { prof: "Engineering", mats: [["Copper Ore", 3], ["Linen Cloth", 2]] },
  "Bronze Tube": { prof: "Engineering", mats: [["Copper Ore", 1], ["Tin Ore", 1], ["Weak Flux", 1]] },
  "Whirring Bronze Gizmo": { prof: "Engineering", mats: [["Copper Ore", 1], ["Tin Ore", 1], ["Wool Cloth", 1]] },
  "Bronze Framework": { prof: "Engineering", mats: [["Copper Ore", 1], ["Tin Ore", 1], ["Medium Leather", 1], ["Wool Cloth", 1]] },
  "Gold Power Core": { prof: "Engineering", mats: [["Gold Ore", 1 / 3]] },
  "Iron Strut": { prof: "Engineering", mats: [["Iron Ore", 2]] },
  "Mithril Tube": { prof: "Engineering", mats: [["Mithril Ore", 3]] },
  "Unstable Trigger": { prof: "Engineering", mats: [["Solid Stone", 2], ["Mageweave Cloth", 1], ["Mithril Ore", 1]] },
  "Mithril Casing": { prof: "Engineering", mats: [["Mithril Ore", 3]] },
  "Thorium Widget": { prof: "Engineering", mats: [["Thorium Ore", 3], ["Runecloth", 1]] },
  "Truesilver Transformer": { prof: "Engineering", mats: [["Elemental Earth", 2], ["Truesilver Ore", 2], ["Elemental Air", 1]] },
  "Thorium Tube": { prof: "Engineering", mats: [["Thorium Ore", 6]] },
};

export const ITEM_ID = ID;
