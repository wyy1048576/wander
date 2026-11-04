# Wander

**Friends swipe on places. One agent turns everyone's picks into a single, bookable trip.**

Built for the Meta Global AI Developer Hackathon 2026 (Oct 26 – Nov 4). Everything in this repository was written during the hackathon window.

**Showcase site:** https://wyy1048576.github.io/wander/ (the demo room, swipes, agent log and itinerary, rendered statically from `seed/`).

## The problem

Planning a trip with friends is a negotiation nobody wins. One person wants temples, another wants nightlife, and the group chat dies under 200 messages and three half-finished spreadsheets.

## Two ideas

1. **Swipe to reconcile.** Preferences are collected by pairwise swipes, not a chat thread, and the plan opens by saying who got what and where each person gave way.
2. **Autopilot, not copilot.** The plan is written the way a travel agent would write it: the terminal and the train from the airport, the platform, the fare, the station exit, what to order, the tickets to buy in advance, and a task list for the chores before you fly. You should never have to look anything up.

## What Wander does

1. **Pick a destination, start a trip, share a 4-letter code.** Tokyo, Kyoto & Osaka, Nara, Kyushu, or the whole Japan grand tour. Friends join from their phones.
2. **Everyone swipes.** Each person sees the same 12 to 14 pairs of place cards from that destination's deck and picks one from each pair. Pairwise choices give a much stronger preference signal than like/dislike.
3. **See where you disagree.** Before planning, the app shows each person's lean ("leans temples + nature, skips nightlife") and the clashes between them.
4. **The agent builds one plan.** Muse Spark reads everyone's picks and runs a tool loop against live data: real hotels with live prices, real restaurants, transit routes. It returns a day-by-day itinerary where every item says whose pick it was, why, how to get there from the previous item (line, platform, times, fare), what it costs, and has a Book button. A "Before you go" task list covers cash, IC card, seat reservations and timed tickets.
5. **Book.** Hotels book through liteAPI's sandbox (real inventory, simulated payment). Trains link to the operator. Flights link to a search.

The itinerary opens with a "How this balances the group" banner, which is the point of the product: a plan that is visibly fair.

## Meta models

| Model | Role |
|---|---|
| **Muse Spark 1.3** (Meta Model API, chat completions with function calling) | The planning agent. It reads both travellers' swipe histories, decides the city split, calls `get_transit_route`, `search_hotels`, `search_restaurants` and `flight_link`, then calls `finalize_plan` with a structured itinerary. ~15–20 tool calls per plan, about two minutes end to end. |
| **Muse Image 1.0** (Meta Model API, image generation) | All 40 swipe cards in `public/cards/` were generated with Muse Image from the prompts in `src/data/cards.json`. This keeps the app free of third-party photo rights. |

The agent loop lives in [`src/lib/agent.ts`](src/lib/agent.ts). The Meta client is [`src/lib/muse.ts`](src/lib/muse.ts).

## Live data tools

| Tool | Source |
|---|---|
| `get_transit_route` | Google Routes API, transit mode. Real train/bus legs with departure and arrival times and the operator's site where Google has transit data. Shinkansen legs link to SmartEX. |
| `search_restaurants` | Google Places API (New) text search. Real restaurants with rating, review count, price level and a Maps link. |
| `search_hotels` | liteAPI (Nuitée) sandbox. Real hotels with live rates; `/book` runs prebook → book with liteAPI's simulated payment. |
| `flight_link` | A Google Flights search link. No live fares. |

Every external call goes through a per-API daily budget ([`src/lib/budget.ts`](src/lib/budget.ts)) and a response cache, so repeated plan runs cost nothing and a runaway loop stops itself.

## Honesty notes

- Hotel bookings run in liteAPI's **sandbox**: real hotels and prices, simulated payment, no room is held. The UI says so on every booking screen.
- Flight links are **search links**, not live fares.
- Google's Routes API has **no transit schedules for Japan** (its APIs return empty results there, unlike the Maps app). Train legs are therefore marked **"times estimated"**, timed by the model from general knowledge, and link to the operator (SmartEX for Shinkansen) or Google Maps directions. The tool returns live legs in countries Google does cover.
- Destinations are five Japan decks (Tokyo · Kyoto & Osaka · Nara · Kyushu · grand tour), defined in `src/lib/destinations.ts` with a card list and a short brief for the agent. Adding a destination is cards plus one entry. On the grand tour the agent decides whether the trip is long enough to reach Kyushu and says so in the tradeoffs. The architecture is destination-agnostic; only the card deck is Japan-specific.

## Stack

Next.js 16 (App Router, TypeScript, Tailwind v4) · SQLite via Node's built-in `node:sqlite` (single file, no native build) · OpenAI SDK pointed at `api.meta.ai` · zod for plan validation. No hosting required; it runs locally. Needs **Node 22.13 or newer** (built on Node 24).

## Run it

Wander runs on your own machine. A `Dockerfile` is included and deploys cleanly (tested on Railway), but **Meta's Model API currently rejects calls from cloud datacenter IPs** (`model_not_found` with the same key that works from a home network), so the agent only runs where your key is accepted. To run it:

```bash
git clone https://github.com/wyy1048576/wander
cd wander
npm install
cp .env.example .env.local   # fill in the keys below
npm run dev                   # http://localhost:3000
```

Keys needed in `.env.local`:

- `META_API_KEY` from dev.meta.ai (Muse Spark + Muse Image)
- `GOOGLE_MAPS_API_KEY` with **Places API (New)** and **Routes API** enabled
- `LITEAPI_KEY` sandbox key from liteapi.travel (free, no card)

Open the app in two browser windows (or one laptop and one phone on the same Wi-Fi) to play both travellers. The card images are already generated and committed; `scripts/gen-cards.ts` regenerates them with Muse Image if you change `cards.json`.

Useful scripts:

```bash
npx tsx scripts/smoke.ts            # one call each to Muse Spark and Muse Image
npx tsx scripts/test-tools.ts       # Routes + Places against the live APIs
npx tsx scripts/test-hotels.ts      # liteAPI sandbox search
npx tsx scripts/e2e.ts              # full flow: two users with opposite tastes, then the agent
npx tsx scripts/golden-room.ts import   # load a finished demo room from seed/
npx tsx scripts/build-site.ts          # regenerate docs/ (the GitHub Pages showcase) from seed/
```

## Project layout

```
src/app/                 pages (/, /room/[code], /book) and route handlers (/api/...)
src/components/          swipe UI, waiting screen, planning log, itinerary, booking
src/lib/agent.ts         Muse Spark tool loop
src/lib/tools/           routes.ts, places.ts, liteapi.ts
src/lib/destinations.ts  destination decks and agent briefs
src/lib/game.ts          pair generation, preference scoring, clash detection
src/lib/plan-schema.ts   itinerary schema (zod + JSON schema for the model)
src/lib/db.ts            SQLite schema
src/data/cards.json      the 40 place cards and their Muse Image prompts
```

## Team

Solo build by Wilson (wyy1048576). Indie Developer track.
