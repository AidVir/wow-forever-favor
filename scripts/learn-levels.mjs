// Forever trainer learn levels.
//
// The Forever client stores each recipe's skill-up colours (SkillLineAbility yellow / grey) but not the
// skill a trainer teaches it at (MinSkillLineRank is 0/1 for almost every recipe), so the trainer skill
// comes from Classic data. Forever moved many recipes' colours down by 15-45 points compared to Classic
// (mostly Tailoring, Blacksmithing and Leatherworking), and trainers teach them earlier by the same amount:
// e.g. Bolt of Silk Cloth is yellow at 110 in Forever (135 in Classic) and guides use it from 100, not 125.
// So we shift the Classic learn skill by how far the yellow threshold moved. Checked against the
// wow-professions.com Forever guides (see docs/LEVELING-REVIEW.md).
//
//   node scripts/learn-levels.mjs      patches data/recipes.json in place (no Blizzard credentials needed)

export const CLASSIC_BUILD = "1.15.9.70576"; // latest Classic Era client on wago.tools

export function parseCsv(text) {
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

export async function skillLineAbility(build) {
  const r = await fetch(`https://wago.tools/db2/SkillLineAbility/csv?build=${build}`);
  if (!r.ok) throw new Error(`SkillLineAbility ${build}: ${r.status}`);
  return new Map(parseCsv(await r.text()).map(x => [Number(x.ID), x]));
}

// Only ever lowers the learn skill, never below 1 or above Forever's yellow.
export function shiftLearn(classicLearn, classicYellow, foreverYellow) {
  if (!classicLearn || !classicYellow || !foreverYellow) return classicLearn;
  return Math.max(1, Math.min(foreverYellow, classicLearn + Math.min(0, foreverYellow - classicYellow)));
}

// Recompute learn / colours / noSkill for trainer recipes of an existing recipes.json.
export function applyShift(recipes, forever, classic) {
  let changed = 0;
  for (const p of recipes.professions) for (const r of p.recipes) {
    if (r.source !== "trainer" || r.est) continue;
    const f = forever.get(r.id), c = classic.get(r.id);
    if (!f || !c) continue;
    const fy = Number(f.TrivialSkillLineRankLow), grey = Number(f.TrivialSkillLineRankHigh);
    const learn = shiftLearn(r.learn, Number(c.TrivialSkillLineRankLow), fy);
    if (learn === r.learn) continue;
    r.learn = learn;
    r.yellow = Math.max(fy, learn);
    r.green = Math.floor((r.yellow + grey) / 2);
    r.grey = grey;
    if (learn >= grey) r.noSkill = 1; else delete r.noSkill;
    changed++;
  }
  for (const p of recipes.professions) p.recipes.sort((a, b) => a.learn - b.learn || a.grey - b.grey);
  return changed;
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/").replace(/^\//, "")}`) {
  const { readFile, writeFile } = await import("node:fs/promises");
  const file = new URL("../data/recipes.json", import.meta.url);
  const rec = JSON.parse(await readFile(file, "utf8"));
  console.log("downloading SkillLineAbility for Forever", rec.build, "and Classic Era", CLASSIC_BUILD);
  const [forever, classic] = await Promise.all([skillLineAbility(rec.build), skillLineAbility(CLASSIC_BUILD)]);
  const n = applyShift(rec, forever, classic);
  rec.learnShift = { classicBuild: CLASSIC_BUILD, changed: n };
  await writeFile(file, JSON.stringify(rec));
  console.log(`lowered the learn skill of ${n} trainer recipes`);
}
