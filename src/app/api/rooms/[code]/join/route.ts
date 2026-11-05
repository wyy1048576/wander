import { joinRoom } from "@/lib/rooms";

export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = String(body.name ?? "").trim().slice(0, 24);
  if (!name) return Response.json({ error: "name is required" }, { status: 400 });
  const r = joinRoom(code, name, Number(body.avatar ?? 0) || undefined);
  if (!r) return Response.json({ error: "No trip with that code" }, { status: 404 });
  if ("error" in r) return Response.json({ error: r.error }, { status: 409 });
  return Response.json({ ...r, code: code.toUpperCase() });
}
