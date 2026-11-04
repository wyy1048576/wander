import { roomState } from "@/lib/rooms";

export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const me = new URL(req.url).searchParams.get("me") ?? undefined;
  const state = roomState(code, me);
  if (!state) return Response.json({ error: "No trip with that code" }, { status: 404 });
  return Response.json(state, { headers: { "Cache-Control": "no-store" } });
}
