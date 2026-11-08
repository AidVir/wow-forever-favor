# Ideas: what to build next

Written 2026-11-08, four days after WoW Forever launched. This is a proposal list. Nothing in it is
built yet. A **Money making** page (gold from professions) is being built in parallel, so ideas
that overlap with it are marked and kept narrow.

**How each idea is scored**
- **Value**, 1–5: how many players it helps × how often they come back × how hard the question is
  to answer without the site.
- **Effort**: S ≈ an evening, M ≈ 2–4 sessions, L ≈ a week or more, or new infrastructure.
- **Priority** = value ÷ effort, with S = 1, M = 2, L = 4.

**What the architecture allows**
- Static pages on GitHub Pages.
- One GitHub Actions bot that reads the Blizzard Game Data API about once an hour.
- Client tables from wago.tools and Classic item data, refreshed by hand after a patch.
- No server, no logins, no secrets in the browser.

Anything that needs a running process, user accounts, or a user's Battle.net login is out, unless a
static workaround exists.

**How sure each fact is.** Forever facts below come from launch-week guides, most of them based on
the beta. When guides disagree, the item says so and needs an in-game check before it is built.
The main open questions are listed under [Unknowns to settle first](#unknowns-to-settle-first).

---

## Top 5 recommendations

### 1. Shareable plans and a shopping-list export (all three pages): value 4, effort S, priority 4.0

**Problem.** People plan on a PC and buy in game, often on another screen or with a guildmate. Today
a plan exists only in that browser's `localStorage`, and the leveling shopping list must be copied
by hand.

**Build.**
- Put each page's settings in the URL hash, e.g. `leveling.html#p=tailoring&from=1&to=300&sell=ah&n=1`.
  Then a link reproduces the plan, and `localStorage` remains the fallback.
- Add "Copy shopping list" in three formats:
  - plain text `20x Linen Cloth`;
  - CSV;
  - a one-line import string for a Forever shopping-list addon.
- **Which addon string?** Several Forever addons accept Auctionator shopping lists (ForeverProfit,
  CraftShopper) or their own item-and-quantity lists (Grimlight Auctions `/ga shop import`). Check in
  game which one works before choosing the format. The plain-text list works everywhere.

**Who and how often.** Every leveling-page user, once per profession. Crate and writ users share
plans in guild chat.

**Data.** None new. **Fit.** Pure front-end, in `common.js` (`store` gains a hash layer).

**Risk.** It is unknown whether the base Auctionator addon's import works unchanged on the Forever
client. Ship plain text and CSV first.

### 2. Legacy perks and owned materials in the leveling planner: value 4, effort S, priority 4.0

**Problem.** The planner assumes a character with no Legacy perks and empty bags. The perks below
change the cheapest route, and most players already hold some of the materials.

| Perk (Professions tree) | Effect |
|---|---|
| Working Overtime | +4% chance of a skill-up per rank, 5 ranks. Up to +20%, so green and yellow recipes become cheaper per point. |
| Bartering | −5% on all vendor prices per rank, 2 ranks. Affects vendor reagents. |
| Master Chef | 10% chance of an extra Cooking result. |

**Build.**
- Add three selects next to "Recipes I can use", using the same pattern as the Performance Bonus
  select on the Favor page.
- Add a "Materials I already have" box. Paste `item x qty` lines, or later the addon export. The
  planner treats those units as free and then buys the rest from the order book (`consume()`
  already does order-book consumption).

**Who.** Every leveling-page user. Legacy points are account-wide, so most players will have some
ranks after the first week.

**Data.**
- The perk values come from the BlizzCon/beta Legacy tree (Warcraft Tavern), so check them in game.
- The skill-up formula in `leveling.js` gets `+ bonus` clamped to 1.

**Risk.** It is unverified whether Working Overtime adds a flat 4% to the chance or multiplies it.
Test it on a few green crafts.

### 3. Reward goal planner (Favor + reputation + days): value 5, effort M, priority 2.5

**Problem.** The rewards players chase need both Merchant's Favor and Azeroth Commerce Authority or
Durotar Supply and Logistics reputation:

| Reward | Cost |
|---|---|
| Reins of the Pack Kodo | 6,000 Favor, Exalted, level 60, Journeyman Riding |
| Packmule Treat | 1,500 Favor, Revered |
| Advertising License Application | 1,200 Favor, Honored |
| Profession certification titles | 1,000 Favor plus skill 300 |
| Favor recipes | 30–360 Favor, gated by reputation |

Today the site answers the Favor half (Favor page goal planner) and the reputation half (Writs
page), but separately. Writs are limited to one completion per writ per day, so the real cost is
both gold and days.

**Build.** One "Plan a reward" page, or a section on both pages:
1. Pick a reward, or type a Favor and reputation target, and enter current Favor and current
   reputation.
2. The planner fills the Favor gap with the cheapest crates (existing goal logic).
3. It fills the reputation gap with the cheapest writs per day, respecting the once-a-day limit and
   buying out cheap writs from the order book.
4. It adds the other reputation sources:
   - Forged Delivery Receipt: 15 Favor at Friendly, which turns an empty crate into a Notarized
     Shipping Container worth 50 reputation.
   - The one-time Shipping Label quest: 50 Favor and 2,000 reputation.
   - The Diplomat Legacy perk: +2% reputation per rank.
5. The output is gold, days and a daily shopping list.

**Who.** Most players who touch crates or writs. They come back daily as reputation grows.

**Data.**
- The rewards table (about 40 rows) is entered by hand from the vendor in game or Wowhead Forever.
- Reputation thresholds are the standard Classic ladder.
- Everything else is already in `prices.json`.

**Fit.** Front-end only. Reuses `buyCost` / `consume`.

**Risks.**
- Guides disagree on whether filled crates give reputation. Method lists crates as a reputation
  source; Forever Mastery says only writs, receipts and the label do. This changes the answer, so
  check it in game first.
- Also check the per-rank writ limit and the recipe reputation gates.

### 4. "Is this Favor recipe worth it?" table: value 4, effort M, priority 2.0

**Problem.** Favor buys 30–360-Favor recipes, among them Elixir of the Grizzly, Engineering
schematics, Enchanting formulas and Tailoring patterns. Players can't tell which ones pay back.
The site can answer this, and nobody else does: the site already knows gold per Favor (Favor page)
and the market for crafted goods (prices + measured sales per day).

**Build.** One row per Favor recipe:
- Favor cost × current cheapest gold per Favor = the recipe's real gold cost.
- Craft cost from the cheapest reagents (vendor / AH / craft-it-yourself, the leveling planner's
  reagent pricing).
- Expected profit per craft, and sales per day from `sales.json`.
- The result: **crafts until it pays back** and **days until it pays back** at half the measured
  demand.
- Rows the market can't support (fewer than 1 sale a day) are flagged.

**Who.** Everyone deciding what to spend Favor on. This is the main question after "how do I get
Favor".

**Data.**
- The list of recipes Favor buys (vendor, Favor cost, reputation gate) is entered by hand. About 60
  rows; guides have it, but their tables are garbled, so check it at the vendor.
- The recipe definitions are new Forever recipes. `build-recipes.mjs` currently **drops new Forever
  recipes with no known source**. Add a small hand list of "source: Favor vendor" so they are kept.
- The product items must be added to the bot's scan list (automatic once they are in
  `recipes.json`).

