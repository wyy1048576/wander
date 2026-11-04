"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Brand, Button, Field, Phone, inputCls } from "@/components/ui";

function plusDays(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export default function Home() {
  const router = useRouter();
  const [mode, setMode] = useState<"start" | "join">("start");
  const [name, setName] = useState("");
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
      body: JSON.stringify({ hostName: name, originCity: origin, startDate: date, nights }),
    });
    const j = await r.json();
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
      body: JSON.stringify({ name }),
    });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) return setErr(j.error ?? "Something went wrong");
    localStorage.setItem(`wander:${c}`, j.memberId);
    router.push(`/room/${c}`);
  }

  return (
    <Phone>
      <Brand />
      <h1 className="text-3xl font-semibold tracking-tight leading-tight mt-6">
        Plan a trip with friends without the group-chat fight.
      </h1>
      <p className="text-muted mt-3">
        Everyone swipes on places. One agent turns all your picks into a single itinerary with trains, hotels and
        tables, each with a Book button.
      </p>

      <div className="mt-8 flex gap-2 rounded-full bg-line/50 p-1">
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
        className="mt-6 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (mode === "start") start();
          else join();
        }}
      >
        <Field label="Your name">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Alex" required />
        </Field>
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
              <Field label="Nights">
                <input
                  className={inputCls}
                  type="number"
                  min={2}
                  max={7}
                  value={nights}
                  onChange={(e) => setNights(Number(e.target.value))}
                />
              </Field>
            </div>
            <p className="text-xs text-muted">Destination for this build: Japan (Tokyo, Kyoto, Osaka).</p>
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
          {busy ? "One moment…" : mode === "start" ? "Create trip" : "Join trip"}
        </Button>
      </form>
    </Phone>
  );
}
