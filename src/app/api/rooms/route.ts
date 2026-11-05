import { createRoom } from "@/lib/rooms";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const hostName = String(body.hostName ?? "").trim().slice(0, 24);
  const originCity = String(body.originCity ?? "").trim().slice(0, 48);
  const startDate = String(body.startDate ?? "");
  const nights = Math.min(7, Math.max(2, Number(body.nights ?? 4)));
  const destination = String(body.destination ?? "").slice(0, 24);
  const avatar = Number(body.avatar ?? 0) || undefined;
  if (!hostName || !originCity || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    return Response.json({ error: "name, origin city and start date are required" }, { status: 400 });
  }
  const r = createRoom({ hostName, originCity, startDate, nights, destination, avatar });
  return Response.json(r);
}
