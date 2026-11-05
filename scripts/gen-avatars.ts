// Six illustrated traveller avatars with Muse Image, used as member icons in the chat. Idempotent.
import { loadEnv } from "./env";
loadEnv();
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";
const OUT = resolve(process.cwd(), "public", "avatars");
mkdirSync(OUT, { recursive: true });
const PROMPTS = [
  "a cheerful young woman traveller with a straw sun hat and a camera",
  "a young man with glasses and a backpack, smiling",
  "a woman with curly hair and a yellow raincoat holding a map",
  "a man with a beard and a knitted beanie, holding a coffee",
  "a woman with a short bob and big headphones",
  "a man with a cap, sunglasses pushed up on his head",
];
(async () => {
  const { generateImage } = await import("../src/lib/muse");
  for (let i = 0; i < PROMPTS.length; i++) {
    const webp = resolve(OUT, `${i + 1}.webp`);
    if (existsSync(webp)) { console.log(i + 1, "skip"); continue; }
    const png = resolve(OUT, `${i + 1}.png`);
    const buf = await generateImage(`Flat vector illustration avatar, head and shoulders portrait of ${PROMPTS[i]}, warm friendly style, soft pastel background, centered, no text, no watermark`, "1024x1024");
    writeFileSync(png, buf);
    await sharp(readFileSync(png)).resize(256, 256, { fit: "cover" }).webp({ quality: 85 }).toFile(webp);
    unlinkSync(png);
    console.log(i + 1, "ok");
  }
})().catch((e) => { console.error("FAILED", e.message); process.exit(1); });
