"use client";

import { useState } from "react";
import type { Plan, PlanItem } from "@/lib/plan-schema";
import { Chip } from "./ui";

const TYPE_ICON: Record<PlanItem["type"], string> = {
  place: "◎",
  meal: "🍜",
  transit: "🚄",
  hotel: "🛏",
  flight: "✈",
  free: "☕",
};

function forTone(f: string[], members: { name: string }[]): { label: string; tone: "accent" | "ok" | "neutral" } {
  if (!f.length || f.includes("both") || f.includes("all") || f.length >= members.length) {
    return { label: "Both", tone: "neutral" };
  }
  return { label: `${f.join(" & ")}'s pick`, tone: f.length === 1 && members[0]?.name === f[0] ? "accent" : "ok" };
}

function prettyDate(d: string) {
  const dt = new Date(d + "T00:00:00");
  return Number.isNaN(dt.getTime()) ? d : dt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

function withRoom(url: string, code: string) {
  return url.startsWith("/book") ? `${url}&room=${code}` : url;
}

export default function Itinerary({ plan, members, code }: { plan: Plan; members: { name: string }[]; code: string }) {
  const [day, setDay] = useState(0);
  const [done, setDone] = useState<Record<number, boolean>>({});
  const d = plan.days[day];
  return (
    <section className="mt-2 rise">
      <h2 className="text-2xl font-semibold tracking-tight leading-tight">{plan.title}</h2>
      <p className="text-sm text-muted mt-1">{plan.summary}</p>

      <div className="mt-4 rounded-2xl bg-accent-soft p-4">
        <div className="text-xs uppercase tracking-wide text-accent">How this balances the group</div>
        <ul className="mt-1.5 text-sm space-y-1">
          {plan.tradeoffs.map((t) => (
            <li key={t} className="flex gap-2">
              <span className="text-accent">•</span>
              <span>{t}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-5 flex gap-2 overflow-x-auto no-scrollbar pb-1 -mx-4 px-4">
        {plan.days.map((x, i) => (
          <button
            key={x.day}
            onClick={() => setDay(i)}
            className={`shrink-0 rounded-full px-3.5 h-9 text-sm font-medium border transition ${i === day ? "bg-foreground text-background border-foreground" : "bg-card border-line text-muted"}`}
          >
            Day {x.day} · {x.city}
          </button>
        ))}
      </div>

      <div className="mt-3 text-sm text-muted">
        {prettyDate(d.date)}
        {d.headline ? ` · ${d.headline}` : ""}
      </div>

      <ol className="mt-3 space-y-3">
        {d.items.map((it, i) => {
          const f = forTone(it.for, members);
          return (
            <li key={i} className="rounded-2xl bg-card border border-line p-4">
              <div className="flex items-start gap-3">
                <div className="w-12 shrink-0">
                  <div className="font-mono text-xs text-muted">{it.time}</div>
                  <div className="text-lg leading-none mt-1">{TYPE_ICON[it.type]}</div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-semibold leading-tight">{it.title}</div>
                    <Chip tone={f.tone}>{f.label}</Chip>
                  </div>
                  {it.detail && <p className="text-sm mt-1">{it.detail}</p>}
                  {it.how && (
                    <p className="mt-2 flex gap-1.5 text-xs leading-snug text-foreground/80 rounded-xl bg-background border border-line px-2.5 py-1.5">
                      <span aria-hidden>↳</span>
                      <span>
                        <span className="font-medium">Getting there: </span>
                        {it.how}
                      </span>
                    </p>
                  )}
                  {it.why && <p className="text-xs text-muted mt-1.5 italic">{it.why}</p>}
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    {it.link && (
                      <a
                        href={withRoom(it.link.url, code)}
                        target={it.link.url.startsWith("/") ? "_self" : "_blank"}
                        rel="noreferrer"
                        className="inline-flex h-8 items-center rounded-full bg-foreground text-background px-3 text-xs font-medium"
                      >
                        {it.link.label}
                      </a>
                    )}
                    {it.cost && <Chip tone="neutral">{it.cost}</Chip>}
                    {it.estimated && <Chip tone="warn">times estimated</Chip>}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {plan.hotels.length > 0 && (
        <div className="mt-6">
          <h3 className="font-semibold">Where you sleep</h3>
          <ul className="mt-2 space-y-2">
            {plan.hotels.map((h) => (
              <li key={h.name + h.checkin} className="rounded-2xl bg-card border border-line p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold leading-tight">{h.name}</div>
                    <div className="text-xs text-muted mt-0.5">
                      {h.city} · {prettyDate(h.checkin)} → {prettyDate(h.checkout)}
                      {h.room ? ` · ${h.room}` : ""}
                    </div>
                  </div>
                  {h.perNightUSD && <div className="text-sm font-medium whitespace-nowrap">${h.perNightUSD}/night</div>}
                </div>
                {h.why && <p className="text-xs text-muted mt-1.5 italic">{h.why}</p>}
                <a
                  href={withRoom(h.bookUrl, code)}
                  className="mt-3 inline-flex h-9 items-center rounded-full bg-accent text-accent-ink px-4 text-sm font-medium"
                >
                  Book {h.totalUSD ? `· $${h.totalUSD} total` : ""}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {plan.tasks && plan.tasks.length > 0 && (
        <div className="mt-6">
          <h3 className="font-semibold">Before you go</h3>
          <p className="text-xs text-muted mt-0.5">
            {Object.values(done).filter(Boolean).length} of {plan.tasks.length} done
          </p>
          <ul className="mt-2 space-y-2">
            {plan.tasks.map((t, i) => (
              <li key={i} className={`rounded-2xl bg-card border border-line p-3.5 flex gap-3 items-start transition ${done[i] ? "opacity-55" : ""}`}>
                <button
                  aria-label={done[i] ? "Mark not done" : "Mark done"}
                  onClick={() => setDone((d) => ({ ...d, [i]: !d[i] }))}
                  className={`mt-0.5 h-5 w-5 shrink-0 rounded-md border flex items-center justify-center text-[11px] ${done[i] ? "bg-ok border-ok text-white" : "border-line bg-background"}`}
                >
                  {done[i] ? "✓" : ""}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className={`font-medium text-sm leading-tight ${done[i] ? "line-through" : ""}`}>{t.title}</div>
                    <Chip tone="neutral">{t.when}</Chip>
                  </div>
                  {t.detail && <p className="text-xs text-muted mt-1">{t.detail}</p>}
                  {t.link && (
                    <a
                      href={withRoom(t.link.url, code)}
                      target={t.link.url.startsWith("/") ? "_self" : "_blank"}
                      rel="noreferrer"
                      className="mt-1.5 inline-flex h-7 items-center rounded-full border border-line bg-background px-2.5 text-xs font-medium"
                    >
                      {t.link.label}
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {plan.notes && plan.notes.length > 0 && (
        <div className="mt-6 text-xs text-muted space-y-1">
          {plan.notes.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </div>
      )}
    </section>
  );
}
