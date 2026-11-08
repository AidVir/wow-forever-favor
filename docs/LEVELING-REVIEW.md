# Leveling planner vs written guides

Reviewed 2026-11-09. This compares the routes our planner (`index.html` / `leveling.js`) produces
with the written WoW Forever leveling guides that exist so far. It ends with suggested changes, in
priority order. Nothing in it is implemented yet.

## Sources

| Source | What it is | Used for |
|---|---|---|
| [wow-professions.com, Forever guides](https://www.wow-professions.com/forever/alchemy-leveling-guide) | Hand-written 1–300 routes per profession. Based on the beta; the author says everything above 225 is untested on live. | Alchemy, Tailoring, Blacksmithing, Leatherworking, Enchanting, Engineering |
| [Metabot.gg calculator](https://metabot.gg/en/wow-forever/profession-leveling-calculator) and [Alchemy page](https://metabot.gg/en/wow-forever/professions/alchemy) | An automatic route builder, the closest thing to ours. It uses client base values, not AH prices. | Method and feature comparison |
| Search summaries of [RankedBoost](https://rankedboost.com/world-of-warcraft/forever/professions/), [method.gg](https://www.method.gg/wow-forever/tailoring-in-wow-forever-1-300-leveling-guide-and-trainers), [gfinity](https://www.gfinityesports.com/article/world-of-warcraft-forever-alchemy-guide-1-300-leveling-trainers) | Shorter guides | Cross-checks only |

Our routes were exported from the planner on 2026-11-09 with live EU PvP Horde prices, using both
"Trainer only" and "Trainer + all patterns", vendor mode.

## How the guides work vs how ours works

| | Written guides | Our planner |
|---|---|---|
| **Prices** | Fixed. They pick recipes by typical cost and give "if X is cheaper" alternatives. | Live AH order book every hour, so it picks whatever is cheapest right now. |
| **Step shape** | 10–20 long steps. Each recipe runs while it is orange or early yellow, with round skill ranges. | Greedy per skill point. Often 15–35 steps, including 1-craft steps and back-and-forth switches. |
| **Intermediates** | Planned ahead. They craft reagents for skill points and **keep them** for a later recipe (grinding stones, bolts, blasting powder, Fire Oil, Mithril Casings). | Crafts a reagent only when it's cheaper than buying it at that moment. Those crafts don't count as skill-ups, and nothing is carried over to later steps. |
| **Training** | Rank caps at 75/150/225 and character level 10/20/35, with trainer names and places. Shopping lists are split at 225 (level 35). | Ignores rank caps and character level. One continuous 1–300 route. |
| **Recipe sources** | Trainer, vendor (BoP, named NPC), quest (Imperial Plate), world drop, Merchant's Favor vendors. | Trainer, "pattern" priced from the AH. Vendor, quest and Favor recipes are "unknown cost". |
| **Tools** | Blacksmith Hammer, Arclight Spanner, Gyromatic Micro-Adjustor, runed enchanting rods are crafted or bought at the right point. | Not modelled. Only crafting stations (Anvil, Forge …) are. |
| **Selling** | Sometimes mentioned ("Bronze Shortsword vendors for more"). | Vendor and AH resale built in, using measured sales. |
| **Coverage** | Usually stops at 265–290 because live testing isn't done yet. | Goes as far as the current AH allows (Alchemy 300, Tailoring 294, Blacksmithing 268, Leatherworking 250 today). |

## Findings

### 1. Our "learn at" skill is Classic's, but Forever lowered many recipes (data bug, high impact)

`build-recipes.mjs` takes yellow and grey from the Forever client (`SkillLineAbility`), but the learn
skill for trainer recipes comes from Classic data (`wow-classic-items` `requiredSkill`). The Forever
client doesn't store the trainer requirement: `MinSkillLineRank` is 0 or 1 for 2,097 of the
2,113 recipes. Forever moved the colours of many recipes 15–25 points lower, so our learn level ends up
**above** Forever's yellow or even grey:

| Recipe | Our learn | Forever yellow / grey | Guide uses it at |
|---|---|---|---|
| Bolt of Woolen Cloth | 75 | 70 / 85 | 55–80 |
| Bolt of Silk Cloth | 125 | 110 / 120 | 100–120 |
| Bolt of Mageweave | 175 | 145 / 150 | 140–150 |
| Gloves of Meditation | 130 | 125 / 155 | 120–140 |
| Crimson Silk Vest | 185 | 170 / 190 | 150–170 |
| Coarse Grinding Stone | 75 | 50 / 75 | 50–67 |
| Heavy Grinding Stone | 125 | 100 / 125 | 100–112 |

**Effect:**
- About 120 recipes in Blacksmithing (34), Leatherworking (44) and Tailoring (43) get a 0–15 point
  window instead of their real one.
- 47 recipes are wrongly flagged `noSkill`, including the Woolen, Silk and Mageweave bolts that the
  guides use for 60+ points.
- This is why our Tailoring route stays on Linen until 109 (38 Soft-soled Linen Boots) and why
  Blacksmithing makes 139 Rough Grinding Stones for 47 points.
- The guides say the same thing: "A lot of skill ranges changed compared to Classic Era… most of its
  recipes turn grey 25 to 45 points earlier in Forever." They say this for Tailoring, Blacksmithing and
  Leatherworking. Alchemy, Enchanting and Engineering kept their Classic ranges, and our data agrees there.

### 2. Required tools and rods are missing (Enchanting route is not doable as shown)

- **Enchanting:** every enchant needs a runed rod. The guide crafts Runed Copper Rod (1), Runed Silver
  Rod (109), Runed Golden Rod (150), Runed Truesilver Rod (200) and Runed Arcanite Rod. Each is also a
  skill-up. Our Enchanting route never makes a rod. It also uses 75 Lesser Magic Wands and 97 Greater
  Magic Wands where the guide uses enchants.
- **Engineering:** recipes need a Blacksmith Hammer, Arclight Spanner (crafted at 50) and Gyromatic
  Micro-Adjustor (crafted at 194). Blacksmithing needs the Blacksmith Hammer.
- **Data:** recipe tool requirements (`SpellTotems` in the client) aren't imported, so the planner
  can't know about them.

### 3. Rank caps and character level are ignored

- Every guide plans around 75 → Journeyman (skill 50, level 10), 150 → Expert (125, level 20) and
  225 → Artisan (200, level 35, often one trainer far away).
  - Enchanting's Artisan trainer is Annora inside Uldaman.
  - Blacksmithing's Artisan trainer is in Booty Bay.
- Two practical consequences the guides warn about:
  - Crafts past the cap give no points until you train.
  - A level-20 character can't go past 150 at all.
- Ours plans straight through, for example "15–73 Elixir of Minor Defense", and doesn't tell you
  when to visit a trainer.
- Metabot shows a "visit a trainer for Journeyman" marker at 75/150/225.

### 4. No planning ahead with intermediates

The guides get a lot of their efficiency from making a reagent while it still gives points, then using
it in a later recipe:

| Profession | Guide's plan |
|---|---|
| Blacksmithing | Rough/Coarse/Heavy Grinding Stones made at 25–112 for skill, kept for gauntlets, bracers and Golden Scale Bracers |
| Engineering | Blasting powder, bolts, Bronze Tubes, Mithril Casings and Unstable Triggers made for skill, then used in bombs, scopes and sheep |
| Tailoring | All Woolen, Silk and Mageweave bolts made early for points, then used for 100+ points of gear |
| Alchemy | Fire Oil (130–150) kept for Elixir of Fire Power |

Ours crafts intermediates only as a hidden reagent source (no skill credit, no carry-over). It also
vendors or AH-sells outputs that a later step then buys again.

### 5. Low-chance crafting spam

Because the default time value per craft is 0, a cheap green or late-yellow recipe can win even when it
needs many crafts per point:

| Profession | Our step | Crafts per point |
|---|---|---|
| Engineering | 171 Mithril Gyro-Shot for 245–285 | ~4.3 |
| Leatherworking | 34 Turtle Scale Breastplate for 220–225 | ~7 |
| Leatherworking | 50 Green Leather Belt for 160–175 | ~3.3 |
| Leatherworking | 44 Nightscape Boots for 240–250 | ~4.4 |
| Enchanting | 73 Enchant Bracer - Greater Strength for 297–300 | ~24 |

The guides keep to orange or early yellow, about 1–1.5 crafts per point, and accept a slightly higher
material cost. Players do value their time, and AH supply runs out faster on long low-chance runs.

### 6. Fragmented routes

The greedy per-point choice switches recipes whenever the cheapest one changes as the order book is
used up. Examples:
- Alchemy: "73–76 Minor Mana Potion, 76–81 Minor Defense, 81–84 Minor Mana Potion".
- Tailoring: "Runecloth Cloak 220–225, Mageweave Bag 225–226, Runecloth Cloak 226–230".
- Tailoring: many 1–2 craft steps.

Guides merge these into one step. It costs a few copper more, but it's far easier to follow and to
shop for.

### 7. Recipe sources we can't price or don't know

- **Quest recipes:** the Imperial Plate quests (Blacksmithing 240–300 in Forever, recipe lowered from
  265 to 240) aren't sources in our data. So Blacksmithing stalls at 268 when Thorium runs out on the AH,
  while the guide has a route to 300.
- **Vendor recipes** (BoP, from a named NPC, with a coin price) and **Merchant's Favor recipes** show
  as "pattern: vendor/Favor/drop" with no cost or location. Guides name the vendor. Favor recipes are
  where many Forever-only routes come from; the guide's Alchemy 290–300 step is Major Frenzy Potion
  from the Favor vendor.
- **Rare world drops** (Mithril Spurs, Runecloth Shoulders) are used freely in "all patterns" mode.
  The guides treat them as optional alternatives.

### 8. Where our planner agrees or does better

- **Where we agree** (Alchemy, Enchanting, Engineering, which kept Classic ranges):
  - Alchemy's mid-game matches the guide: Elixir of Minor Defense, Elixir of Wisdom 90–134, Fire Oil
    134–150, Nature Protection Potion 196–235.
  - Engineering's Rough Blasting Powder 1–30 and Coarse Dynamite match.
- **What we do better:**
  - Live prices pick cheaper recipes when the market moves. For example Elixir of Ogre Strength
    150–202 instead of Mana Potion when Kingsblood is cheap.
  - We include AH resale.
  - We include Forever-only recipes the guides skip (Minor Arcane Elixir variants, Discolored healing
    potions).
- **One mixup to avoid:** Forever renamed the Defense elixir line ("Elixir of Greater Defense" is now
  the Stonescale Oil recipe). Our data and the wow-professions guide agree on this, so it isn't a bug.

## Suggested changes (priority order)

| # | Change | Fixes | Effort | Status |
|---|---|---|---|---|
| 1 | **Use Forever learn levels.** For trainer recipes, shift the Classic learn skill by the same amount Forever moved the colours: `learn = classicLearn + min(0, foreverYellow − classicYellow)`. Classic yellow comes from the Classic Era `SkillLineAbility` on wago.tools. Keep the `est` flag, and check against the guide table above (bolts, grinding stones, Gloves of Meditation, Crimson Silk). Rebuild `recipes.json`. | Finding 1. The biggest route-quality gain for Tailoring, Blacksmithing and Leatherworking. | S–M | Done: `scripts/learn-levels.mjs`, 223 recipes lowered, matches the guide checkpoints |
| 2 | **Training checkpoints.** Add a "character level" input. Cap skill at 75/150/225/300 by rank, insert "Train Journeyman/Expert/Artisan here" rows (with the guide's trainer notes per profession), and split the shopping list at 225. | Finding 3 | S | Done (trainer names for the 6 crafting professions; Cooking / First Aid trainers not confirmed) |
| 3 | **Tools.** Import tool requirements (`SpellTotems` / required items) in `build-recipes.mjs`. Treat them as one-time purchases or crafts the route must get before the step that needs them. Rods for Enchanting, Arclight Spanner and Gyromatic Micro-Adjustor for Engineering, Blacksmith Hammer as a vendor item. | Finding 2 | M | Open |
| 4 | **Sensible default time value.** Default "time value per craft" to ~5–10 silver, or add a "max crafts per skill point" cap (e.g. 2.5) unless the user turns it off. Show crafts per point in each step's details. | Finding 5 | S | Done: 5s default + 3 crafts/point rule |
| 5 | **Route smoothing.** After the greedy pass, merge adjacent steps when using one recipe for the whole range costs less than ~3% more, and drop steps under 3 crafts into a neighbour. | Finding 6 | S | Done as stickiness (stay unless >10% cheaper) instead of a merge pass |
| 6 | **Inventory carry-over and planned intermediates.** Let a step's output (and intermediates crafted for skill) go into an inventory that later steps use first. Score a reagent craft that still gives skill-ups as a skill step. Show "keep N for later" on the step, as the guides do. | Finding 4 | M–L | Open |
| 7 | **Recipe source data.** Add source details for vendor recipes (NPC, zone, price, BoP), Favor recipes (Favor cost, so the route can say "costs 15 Favor") and quest recipes (Imperial Plate chain). Add a "Recipes I can use" option for "trainer + vendor + Favor (no world drops)". | Finding 7 | M | Open |
| 8 | **Alternatives per step.** Store the runner-up recipe for each step and show "Alternative: X (+Y g)" in the details, like the guides' "if Silverleaf is cheaper" notes. | Usability; also helps when the AH runs out mid-route | S | Open |
| 9 | **Owned materials and sharing**, as Metabot does: tick reagents you already have (treated as free) and copy a link with the plan settings. This overlaps with idea #1 in `docs/IDEAS.md`. | Usability | S–M | Open |
| 10 | **Spot-check against guides after each patch.** Keep a small JSON of "guide checkpoints" (recipe usable at skill X) and have `build-recipes.mjs` warn when our data disagrees. | Keeps finding 1 from coming back | S | Open |

**Suggested order:** do 1, 2, 4 and 5 first. They're small and fix most of what makes our routes look
wrong next to a guide. Then 3 and 7. Then 6, the biggest algorithm change.
