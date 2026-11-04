"use client";

import Link from "next/link";
import { useState } from "react";
import { Brand, Button, Chip, Field, Phone, inputCls } from "./ui";

type Hotel = { id: string; name: string; address?: string; city?: string; stars?: number; photo?: string; description: string };
type Offer = { offerId: string; roomName: string; boardName?: string; total: number; currency: string; refundable: boolean } | null;

export default function BookClient({
  hotel,
  offer,
  checkin,
  checkout,
  adults,
  roomCode,
}: {
  hotel: Hotel;
  offer: Offer;
  checkin: string;
  checkout: string;
  adults: number;
  roomCode: string;
}) {
  const [first, setFirst] = useState("Alex");
  const [last, setLast] = useState("Traveller");
  const [email, setEmail] = useState("alex@example.com");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, string | number> | null>(null);
  const nights = Math.max(1, Math.round((Date.parse(checkout) - Date.parse(checkin)) / 86400e3));

  async function submit() {
    setBusy(true);
    setErr(null);
    const r = await fetch("/api/book", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hotelId: hotel.id, checkin, checkout, adults, firstName: first, lastName: last, email, roomCode }),
    });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) return setErr(j.error ?? "Booking failed");
    setDone(j);
  }

  return (
    <Phone>
      <header className="flex items-center justify-between">
        <Brand />
        {roomCode && (
          <Link href={`/room/${roomCode}`} className="text-sm text-muted">
            ← Back to plan
          </Link>
        )}
      </header>

      <div className="rounded-2xl overflow-hidden bg-card border border-line">
        {hotel.photo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={hotel.photo} alt={hotel.name} className="h-44 w-full object-cover" />
        )}
        <div className="p-4">
          <div className="flex items-start justify-between gap-2">
            <h1 className="text-xl font-semibold leading-tight">{hotel.name}</h1>
            <Chip tone="warn">Sandbox</Chip>
          </div>
          <p className="text-xs text-muted mt-1">
            {[hotel.address, hotel.city].filter(Boolean).join(", ")}
          </p>
          <p className="text-sm text-muted mt-2 line-clamp-3">{hotel.description}</p>
        </div>
      </div>

      {done ? (
        <div className="mt-5 rounded-2xl bg-ok-soft p-5 rise">
          <div className="text-xs uppercase tracking-wide text-ok">Booked (sandbox)</div>
          <div className="text-lg font-semibold mt-1">{String(done.hotel)}</div>
          <div className="text-sm mt-1">
            {String(done.room)} · {checkin} → {checkout}
          </div>
          <div className="text-sm mt-1">
            Total {String(done.currency)} {String(done.price)} · Status {String(done.status)}
          </div>
          <div className="font-mono text-xs text-muted mt-2">Booking ref {String(done.bookingId)}</div>
          <p className="text-xs text-muted mt-3">
            This ran through liteAPI&apos;s sandbox with a simulated payment. No money moved and no room is held.
          </p>
        </div>
      ) : offer ? (
        <form
          className="mt-5 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="rounded-2xl bg-card border border-line p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">{offer.roomName}</div>
                <div className="text-xs text-muted">
                  {nights} night{nights > 1 ? "s" : ""} · {adults} adults{offer.boardName ? ` · ${offer.boardName}` : ""}
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg font-semibold">
                  {offer.currency} {offer.total}
                </div>
                <div className="text-xs text-muted">{offer.refundable ? "refundable" : "non-refundable"}</div>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="First name">
              <input className={inputCls} value={first} onChange={(e) => setFirst(e.target.value)} required />
            </Field>
            <Field label="Last name">
              <input className={inputCls} value={last} onChange={(e) => setLast(e.target.value)} required />
            </Field>
          </div>
          <Field label="Email">
            <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          {err && <p className="text-sm text-accent">{err}</p>}
          <Button type="submit" full disabled={busy}>
            {busy ? "Booking…" : `Confirm sandbox booking · ${offer.currency} ${offer.total}`}
          </Button>
          <p className="text-xs text-muted text-center">Simulated payment via liteAPI sandbox. Nothing is charged.</p>
        </form>
      ) : (
        <p className="mt-6 text-muted">No availability came back for these dates. Try the plan&apos;s other hotel.</p>
      )}
    </Phone>
  );
}
