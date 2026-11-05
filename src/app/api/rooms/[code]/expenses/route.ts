import { getRoom } from "@/lib/rooms";
import { addExpense } from "@/lib/trip";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const room = getRoom(code);
  if (!room) return Response.json({ error: "no such trip" }, { status: 404 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const memberId = String(b.memberId ?? "");
  if (!memberId) return Response.json({ error: "memberId required" }, { status: 400 });
  const id = addExpense(room.id, {
    memberId,
    at: String(b.at ?? new Date().toISOString().slice(0, 16)),
    title: String(b.title ?? "New item").slice(0, 80),
    category: String(b.category ?? "other"),
    amount: Number(b.amount ?? 0) || 0,
    currency: String(b.currency ?? "JPY"),
    note: b.note ? String(b.note).slice(0, 200) : null,
    photoId: null,
  });
  return Response.json({ id });
}
