import { hotelDetails, offerForHotel } from "@/lib/tools/liteapi";
import BookClient from "@/components/BookClient";
import { Brand, Phone } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function BookPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const hotelId = sp.hotelId ?? "";
  const checkin = sp.checkin ?? "";
  const checkout = sp.checkout ?? "";
  const adults = Number(sp.adults ?? 2);
  const room = sp.room ?? "";
  if (!hotelId || !checkin || !checkout) {
    return (
      <Phone>
        <Brand />
        <p className="mt-10 text-muted">Missing hotel or dates.</p>
      </Phone>
    );
  }
  const [hotel, offer] = await Promise.all([
    hotelDetails(hotelId).catch(() => ({ id: hotelId, name: "Hotel", address: undefined, city: undefined, stars: undefined, photo: undefined, description: "" })),
    offerForHotel({ hotelId, checkin, checkout, adults }).catch(() => undefined),
  ]);
  return (
    <BookClient
      hotel={hotel}
      offer={offer ?? null}
      checkin={checkin}
      checkout={checkout}
      adults={adults}
      roomCode={room}
    />
  );
}