**Overlap.** The Money making page ranks crafts by profit. This table adds the Favor cost and
payback, so it can live there as a column or filter if that page is built that way.

### 5. Move bot data off `main` and keep per-item daily history: value 3 (enables 4 other ideas), effort M, priority 1.5

**Problem.**
- The bot commits about 370 KB of JSON (`prices.json` + `sales.json`) to `main` every hour, and each
  commit triggers a Pages rebuild.
- After four days the repo already has about 1 MB of loose objects. At about 24 commits a day
  growth stays modest, but it never stops, and every clone downloads all of it.
- Only crate items keep any price history, and only 72 points of it. The history and charts ideas
  below need more, and keeping more on `main` makes the growth worse.

**Build.**
- The bot writes `prices.json` and `sales.json` to a `data` branch that is **force-pushed as a
  single commit**, so it has no history.
- It also writes daily aggregate files, `history/{faction}/{yyyy-mm}.json`: per item per day the
  min, the median of the cheapest 20%, units listed and units sold. Keep 90 days by rewriting.
- Pages keep serving the code from `main`. Pages read data from
  `https://raw.githubusercontent.com/AidVir/wow-forever-favor/data/...`. That host sends CORS headers
  and is cached for about 5 minutes, which is fine for hourly data. Alternatively, publish Pages via
  an Actions artifact that merges `main` and `data`.
