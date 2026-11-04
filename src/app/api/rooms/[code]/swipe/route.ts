import { getRoom, recordSwipe, roomState } from "@/lib/rooms";
import { CARD_BY_ID } from "@/lib/game";

export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const room = getRoom(code);
  if (!room) return Response.json({ error: "No trip with that code" }, { status: 404 });
  if (room.status !== "swiping") return Response.json({ error: "Swiping is closed" }, { status: 409 });
  const body = (await req.json().catch(() => ({}))) as Record<string, string>;
  const { memberId, left, right, chosen } = body;
  if (!memberId || !CARD_BY_ID.has(left) || !CARD_BY_ID.has(right) || !CARD_BY_ID.has(chosen)) {
    return Response.json({ error: "bad swipe" }, { status: 400 });
  }
  try {
    recordSwipe(room.id, memberId, left, right, chosen);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
  return Response.json(roomState(code, memberId));
}
