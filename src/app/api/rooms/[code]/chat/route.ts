import { after } from "next/server";
import { getRoom, members } from "@/lib/rooms";
import { addMessage, listMessages, runChatTurn } from "@/lib/chat";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const room = getRoom(code);
  if (!room) return Response.json({ error: "no such trip" }, { status: 404 });
  const after_ = Number(new URL(req.url).searchParams.get("after") ?? 0) || 0;
  return Response.json({ messages: listMessages(room.id, after_) });
}

export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const room = getRoom(code);
  if (!room) return Response.json({ error: "no such trip" }, { status: 404 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const memberId = String(b.memberId ?? "");
  const text = String(b.text ?? "").trim().slice(0, 1000);
  if (!memberId || !members(room.id).some((m) => m.id === memberId)) return Response.json({ error: "not a member" }, { status: 403 });
  if (!text) return Response.json({ error: "empty message" }, { status: 400 });
  const id = addMessage(room.id, memberId, text);
  // Wander answers in the background; the chat polls and shows the reply when it lands.
  after(async () => {
    try {
      await runChatTurn(room.id, room.code);
    } catch (e) {
      addMessage(room.id, null, `Sorry, I hit an error: ${String((e as Error).message ?? e).slice(0, 160)}`);
    }
  });
  return Response.json({ id });
}
