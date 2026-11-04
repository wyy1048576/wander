// Convert public/cards/*.png to 768px WebP and remove the PNGs. Keeps the repo small and swiping snappy.
import sharp from "sharp";
import { readdirSync, unlinkSync, statSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
const dir = resolve(process.cwd(), "public", "cards");
(async () => {
  let before = 0, after = 0;
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".png"))) {
    const src = resolve(dir, f);
    const out = resolve(dir, f.replace(/\.png$/, ".webp"));
    before += statSync(src).size;
    const buf = readFileSync(src);
    await sharp(buf).resize(768, 768, { fit: "cover" }).webp({ quality: 82 }).toFile(out);
    after += statSync(out).size;
    unlinkSync(src);
  }
  console.log(`cards: ${(before / 1e6).toFixed(1)} MB png -> ${(after / 1e6).toFixed(1)} MB webp`);
})();
