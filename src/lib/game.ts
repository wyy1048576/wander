import cardsJson from "@/data/cards.json";
import { db } from "./db";
import { destination, type Destination } from "./destinations";

export type Card = {
  id: string;
  title: string;
  city: string;
  area: string;
  tags: string[];
  blurb: string;
  image: string;
};

export const CARDS: Card[] = (cardsJson as Omit<Card, "image">[]).map((c) => ({
  ...c,
  image: `/cards/${c.id}.webp`,
}));
export const CARD_BY_ID = new Map(CARDS.map((c) => [c.id, c]));
/** Pairs per room: 14 for the full deck, 12 for a single-destination deck. */
export function pairCount(dest: Destination) {
  return dest.cardIds.length >= 24 ? 14 : 12;
}

export function deckFor(dest: Destination): Card[] {
  return dest.cardIds.map((id) => CARD_BY_ID.get(id)).filter((c): c is Card => !!c);
}

// Deterministic shuffle so every member of a room sees the same pairs in the same order.
function seeded(seed: string) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pairsForRoom(roomId: string, destKey?: string | null): [Card, Card][] {
  const dest = destination(destKey);
  const rnd = seeded(roomId);
  const deck = deckFor(dest);
  const ids = deck.map((c) => c.id);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  const want = pairCount(dest);
  const pairs: [Card, Card][] = [];
  // First pass: disjoint pairs, so every card is seen once before any repeats.
  for (let i = 0; i + 1 < ids.length && pairs.length < want; i += 2) {
    pairs.push([CARD_BY_ID.get(ids[i])!, CARD_BY_ID.get(ids[i + 1])!]);
  }
  // Small decks: keep going with fresh match-ups. No card more than 4 times, no repeated pair.
  const seen = new Set(pairs.map(([a, b]) => [a.id, b.id].sort().join("|")));
  const uses = new Map<string, number>();
  for (const [a, b] of pairs) {
    uses.set(a.id, (uses.get(a.id) ?? 0) + 1);
    uses.set(b.id, (uses.get(b.id) ?? 0) + 1);
  }
  let guard = 0;
  while (pairs.length < want && ids.length >= 2 && guard++ < 1000) {
    const a = ids[Math.floor(rnd() * ids.length)];
    const b = ids[Math.floor(rnd() * ids.length)];
    if (a === b) continue;
    const key = [a, b].sort().join("|");
    if (seen.has(key) || (uses.get(a) ?? 0) >= 4 || (uses.get(b) ?? 0) >= 4) continue;
    seen.add(key);
    uses.set(a, (uses.get(a) ?? 0) + 1);
    uses.set(b, (uses.get(b) ?? 0) + 1);
    pairs.push([CARD_BY_ID.get(a)!, CARD_BY_ID.get(b)!]);
  }
  return pairs;
}

export type Swipe = { left_card: string; right_card: string; chosen_card: string };

export type Preferences = {
  name: string;
  topTags: string[];
  lowTags: string[];
  picks: string[]; // card titles chosen
  passes: string[]; // card titles rejected
  tagScores: Record<string, number>;
};

export function computePreferences(name: string, swipes: Swipe[]): Preferences {
  const scores: Record<string, number> = {};
  const picks: string[] = [];
  const passes: string[] = [];
  for (const s of swipes) {
    const chosen = CARD_BY_ID.get(s.chosen_card);
    const rejectedId = s.chosen_card === s.left_card ? s.right_card : s.left_card;
    const rejected = CARD_BY_ID.get(rejectedId);
    if (chosen) {
      picks.push(chosen.title);
      for (const t of chosen.tags) scores[t] = (scores[t] ?? 0) + 1;
    }
    if (rejected) {
      passes.push(rejected.title);
      for (const t of rejected.tags) scores[t] = (scores[t] ?? 0) - 1;
    }
  }
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  return {
    name,
    topTags: sorted.filter(([, v]) => v > 0).slice(0, 3).map(([t]) => t),
    lowTags: sorted.filter(([, v]) => v < 0).slice(-3).map(([t]) => t).reverse(),
    picks,
    passes,
    tagScores: scores,
  };
}

export function memberSwipes(memberId: string): Swipe[] {
  return db()
    .prepare("SELECT left_card, right_card, chosen_card FROM swipes WHERE member_id = ? ORDER BY id")
    .all(memberId) as Swipe[];
}

/** One-line human summary, e.g. "leans temples + food, skips nightlife". */
export function describePrefs(p: Preferences): string {
  const likes = p.topTags.length ? `leans ${p.topTags.join(" + ")}` : "no strong lean yet";
  const dislikes = p.lowTags.length ? `, skips ${p.lowTags.join(" and ")}` : "";
  return likes + dislikes;
}

/** Where two members disagree most: tags one likes and the other dislikes. */
export function tensions(a: Preferences, b: Preferences): string[] {
  const out: string[] = [];
  for (const [tag, va] of Object.entries(a.tagScores)) {
    const vb = b.tagScores[tag] ?? 0;
    if (va >= 2 && vb <= -1) out.push(`${a.name} wants ${tag}, ${b.name} doesn't`);
    if (vb >= 2 && va <= -1) out.push(`${b.name} wants ${tag}, ${a.name} doesn't`);
  }
  return out;
}