- `serve.mjs` already proxies GitHub raw, so local preview changes little.

**Data.** Same API calls. **Effort.** Mostly workflow and `fetch-prices.mjs`, plus the
`loadPrices()` URL.

**Risks.**
- Force-pushing needs `contents: write` (the bot already has it).
- raw.githubusercontent.com has rate limits for very popular sites. That isn't a concern at this
  scale, and a jsDelivr GitHub mirror is a fallback.

---

## Full ranked list

Sorted by priority. ✔ = data available for free today. ◐ = needs a one-off manual table or an
in-game check. ✖ = not available.

| # | Idea | Page | Value | Effort | Priority | Data |
|---|---|---|---|---|---|---|
| 1 | Shareable URL + shopping-list export | all | 4 | S | 4.0 | ✔ |
| 2 | Legacy perks + owned materials in leveling | leveling | 4 | S | 4.0 | ◐ perk values |
| 3 | Writs: Legacy Diplomat, Forged Receipt and label rows; days-to-goal | writs | 3 | S | 3.0 | ◐ |
| 4 | Below-vendor-price finder | new / market | 2 | S | 2.0 → 3.0 with #10 | ✔ |
| 5 | Reward goal planner (Favor + rep + days) | new | 5 | M | 2.5 | ◐ rewards table |
| 6 | Trainer fees in leveling cost | leveling | 2 | S | 2.0 | ◐ Classic table |
| 7 | "Is this Favor recipe worth it?" | new / money | 4 | M | 2.0 | ◐ recipe list |
| 8 | Price + sales chart per item | all | 4 | M | 2.0 | ✔ after #11 |
| 9 | Cross-faction / Blackwater price gaps | market | 3 | M | 1.5 | ✔ |
| 10 | Market overview / price lookup for every commodity | new | 3 | M | 1.5 | ✔ |
| 11 | Data branch + 90-day daily history | infra | 3 | M | 1.5 | ✔ |
| 12 | Other EU rulesets (Normal, RP, RP-PvP) | all | 5 | L | 1.25 | ✔ house ids pinned |
| 13 | Disenchant value: buy greens to DE | new | 3 | M | 1.5 | ◐ DE table |
| 14 | Gathering value per node / per skill bracket | money | 3 | M | 1.5 | ◐ yields |
| 15 | Consumable cost planner (raid night cost, buy vs craft) | new | 3 | M | 1.5 (later in the game) | ◐ durations |
| 16 | Price alerts via ntfy.sh topics or an Atom feed | infra | 3 | M | 1.5 | ✔ |
| 17 | US region | all | 4 | L | 1.0 | ? namespace unprobed |
| 18 | Sales-estimate quality (cancel vs sale) | bot | 2 | M | 1.0 | ✔ |
| 19 | Camp feature cost and buff planner | new | 2 | M | 1.0 | ◐ |
| 20 | Gear upgrades from the AH by slot and level | new | 3 | L | 0.75 | ◐ |

### 3. Writs page: Forever reputation extras (S, priority 3.0)

- Add a **Diplomat** select: +2% reputation per rank, 5 ranks (beta value).
- Add the **Notarized Shipping Container** as a "virtual writ" row: 15 Favor (valued at the
  current gold per Favor) + an empty crate → 50 reputation. It may beat expensive writs.
- Note the **Forger's Quill** (15 Favor, rerolls a writ of the same rank). It isn't modelled; text
  only.
- Add a "days to Honored / Revered / Exalted" line, using the once-per-day limit.
- This is the cheap first step of #5 and is worth doing even if #5 never ships.
- **Risk:** the Forged Delivery Receipt numbers are beta data from one guide, so check them in game.

### 4. Below-vendor-price finder (S, priority 2.0)

- **Problem:** the fastest risk-free gold. Buy AH listings priced under what a vendor pays, and
  vendor them.
