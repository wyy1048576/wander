import { db, newId } from "@/lib/db";
import { book, offerForHotel, prebook, hotelDetails } from "@/lib/tools/liteapi";

/**
 * Sandbox hotel booking: fresh offer -> prebook -> book with liteAPI's simulated payment.
 * Clearly a sandbox booking; no money moves.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, string>;
  const { hotelId, checkin, checkout, firstName, lastName, email } = body;
  const adults = Number(body.adults ?? 2);
  if (!hotelId || !checkin || !checkout || !firstName || !lastName || !email) {
    return Response.json({ error: "missing fields" }, { status: 400 });
  }
  try {
    const offer = await offerForHotel({ hotelId, checkin, checkout, adults });
    if (!offer) return Response.json({ error: "No availability for those dates" }, { status: 409 });
    const pre = await prebook(offer.offerId);
    const result = await book({ prebookId: pre.prebookId, firstName, lastName, email });
    const hotel = await hotelDetails(hotelId).catch(() => ({ name: "Hotel" }));
    db()
      .prepare(
        "INSERT INTO bookings (id, room_id, hotel_id, hotel_name, checkin, checkout, status, confirmation) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(newId(), body.roomCode ?? null, hotelId, hotel.name, checkin, checkout, result.status, result.bookingId);
    return Response.json({
      ok: true,
      sandbox: true,
      bookingId: result.bookingId,
      status: result.status,
      price: result.price,
      currency: result.currency,
      hotel: hotel.name,
      room: pre.roomName,
      checkin,
      checkout,
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
