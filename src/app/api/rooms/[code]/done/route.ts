import { getRoom, markDone, roomState } from "@/lib/rooms";

export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const room = getRoom(code);
  if (!room) return Response.json({ error: "No trip with that code" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as Record<string, string>;
  if (!body.memberId) return Response.json({ error: "memberId required" }, { status: 400 });
  markDone(body.memberId);
  return Response.json(roomState(code, body.memberId));
}
