// Spot-checks data/recipes.json against the written WoW Forever leveling guides.
//
// Checkpoints: every step in docs/guide-routes.json ("recipe used from skill A to B") plus the hand
// checkpoints in docs/guide-checkpoints.json. A checkpoint is flagged when our data says the guide
// couldn't do that step:
//  - missing   no recipe with that name in the profession
//  - noSkill   flagged as never giving a skill-up
//  - learn     can't be learned by the step's start (learn > from + TOL)
//  - grey      grey before the step's midpoint (no points for most of the step)
// Run after a patch / rebuild: node scripts/check-guides.mjs [--strict] [--all]
// --strict exits 1 when anything is flagged; --all also lists the checkpoints that pass.
// build-recipes.mjs calls checkGuides() at the end (warnings only).
import { readFile } from "node:fs/promises";

const TOL = 5; // guides round to 5s; a recipe learnable a few points into the step is fine
const read = async rel => JSON.parse(await readFile(new URL(rel, import.meta.url), "utf8"));

export async function loadCheckpoints() {
  const out = [], seen = new Set();
  const add = (prof, from, to, name, src) => {
    const key = `${prof}|${from}|${to}|${name}`;
    if (!seen.has(key)) { seen.add(key); out.push({ prof, from, to, name, src }); }
  };
  const routes = await read("../docs/guide-routes.json");
  for (const [prof, steps] of Object.entries(routes.routes)) for (const [from, to, , name] of steps) add(prof, from, to, name, "route");
  try {
    for (const [prof, from, to, name] of (await read("../docs/guide-checkpoints.json")).checkpoints) add(prof, from, to, name, "hand");
  } catch (e) { if (e.code !== "ENOENT") throw e; }
  return out;
}

// One checkpoint -> list of problems (empty = agrees). Same-name recipes: the best-fitting one counts.
function check(cp, recipes) {
  const cands = recipes.filter(r => r.name.toLowerCase() === cp.name.toLowerCase());
  if (!cands.length) return { problems: ["missing"] };
  const mid = (cp.from + cp.to) / 2;
  const judge = r => {
    const p = [];
    if (r.noSkill) p.push("noSkill");
    if (r.learn > cp.from + TOL) p.push(`learn ${r.learn} > ${cp.from}`);
    if (r.grey < mid) p.push(`grey ${r.grey} < ${Math.ceil(mid)}`);
    return { r, problems: p };
  };
  return cands.map(judge).sort((a, b) => a.problems.length - b.problems.length)[0];
}

export async function checkGuides(recipesData, { all = false, log = console.log } = {}) {
  const data = recipesData || await read("../data/recipes.json");
  const byProf = new Map(data.professions.map(p => [p.name, p.recipes]));
  const cps = await loadCheckpoints();
  const rows = [];
  for (const cp of cps) {
    const recipes = byProf.get(cp.prof);
    const res = recipes ? check(cp, recipes) : { problems: ["no profession"] };
    rows.push({ ...cp, ...res });
  }
  const bad = rows.filter(x => x.problems.length);
  const show = all ? rows : bad;
  if (show.length) {
    const pad = (s, n) => String(s).padEnd(n);
    log(`${pad("profession", 15)}${pad("guide", 9)}${pad("recipe", 34)}${pad("learn/yel/grey", 16)}problem`);
    for (const x of show) {
      const r = x.r;
      log(pad(x.prof, 15) + pad(`${x.from}-${x.to}`, 9) + pad(x.name + (x.src === "hand" ? " *" : ""), 34)
        + pad(r ? `${r.learn}/${r.yellow}/${r.grey}${r.est ? " est" : ""}` : "-", 16) + (x.problems.join(", ") || "ok"));
    }
    if (rows.some(x => x.src === "hand" && show.includes(x))) log("* hand checkpoint (docs/guide-checkpoints.json)");
  }
  const profs = new Set(rows.map(x => x.prof)).size;
  log(`guide check: ${rows.length} checkpoints in ${profs} professions, ${bad.length} disagree with recipes.json`);
  return { checked: rows.length, warnings: bad };
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/").replace(/^\//, "")}`) {
  const args = process.argv.slice(2);
  const { warnings } = await checkGuides(null, { all: args.includes("--all") });
  if (args.includes("--strict") && warnings.length) process.exit(1);
}
