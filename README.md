# WoW Forever · Merchant's Favor Optimizer

Live site: https://aidvir.github.io/wow-forever-favor/

Finds the cheapest way to earn **Merchant's Favor** with **Waylaid Crates** in WoW Forever, using
EU **PvP** ruleset auction house prices (Alliance and Horde), refreshed every hour.

- Ranks all 30 crates by gold per Favor (empty crate + cheapest accepted bundle).
- Prices the exact quantity from the cheapest listings, so thin markets are priced honestly.
- Optional "craft it yourself" pricing for Mining, Engineering, Tailoring and Leatherworking.
- Performance Bonus (Legacy) expected value, character-level filter, goal planner
  (e.g. 1,500 Favor for the Packmule Treat) that accounts for buying out cheap stock.

## How it works

`scripts/fetch-prices.mjs` runs hourly in GitHub Actions. It calls the Blizzard Game Data API
(`dynamic-forever-eu` namespace, `/data/wow/ruleset/1/auctions/{house}` and `/commodities`),
keeps the cheapest listings of every relevant item, and commits `data/prices.json`.
The static site (GitHub Pages) reads that file.

Crate data lives in `data/crates.js`. Faction → auction house mapping can be pinned in `data/houses.json`.

## Setup

1. Create a client at https://develop.battle.net/access/clients.
2. Add repo secrets `BLIZZARD_CLIENT_ID` and `BLIZZARD_CLIENT_SECRET`.
3. Run the "Update AH prices" workflow once (Actions tab).

Local run: `BLIZZARD_CLIENT_ID=... BLIZZARD_CLIENT_SECRET=... node scripts/fetch-prices.mjs`
(`PROBE=1` prints the auction house index).

Not affiliated with Blizzard Entertainment.
