// Minimal .env.local loader for scripts (no dotenv dependency).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
export function loadEnv(file = ".env.local") {
  try {
    const txt = readFileSync(resolve(process.cwd(), file), "utf8");
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
    }
  } catch {}
}
