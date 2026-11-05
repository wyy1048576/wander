// Re-read receipt photos whose expense row is still the placeholder, and fill the row in.
import { loadEnv } from "./env";
loadEnv();
(async () => {
  const { db } = await import("../src/lib/db");
  const { readReceipt, updateExpense } = await import("../src/lib/trip");
  const rows = db().prepare("SELECT e.id, e.photo_id, p.mime, p.bytes FROM expenses e JOIN photos p ON p.id = e.photo_id WHERE e.title = 'Receipt (edit me)' AND e.amount = 0").all() as { id: string; photo_id: string; mime: string; bytes: Uint8Array }[];
  console.log("placeholder rows:", rows.length);
  for (const r of rows) {
    const read = await readReceipt(r.mime, r.bytes);
    if (!read?.total) { console.log(r.id, "still unreadable"); continue; }
    updateExpense(r.id, {
      title: read.merchant ?? "Receipt",
      at: read.date ? `${read.date}T${read.time?.slice(0, 5) ?? "12:00"}` : undefined,
      amount: read.total,
      currency: read.currency ?? "JPY",
      category: read.category ?? "other",
      note: read.items?.slice(0, 8).map((i) => (i.price != null ? `${i.name} ${i.price}` : i.name)).join(", ") ?? null,
    });
    console.log(r.id, "->", read.merchant, read.total, read.currency, read.date, read.time);
  }
})().catch((e) => { console.error("FAILED", e.message); process.exit(1); });
