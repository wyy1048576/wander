import { deleteExpense, updateExpense } from "@/lib/trip";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const patch = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  updateExpense(id, patch);
  return Response.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  deleteExpense(id);
  return Response.json({ ok: true });
}