- **Data:**
  - `vendorPrice` is already pulled from Classic data in `build-recipes.mjs`.
  - Commodities are already downloaded in full every hour. Non-commodities are scanned only for
    wanted items, so the scan list would grow.
- **Output:** a small table refreshed hourly. Most rows disappear within minutes, so present it as
  "seen in the last snapshot".
- **Risk:** it is stale by up to an hour, and Forever may have changed vendor prices. Use Forever's
  `ItemSparse.SellPrice` from wago.tools instead of Classic data; it is the same CSV the recipe
  builder already reads.

### 6. Trainer fees (S, priority 2.0)

- A known limit in CLAUDE.md. Classic trainer costs per rank and per recipe are well documented
  (nexus data has `requiredSkill`, not cost).
- Effort is a hand table per profession, or `SkillLineAbility` + trainer data if wago exposes it.
- It adds a few gold per profession. Small value, but it removes a stated inaccuracy.

### 8. Price and sales chart per item (M, priority 2.0)

- Click any item → a popover with a 7-day (later 90-day) line of the cheapest price, units listed
  and estimated units sold per day.
- It answers "is now a good time to buy or sell", the most common market question.
- Hand-drawn inline SVG; no library needed.
- Needs #11 for anything beyond the 72 crate points.

### 9. Cross-faction and Blackwater price gaps (M, priority 1.5)

- The bot already scans Alliance, Horde and Blackwater.
- Show items where one faction's cheapest price is far below the other's, net of AH cuts. Players
  with characters on both factions, or using the neutral house, can move goods.
- **Unknowns:**
  - the Blackwater cut and deposit in Forever (Classic neutral AH: 15% cut);
  - whether a ruleset allows characters of both factions per account (Classic PvP realms did not).
