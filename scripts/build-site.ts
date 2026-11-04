/**
 * Builds the static showcase site in docs/ (served by GitHub Pages).
 *
 *   npx tsx scripts/build-site.ts
 *
 * Reads seed/golden-room.json (a finished demo room), src/data/cards.json and seed/site.json,
 * copies the Muse Image cards into docs/cards/, and writes docs/data.js. docs/index.html is
 * hand-written and renders whatever data.js contains.
 */
import fs from "node:fs";
import path from "node:path";
import { CARDS, computePreferences, describePrefs, tensions, type Swipe } from "../src/lib/game";

const root = path.join(__dirname, "..");
const docs = path.join(root, "docs");
const golden = JSON.parse(fs.readFileSync(path.join(root, "seed", "golden-room.json"), "utf8"));
const site = JSON.parse(fs.readFileSync(path.join(root, "seed", "site.json"), "utf8")) as { video?: string; repo: string; app?: string };

fs.mkdirSync(path.join(docs, "cards"), { recursive: true });
for (const c of CARDS) {
  fs.copyFileSync(path.join(root, "public", "cards", `${c.id}.webp`), path.join(docs, "cards", `${c.id}.webp`));
}

type Member = { id: string; name: string; is_host: number };
type SwipeRow = Swipe & { member_id: string; id: number };
const members: Member[] = golden.members;
const swipes: SwipeRow[] = golden.swipes;

const prefs = members.map((m) =>
  computePreferences(
    m.name,
    swipes.filter((s) => s.member_id === m.id).sort((a, b) => a.id - b.id),
  ),
);

// Pairs in the host's swipe order, with who chose which side.
const host = members.find((m) => m.is_host) ?? members[0];
const pairs = swipes
  .filter((s) => s.member_id === host.id)
  .sort((a, b) => a.id - b.id)
  .map((s) => ({
    left: s.left_card,
    right: s.right_card,
    choices: Object.fromEntries(
      members.map((m) => {
        const mine = swipes.find((x) => x.member_id === m.id && x.left_card === s.left_card && x.right_card === s.right_card);
        return [m.name, mine?.chosen_card ?? null];
      }),
    ) as Record<string, string | null>,
  }));

const data = {
  repo: site.repo,
  video: site.video ?? "",
  app: site.app ?? "",
  room: {
    code: golden.room.code,
    destination: golden.room.destination,
    origin: golden.room.origin_city,
    startDate: golden.room.start_date,
    nights: golden.room.nights,
  },
  members: members.map((m, i) => ({
    name: m.name,
    host: !!m.is_host,
    summary: describePrefs(prefs[i]),
    topTags: prefs[i].topTags,
    lowTags: prefs[i].lowTags,
  })),
  tensions: prefs.length >= 2 ? tensions(prefs[0], prefs[1]) : [],
  cards: Object.fromEntries(
    CARDS.map((c) => [c.id, { title: c.title, city: c.city, area: c.area, tags: c.tags, blurb: c.blurb, image: `cards/${c.id}.webp` }]),
  ),
  pairs,
  events: (golden.events as { kind: string; tool: string | null; summary: string }[]).map((e) => ({
    kind: e.kind,
    tool: e.tool,
    summary: e.summary,
  })),
  plan: golden.plan,
  builtAt: new Date().toISOString().slice(0, 10),
};

fs.writeFileSync(path.join(docs, "data.js"), `window.WANDER = ${JSON.stringify(data)};\n`);
fs.writeFileSync(path.join(docs, ".nojekyll"), "");
console.log(
  `docs/data.js written: ${members.length} members, ${pairs.length} pairs, ${data.plan.days.length} days, ${data.events.length} events, ${CARDS.length} cards copied`,
);
