"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RoomState } from "@/lib/rooms";
import type { Card } from "@/lib/game";
import { Brand, Button, Chip, Field, Phone, inputCls, AvatarPicker } from "./ui";
import Trip from "./Trip";

type State = RoomState;

export default function RoomClient({ code }: { code: string }) {
  const [memberId, setMemberId] = useState<string | null>(null);
  const [state, setState] = useState<State | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // Identity lives in localStorage; read it once after mount (client only).
    // ?me=<memberId> pins this window to a member (handy for two side-by-side windows in a demo).
    const pinned = new URLSearchParams(window.location.search).get("me");
    if (pinned) localStorage.setItem(`wander:${code}`, pinned);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMemberId(pinned ?? localStorage.getItem(`wander:${code}`));
    setLoaded(true);
  }, [code]);

  const refresh = useCallback(async () => {
    const r = await fetch(`/api/rooms/${code}${memberId ? `?me=${memberId}` : ""}`, { cache: "no-store" });
    if (!r.ok) {
      setErr("No trip with that code.");
      return;
    }
    setState(await r.json());
  }, [code, memberId]);

  useEffect(() => {
    if (!loaded) return;
    // Poll the room every 2s; the first tick is deferred so no setState runs synchronously in the effect.
    const first = setTimeout(refresh, 0);
    const t = setInterval(refresh, 2000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [refresh, loaded]);

  if (err) {
    return (
      <Phone>
        <Brand />
        <p className="mt-10 text-muted">{err}</p>
      </Phone>
    );
  }
  if (!state) {
    return (
      <Phone>
        <Brand />
        <p className="mt-10 text-muted">Loading…</p>
      </Phone>
    );
  }
  if (!memberId || !state.me) {
    return <JoinInline code={code} onJoined={(id) => setMemberId(id)} />;
  }

  const { room, me } = state;
  return (
    <Phone>
      <header className="flex items-center justify-between">
        <Brand />
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm tracking-[0.25em] text-muted">{room.code}</span>
          <a
            href="/"
            title="Start a new trip or join another one. This trip stays open at its code."
            className="inline-flex h-8 items-center rounded-full border border-line bg-card px-3 text-xs font-medium hover:bg-accent-soft"
          >
            ＋ New trip
          </a>
        </div>
      </header>
      {room.status === "swiping" && !me.done && state.nextPair && (
        <Swiper code={code} memberId={memberId} state={state} onUpdate={setState} />
      )}
      {room.status === "swiping" && (me.done || !state.nextPair) && (
        <Waiting code={code} memberId={memberId} state={state} onUpdate={setState} />
      )}
      {room.status === "planning" && <Planning state={state} />}
      {room.status === "done" && state.plan && <Trip code={code} memberId={memberId} plan={state.plan} members={state.members} />}
      {room.status === "error" && <Failed code={code} memberId={memberId} state={state} onUpdate={setState} />}
    </Phone>
  );
}

function JoinInline({ code, onJoined }: { code: string; onJoined: (id: string) => void }) {
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function join() {
    setBusy(true);
    const r = await fetch(`/api/rooms/${code}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, avatar }),
    });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) return setErr(j.error);
    localStorage.setItem(`wander:${code}`, j.memberId);
    onJoined(j.memberId);
  }
  return (
    <Phone>
      <Brand />
      <h1 className="text-2xl font-semibold mt-8">Join trip {code}</h1>
      <form
        className="mt-6 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          join();
        }}
      >
        <Field label="Your name">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Sam" required />
        </Field>
        <AvatarPicker value={avatar} onChange={setAvatar} />
        {err && <p className="text-sm text-accent">{err}</p>}
        <Button type="submit" full disabled={busy}>
          Join
        </Button>
      </form>
    </Phone>
  );
}

/* ---------- Swiping ---------- */

function Swiper({
  code,
  memberId,
  state,
  onUpdate,
}: {
  code: string;
  memberId: string;
  state: State;
  onUpdate: (s: State) => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const busy = useRef(false);
  const pair = state.nextPair!;
  const n = state.me!.swipes;

  const choose = useCallback(
    async (chosen: Card) => {
      if (busy.current) return;
      busy.current = true;
      setPicked(chosen.id);
      const r = await fetch(`/api/rooms/${code}/swipe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId, left: pair[0].id, right: pair[1].id, chosen: chosen.id }),
      });
      if (r.ok) onUpdate(await r.json());
      setTimeout(() => {
        setPicked(null);
        busy.current = false;
      }, 180);
    },
    [code, memberId, pair, onUpdate],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") choose(pair[0]);
      if (e.key === "ArrowRight") choose(pair[1]);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [choose, pair]);

  return (
    <section className="flex-1 flex flex-col">
      <div className="mt-2 flex items-center justify-between text-sm">
        <span className="font-medium">Which one, {state.me!.name}?</span>
        <span className="text-muted">
          {n + 1} of {state.totalPairs}
        </span>
      </div>
      <div className="mt-2 h-1.5 w-full rounded-full bg-line overflow-hidden">
        <div className="h-full bg-accent transition-all" style={{ width: `${(n / state.totalPairs) * 100}%` }} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 flex-1">
        {pair.map((c, i) => (
          <button
            key={c.id}
            onClick={() => choose(c)}
            className={`relative flex flex-col overflow-hidden rounded-2xl bg-card text-left shadow-sm border border-line ${picked === c.id ? "pop ring-2 ring-accent" : ""}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={c.image} alt={c.title} className="flex-1 min-h-[220px] w-full object-cover" draggable={false} />
            <div className="p-3 shrink-0">
              <div className="text-xs text-muted">
                {c.city} · {c.area}
              </div>
              <div className="font-semibold leading-tight mt-0.5">{c.title}</div>
              <div className="text-xs text-muted mt-1 line-clamp-2">{c.blurb}</div>
            </div>
            <span className="absolute top-2 left-2 rounded-full bg-black/55 text-white text-[11px] px-2 py-0.5">
              {i === 0 ? "←" : "→"}
            </span>
          </button>
        ))}
      </div>

      <MembersStrip state={state} />
    </section>
  );
}

function MembersStrip({ state }: { state: State }) {
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {state.members.map((m) => (
        <Chip key={m.id} tone={m.done ? "ok" : "neutral"}>
          {m.name}: {m.done ? "done" : `${m.swipes}/${state.totalPairs}`}
        </Chip>
      ))}
    </div>
  );
}

/* ---------- Waiting ---------- */

function Waiting({
  code,
  memberId,
  state,
  onUpdate,
}: {
  code: string;
  memberId: string;
  state: State;
  onUpdate: (s: State) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const allDone = state.members.every((m) => m.done);
  const waitingOn = state.members.filter((m) => !m.done).map((m) => m.name);

  async function build(force = false) {
    setBusy(true);
    setErr(null);
    const r = await fetch(`/api/rooms/${code}/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberId, force }),
    });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) return setErr(j.error);
    onUpdate(j);
  }

  return (
    <section className="mt-4 rise">
      <h2 className="text-2xl font-semibold tracking-tight">What everyone leans towards</h2>
      <p className="text-muted text-sm mt-1">
        {allDone ? "Everyone has finished swiping." : `Waiting on ${waitingOn.join(", ")}…`}
      </p>

      <ul className="mt-5 space-y-3">
        {state.members.map((m) => (
          <li key={m.id} className="rounded-2xl bg-card border border-line p-4">
            <div className="flex items-center justify-between">
              <span className="font-semibold">{m.name}</span>
              <Chip tone={m.done ? "ok" : "neutral"}>{m.done ? "done" : `${m.swipes}/${state.totalPairs}`}</Chip>
            </div>
            <p className="text-sm mt-1 first-letter:uppercase">{m.summary}</p>
            {m.picks.length > 0 && (
              <p className="text-xs text-muted mt-2 line-clamp-2">Picked: {m.picks.slice(0, 6).join(", ")}</p>
            )}
          </li>
        ))}
      </ul>

      {state.tensions.length > 0 && (
        <div className="mt-4 rounded-2xl bg-warn-soft p-4">
          <div className="text-xs uppercase tracking-wide text-muted">Where you disagree</div>
          <ul className="mt-1 text-sm space-y-0.5">
            {state.tensions.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      )}

      {state.members.length < 2 && (
        <p className="mt-4 text-sm text-muted">
          Share code <span className="font-mono tracking-[0.2em]">{code}</span> so a friend can swipe too.
        </p>
      )}

      <div className="mt-6 space-y-2">
        {state.me?.isHost ? (
          <>
            <Button full disabled={busy || !allDone} onClick={() => build(false)}>
              {busy ? "Starting…" : "Build our plan"}
            </Button>
            {!allDone && (
              <Button full variant="ghost" disabled={busy} onClick={() => build(true)}>
                Start anyway
              </Button>
            )}
          </>
        ) : (
          <p className="text-sm text-muted text-center">The host will start the plan once everyone is done.</p>
        )}
        {err && <p className="text-sm text-accent">{err}</p>}
      </div>
    </section>
  );
}

