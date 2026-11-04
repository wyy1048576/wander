// Generates the swipe-card images with Muse Image. Idempotent: skips cards that already have a PNG.
// Run: npx tsx scripts/gen-cards.ts
import { loadEnv } from "./env";
loadEnv();
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import cards from "../src/data/cards.json";

const OUT = resolve(process.cwd(), "public", "cards");
mkdirSync(OUT, { recursive: true });

async function gen(card: { id: string; prompt: string }) {
  const file = resolve(OUT, `${card.id}.png`);
  if (existsSync(file)) return "skip";
  const { generateImage } = await import("../src/lib/muse");
  const buf = await generateImage(card.prompt, "1024x1024");
  writeFileSync(file, buf);
  return "ok";
}

async function main() {
  const queue = [...cards];
  const concurrency = 3;
  let done = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const c = queue.shift()!;
      try {
        const r = await gen(c);
        console.log(`[${++done}/${cards.length}] ${c.id}: ${r}`);
      } catch (e) {
        console.error(`[${++done}/${cards.length}] ${c.id}: FAILED`, (e as Error).message);
      }
    }
  });
  await Promise.all(workers);
}
main();
