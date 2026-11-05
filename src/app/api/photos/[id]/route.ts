import { getPhoto } from "@/lib/trip";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const p = getPhoto(id);
  if (!p) return new Response("not found", { status: 404 });
  return new Response(Buffer.from(p.bytes), {
    headers: { "Content-Type": p.mime, "Cache-Control": "private, max-age=86400" },
  });
}