- Low effort once the market overview (#10) exists.

### 10. Market overview / price lookup (M, priority 1.5)

- The commodities response for each house is already fetched in full.
- **Data:** keep a compact summary for **every** commodity, not just wanted items: min, cheapest-20%
  median, units listed, sold per day. That is about 3,000 items × 3 houses at about 40 bytes each,
  roughly 400 KB, so split it per faction.
- **Page:** search box with Wowhead Forever links, "biggest movers today" and "most sold".
- **Competition:** Forever Mastery already has AH price pages per item. This site's edge is the
  sales-per-day estimate and the calculators around it, so build this mainly as infrastructure for
  #4, #8, #9 and #13, not as a standalone destination.

### 11. Data branch + daily history (M, priority 1.5)

See Top 5 #5.

### 12. Other EU rulesets (L, priority 1.25)

- Today only EU PvP is covered, a fraction of EU players. House ids for Normal (111/114/117), RP
  (119–121) and RP-PvP (123–125) are already verified in `data/houses.json`'s note.
- **Bot:** loop rulesets in `fetch-prices.mjs`, and write `prices-{ruleset}.json` / `sales-{ruleset}.json`.
- **Cost:** 4× the downloads (the conditional-request skip check keeps idle runs cheap) and 4× the
  committed data. That is the reason to do #11 first.
- **Front-end:** a ruleset select in the header, stored like the faction.
- **Timing:** the job must stay under the 10-minute loop. Today it scans in well under that, but
  measure first.
- **Risk:** Blizzard has said it may **link auction houses if a ruleset dries up** (reported by
  playnews.gg). House ids could change, so keep the mapping data-driven and log the
  `/auctions/` index each run.
- **Value is the highest on the list.** Priority is lower only because of the effort and because
  it depends on #11.

### 13. Disenchant value (M, priority 1.5)

- **Problem:** Enchanters buy cheap BoE greens and disenchant them. The question is which listings
  are worth more as dust, essence and shards than their price.
- **Data:**
  - item level and quality come from the item API or nexus data;
  - the DE outcome table is the well-known Classic table, typed in once;
  - green listings are non-commodities in the per-house auctions file, already downloaded each run.
- **Risk:** guides say Forever changed some enchanting (new formulas), and one player reports more
  essence per disenchant than Classic. Confirm the yields before trusting the result, and show the
  table's source.

### 14. Gathering value per node (M, priority 1.5; may belong on the Money page)

- For each herb, ore and skin: average yield per node (Classic values) × the current AH value of
  everything it drops (ore, stones, gems).
- Bountiful Harvest adds 20% Scarce materials per rank.
- Group by required skill so a player sees "at 175 Mining, Gold vs Mithril pays X per node".
- **Honest limit:** no free data gives nodes per hour or spawn density by zone, so this is **gold per
  node, not gold per hour**.
- Coordinate with the Money making session; it may already cover this.

### 15. Consumable cost planner (M, priority 1.5, higher once raids open)

- Pick a raid kit (flasks, elixirs, food, sappers, Major Mana/Healing).
- Get cost per hour at buy-or-craft prices, and the shopping list for N raid nights.
- Reuses the reagent pricing from leveling.
- **Data:** durations come from the client `SpellDuration` table on wago.tools or a hand list.
  - Forever food buffs differ (Gourmand perk +33% food duration; Cooking smoothies +5% XP).
- **Timing:** demand only appears when the level-60 raids open in Forever. Build it closer to then.

### 16. Price alerts without a server (M, priority 1.5)

A browser can't watch the market when the page is closed, and the site has no backend. Two free
static-compatible options:
1. **ntfy.sh topics.** The bot POSTs to a fixed public topic per market for a small set of
   well-defined events, for example "crate X now under N gold per Favor" or "writ Y listed under Z".
   Users subscribe in the free ntfy phone app. No accounts and no secrets. Personal thresholds are
   not possible, because the topics are public and shared.
2. **An Atom feed** (`data/deals.xml`) written by the bot. It works with any feed reader and
   Discord's RSS bots.

Tab notifications (Notification API while the page is open) are a cheap third option.
**Risk:** ntfy.sh is a third-party free service with rate limits. Keep the event count low.

### 17. US region (L, priority 1.0)

- It probably needs `us.api.blizzard.com` with `dynamic-forever-us`. This namespace was **not
  probed**: test with `PROBE=1` and a US host before committing.
- The same storage concern as #12 applies, doubled.

### 18. Sales-estimate quality (M, priority 1.0)

Cancellations count as sales today. Two improvements need no new data:
- **Relist detection.** A listing that vanishes and an equal-quantity listing at a lower price from
  the same pattern appears within the hour is a cancel and repost. Commodities have no seller, so
  match on quantity and timing only.
- **Confidence on the sales figure.** Show "few hours of data / low sample" next to it.

Value is modest but it makes the resale numbers on every page more trustworthy.

### 19. Camp feature cost and buff planner (M, priority 1.0)

- **The system:** each profession crafts three camp objects, at skill 20, 140 and 300. Each player
  adds one per campfire on a shared cooldown. Camp and class buffs don't stack.
- **The tool:** it would price each object (reagents from the AH) and tell a group which objects to
  bring for the class buffs they are missing.
- **Data:**
  - the object recipes should be in the API recipe tiers (check that `build-recipes.mjs` keeps
    them);
  - buffs come from guides.
- **Why lower:** most objects are cheap and the buff choice is simple. Useful as a column in the
  leveling planner, since these crafts give skill-ups, rather than as a page.

### 20. Gear upgrades from the AH (L, priority 0.75)

- By slot and level, list BoE gear on the AH ranked by a stat weight per class and spec.
- **Problems:**
  - Forever reworked gear and classes, so Classic stat weights are unreliable, and weights are
    opinion-heavy;
  - BoE gear is non-commodity, and scanning all of it multiplies the bot's work.
- Revisit if a reliable Forever stat-weight source appears.

---

## Rejected ideas (and why)

| Idea | Why not |
|---|---|
| Mob or zone farming gold per hour | Loot tables are server-side. They are not in the Game Data API or the client tables. The only sources are Wowhead's scraped drop rates, which aren't licensed for reuse. Per-hour figures would be invented. #14 (gold per node) is the honest subset. |
| Import my character (professions, reputation, Favor) | The Profile API needs a user OAuth login (authorization-code flow with a client secret). A static site can't keep the secret, and it is unknown whether profile endpoints exist for Forever. Typing in current skill, reputation and Favor (already partly possible) is the workaround. |
| Legacy tree planner | Already done well by Forever Mastery (Legacy planner) and Method (Legacy calculator). Duplicating them adds nothing. Use the perks inside our calculators instead (#2, #3). |
| Discord bot or personal price alerts | Needs a running process, or storing users' webhooks or thresholds (secrets, a backend). #16 covers shared alerts statically. |
| Addon that reads the site's prices in game | Addons can't make HTTP calls. Prices would need copy-pasting into SavedVariables, which is clumsy, and the market has many Forever price addons already (Hammerprice, Forever Price Checkin, auxForever). |
| Real-time or sniping prices | Blizzard publishes a snapshot about once an hour. In-game addons with 15-minute scans will always be fresher. Don't compete on freshness; compete on planning. |
| Gold-per-hour leaderboard of all methods | Time per action isn't measurable from AH data. Any ranking would be guesswork presented as data. Gold per craft, per node or per Favor with explicit assumptions is honest. |
| Generic leveling (XP) route or quest guides | Not a market question; content sites (Forever Mastery, Warcraft Tavern, Method) cover it with human-written routes. |
| Gathering profession leveling (Mining, Herbalism, Skinning) | No costs to optimize. Skill comes from where you travel, not what you buy. |
| Writ "fill vs sell" for every writ item via crafting chains deeper than 2 | Diminishing returns; the leveling reagent pricer already goes 2 deep, which covers almost all writ items. |

---

## Unknowns to settle first

Each of these changes a calculation. Most need one in-game check.

1. **Do filled Waylaid Crates give reputation?** Guides disagree. This affects #5 and the Favor
   page.
2. **Writ daily limit:** once per writ, or once per rank? This affects #3 and #5.
3. **Favor vendor list:** recipe names, Favor costs and reputation gates, from the vendor window.
4. **Legacy perk values at launch** (Working Overtime, Bartering, Diplomat, Master Chef, Bountiful
   Harvest), and whether skill-up bonuses add or multiply.
5. **Artisan crate Favor values.** They are still estimated (20/40) in `data/crates.js`.
6. **Forged Delivery Receipt:** the Favor cost, the reputation, and whether it needs an empty crate
   bought from the AH.
7. **Blackwater cut and deposit**, and whether an account can have both factions on one ruleset.
8. **Whether `dynamic-forever-us` exists.** A one-line `PROBE=1` run with a US host settles it.

## Sources

- Merchant's Favor, crates and writs:
  - [Forever Mastery, Merchant's Favor guide](https://forevermastery.com/en/guides/wow-forever-merchants-favor)
  - [Method, ACA / DSL reputation guide](https://www.method.gg/wow-forever/azerorth-commerce-authority-and-durotar-supply-and-logistics-reputation-guide)
  - [warcraft.wiki.gg, Merchant's Favor](https://warcraft.wiki.gg/wiki/Merchant's_Favor)
  - [Mobalytics, Merchant's Favor guide](https://mobalytics.gg/wow-forever/profile/stoyven-enbj16/guides/merchant-s-favor)
- Legacy tree: [Warcraft Tavern, Legacy tree rewards](https://www.warcrafttavern.com/forever/news/legacy-tree-rewards-in-world-of-warcraft-forever)
- Camping: [Method, Camping guide](https://www.method.gg/wow-forever/camping-in-wow-forever-how-it-all-works-all-profession-buffs)
- Patches and auction houses:
  - [Blizzard, Forever hotfixes Nov 6 2026](https://news.blizzard.com/en-us/article/24315281/wow-forever-hotfixes-november-6-2026) (Tanning Rack skill lowered to 125)
  - [playnews.gg, linking auction houses if a ruleset dries up](https://www.playnews.gg/en/news/wow-forever-blizzard-changes-everything-and-plans-to-link-auction-houses-if-a-ruleset-dries-up)
- Addons:
  - [ForeverProfit](https://www.curseforge.com/wow/addons/foreverprofit)
  - [Grimlight Auctions](https://www.curseforge.com/wow/addons/grimlight-auctions)
  - [Auctionator ShoppingList](https://www.curseforge.com/wow/addons/auctionator-shoppinglist)
  - [Hammerprice](https://www.curseforge.com/wow/addons/hammerprice)
- Enchanting: [Warcraft Tavern, Enchanting overview](https://www.warcrafttavern.com/forever/guides/enchanting/)
