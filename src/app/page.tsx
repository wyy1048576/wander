"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AvatarPicker, Brand, Button, Field, inputCls } from "@/components/ui";
import { DESTINATIONS, DEFAULT_DESTINATION } from "@/lib/destinations";
import cardsJson from "@/data/cards.json";

type CardLite = { id: string; title: string; city: string; tags: string[] };
const CARD = new Map((cardsJson as CardLite[]).map((c) => [c.id, c]));
const img = (id: string) => `/cards/${id}.webp`;

function plusDays(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Three cards from the chosen deck, fanned like photos on a table. */
function Fan({ destKey }: { destKey: string }) {
  const dest = DESTINATIONS.find((d) => d.key === destKey) ?? DESTINATIONS[0];
  const others = dest.cardIds.filter((id) => id !== dest.heroCard);
  const ids = [others[0], dest.heroCard, others[1]].filter(Boolean);
  const poses = ["-rotate-6 -translate-x-16 translate-y-3", "rotate-0 z-10 -translate-y-2 scale-105", "rotate-6 translate-x-16 translate-y-3"];
  return (
    <div className="relative h-[232px] flex items-center justify-center" aria-hidden>
      {ids.map((id, i) => (
        <div
          key={`${destKey}-${id}`}
          className={`absolute w-[150px] aspect-[3/4] rounded-2xl overflow-hidden bg-card shadow-[0_18px_40px_-18px_rgba(31,26,23,.45)] ring-1 ring-black/5 fan-in ${poses[i]}`}
          style={{ animationDelay: `${i * 70}ms` }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={img(id)} alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-2.5 pb-2 pt-8 text-[11px] font-medium text-white leading-tight">
            {CARD.get(id)?.title ?? id}
          </div>
        </div>
      ))}
    </div>
  );
}

function DestinationPicker({ value, onChange }: { value: string; onChange: (k: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = DESTINATIONS.find((d) => d.key === value) ?? DESTINATIONS[0];
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <span className="block text-xs uppercase tracking-wide text-muted mb-1">Destination</span>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="w-full h-14 rounded-2xl border border-line bg-card pl-2 pr-3 flex items-center gap-3 text-left outline-none focus:border-accent"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={img(current.heroCard)} alt="" className="h-10 w-10 rounded-xl object-cover" />
        <span className="flex-1 min-w-0">
          <span className="block font-medium leading-tight">{current.label}</span>
          <span className="block text-xs text-muted truncate">{current.tagline}</span>
        </span>
        <svg viewBox="0 0 20 20" className={`h-5 w-5 text-muted transition ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 8l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute z-20 mt-2 w-full rounded-2xl border border-line bg-card p-1.5 shadow-[0_24px_50px_-20px_rgba(31,26,23,.45)] rise"
        >
          {DESTINATIONS.map((d) => (
            <li key={d.key} role="option" aria-selected={d.key === value} aria-disabled={d.comingSoon}>
              <button
                type="button"
                disabled={d.comingSoon}
                onClick={() => {
                  onChange(d.key);
                  setOpen(false);
                }}
                className={`w-full rounded-xl px-2 py-2 flex items-center gap-3 text-left transition ${
                  d.key === value ? "bg-accent-soft" : "hover:bg-background"
                } disabled:opacity-60 disabled:cursor-default`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img(d.heroCard)} alt="" className={`h-10 w-10 rounded-lg object-cover ${d.comingSoon ? "grayscale" : ""}`} />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium leading-tight">
                    {d.label}
                    {d.comingSoon && <span className="ml-2 rounded-full bg-line/60 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted">soon</span>}
                  </span>
                  <span className="block text-xs text-muted truncate">{d.tagline}</span>
                </span>
                {!d.comingSoon && <span className="text-[11px] text-muted whitespace-nowrap">{d.cardIds.length} places</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Home() {
  const router = useRouter();
  const [mode, setMode] = useState<"start" | "join">("start");
  const [dest, setDest] = useState(DEFAULT_DESTINATION);
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState(1);
  const [origin, setOrigin] = useState("");
  const [date, setDate] = useState(plusDays(14));
  const [nights, setNights] = useState(4);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setErr(null);
    const r = await fetch("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hostName: name, originCity: origin, startDate: date, nights, destination: dest, avatar }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setErr(j.error ?? "Something went wrong");
    localStorage.setItem(`wander:${j.code}`, j.memberId);
    router.push(`/room/${j.code}`);
  }

  async function join() {
    setBusy(true);
    setErr(null);
    const c = code.trim().toUpperCase();
    const r = await fetch(`/api/rooms/${c}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, avatar }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setErr(j.error ?? "Something went wrong");
    localStorage.setItem(`wander:${c}`, j.memberId);
    router.push(`/room/${c}`);
  }

  return (
    <main className="relative mx-auto w-full max-w-[430px] min-h-dvh flex flex-col px-4 pb-10 overflow-hidden">
      <div className="pointer-events-none absolute -top-24 -left-24 h-72 w-72 rounded-full bg-accent-soft blur-3xl opacity-80" aria-hidden />
      <div className="pointer-events-none absolute top-40 -right-28 h-72 w-72 rounded-full bg-ok-soft blur-3xl opacity-70" aria-hidden />

      <Brand />
      <div className="mt-2">
        <Fan destKey={dest} />
      </div>
      <h1 className="text-[2rem] font-semibold tracking-tight leading-[1.08] mt-4">
        Everyone swipes.
        <br />
        One agent plans the trip.
      </h1>
      <p className="text-muted mt-3">
        Pick a destination, share a code, swipe on places with your friends. Muse Spark turns all your picks into one
        itinerary with trains, hotels, tables and a task list.
      </p>

      <div className="mt-7 flex gap-1 rounded-full bg-line/50 p-1">
        {(["start", "join"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`flex-1 h-10 rounded-full text-sm font-medium transition ${mode === m ? "bg-card shadow-sm" : "text-muted"}`}
          >
            {m === "start" ? "Start a trip" : "Join with a code"}
          </button>
        ))}
      </div>

      <form
        className="mt-5 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (mode === "start") start();
          else join();
        }}
      >
        {mode === "start" && <DestinationPicker value={dest} onChange={setDest} />}
        <Field label="Your name">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Alex" required />
        </Field>
        <AvatarPicker value={avatar} onChange={setAvatar} />
        {mode === "start" ? (
          <>
            <Field label="Flying from">
              <input
                className={inputCls}
                value={origin}
                onChange={(e) => setOrigin(e.target.value)}
                placeholder="Singapore"
                required
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Start date">
                <input className={inputCls} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
              </Field>
              <div>
                <span className="block text-xs uppercase tracking-wide text-muted mb-1">Nights</span>
                <div className="h-11 rounded-xl border border-line bg-card flex items-center justify-between px-1">
                  <button
                    type="button"
                    aria-label="Fewer nights"
                    onClick={() => setNights((n) => Math.max(2, n - 1))}
                    className="h-9 w-9 rounded-lg text-lg text-muted hover:bg-background"
                  >
                    −
                  </button>
                  <span className="font-medium tabular-nums">{nights}</span>
                  <button
                    type="button"
                    aria-label="More nights"
                    onClick={() => setNights((n) => Math.min(7, n + 1))}
                    className="h-9 w-9 rounded-lg text-lg text-muted hover:bg-background"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
          </>
        ) : (
          <Field label="Trip code">
            <input
              className={`${inputCls} uppercase tracking-[0.3em] font-mono`}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="ABCD"
              maxLength={4}
              required
            />
          </Field>
        )}
        {err && <p className="text-sm text-accent">{err}</p>}
        <Button type="submit" full disabled={busy}>
          {busy ? "One moment…" : mode === "start" ? "Create trip and get a code" : "Join trip"}
        </Button>
      </form>

      <p className="mt-6 text-center text-[11px] text-muted">
        Agent by Muse Spark · Cards by Muse Image · Hotels in liteAPI sandbox
      </p>
    </main>
  );
}