/* ---------- Planning ---------- */

const TOOL_LABEL: Record<string, string> = {
  get_transit_route: "Google Routes",
  search_restaurants: "Google Places",
  search_hotels: "liteAPI hotels",
  flight_link: "Flights",
};

function Planning({ state }: { state: State }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [state.events.length]);
  return (
    <section className="mt-4 rise">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full bg-accent pulse-dot" />
        <h2 className="text-2xl font-semibold tracking-tight">Building your plan</h2>
      </div>
      <p className="text-sm text-muted mt-1">
        Muse Spark is reading {state.members.map((m) => m.name).join(" and ")}&apos;s swipes and checking live trains,
        hotels and restaurants.
      </p>
      <ol className="mt-5 space-y-2 font-mono text-[13px]">
        {state.events.map((e) => (
          <li key={e.id} className="rise flex gap-2 rounded-xl bg-card border border-line px-3 py-2">
            <span className={e.kind === "error" ? "text-accent" : "text-muted"}>
              {e.tool ? TOOL_LABEL[e.tool] ?? e.tool : e.kind === "start" ? "start" : e.kind === "error" ? "error" : "agent"}
            </span>
            <span className="flex-1 break-words">{e.summary}</span>
          </li>
        ))}
        <div ref={endRef} />
      </ol>
    </section>
  );
}

function Failed({
  code,
  memberId,
  state,
  onUpdate,
}: {
  code: string;
  memberId: string;
  state: State;
  onUpdate: (s: State) => void;
}) {
  const last = [...state.events].reverse().find((e) => e.kind === "error");
  const [busy, setBusy] = useState(false);
  async function retry() {
    setBusy(true);
    const r = await fetch(`/api/rooms/${code}/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberId, force: true }),
    });
    setBusy(false);
    if (r.ok) onUpdate(await r.json());
  }
  return (
    <section className="mt-6">
      <h2 className="text-2xl font-semibold">The planner hit a snag</h2>
      <p className="text-sm text-muted mt-2 break-words">{last?.summary ?? "Unknown error"}</p>
      <div className="mt-6">
        <Button full onClick={retry} disabled={busy}>
          Try again
        </Button>
      </div>
    </section>
  );
}
