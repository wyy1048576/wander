import { getRoom } from "@/lib/rooms";
import { addExpense, addPhoto, readReceipt } from "@/lib/trip";

export const dynamic = "force-dynamic";

const MAX_BYTES = 6 * 1024 * 1024;

/** Upload a photo (multipart: file, memberId, kind=gallery|receipt, caption). Receipts become expenses. */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const room = getRoom(code);
  if (!room) return Response.json({ error: "no such trip" }, { status: 404 });
  const form = await req.formData().catch(() => null);
  if (!form) return Response.json({ error: "expected multipart form" }, { status: 400 });
  const file = form.get("file");
  const memberId = String(form.get("memberId") ?? "");
  const kind = String(form.get("kind") ?? "gallery") === "receipt" ? "receipt" : "gallery";
  const caption = String(form.get("caption") ?? "").slice(0, 140) || undefined;
  if (!(file instanceof File) || !memberId) return Response.json({ error: "file and memberId are required" }, { status: 400 });
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type)) return Response.json({ error: "images only" }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: "image too large (max 6 MB)" }, { status: 413 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const photoId = addPhoto(room.id, memberId, kind, file.type, bytes, caption);

  if (kind !== "receipt") return Response.json({ photoId });

  let read = null;
  let parseError: string | undefined;
  try {
    read = await readReceipt(file.type, bytes, { date: room.start_date, city: room.destination });
  } catch (e) {
    parseError = String((e as Error).message ?? e).slice(0, 200);
  }
  const now = new Date();
  const at = read?.date ? `${read.date}T${read.time && /^\d{2}:\d{2}/.test(read.time) ? read.time.slice(0, 5) : "12:00"}` : now.toISOString().slice(0, 16);
  const expenseId = addExpense(room.id, {
    memberId,
    at,
    title: read?.merchant?.trim() || "Receipt (edit me)",
    category: read?.category && ["food", "transport", "lodging", "tickets", "shopping", "other"].includes(read.category) ? read.category : "other",
    amount: typeof read?.total === "number" ? read.total : 0,
    currency: (read?.currency ?? "JPY").toUpperCase().slice(0, 3),
    note: read?.items?.length ? read.items.slice(0, 8).map((i) => (i.price != null ? `${i.name} ${i.price}` : i.name)).join(", ") : parseError ? "Could not read the receipt; fill in by hand." : null,
    photoId,
  });
  return Response.json({ photoId, expenseId, read, parseError });
}
