"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { Plan } from "@/lib/plan-schema";
import type { Expense, PhotoMeta } from "@/lib/trip";
import Itinerary from "./Itinerary";
import { Chip } from "./ui";

type TripData = { expenses: Expense[]; photos: PhotoMeta[]; members: { id: string; name: string; avatar: number | null }[] };
type Tab = "chat" | "plan" | "expenses" | "photos";
type ChatMsg = { id: number; memberId: string | null; memberName: string; avatar: number | null; text: string; photoIds: string[]; actions: string[]; createdAt: string };
const CATS = ["food", "transport", "lodging", "tickets", "shopping", "other"];
const inputCls = "h-8 rounded-lg border border-line bg-background px-2 text-sm outline-none focus:border-accent";

/** Shrink a photo in the browser before upload: max 1280px, JPEG. Keeps the SQLite file small. */
async function shrink(file: File): Promise<Blob> {
  if (!/^image\//.test(file.type)) return file;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise<Blob>((res) => c.toBlob((b) => res(b ?? file), "image/jpeg", 0.86));
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function Trip({ code, memberId, plan, members }: { code: string; memberId: string; plan: Plan; members: { name: string }[] }) {
  const [tab, setTab] = useState<Tab>("chat");
  const [data, setData] = useState<TripData | null>(null);
  const load = useCallback(async () => {
    const r = await fetch(`/api/rooms/${code}/trip`, { cache: "no-store" });
    if (r.ok) setData(await r.json());
  }, [code]);
  useEffect(() => {
    if (tab === "plan" || tab === "chat") return;
    // load() fetches, then sets state in its callback (not synchronously).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [tab, load]);

  return (
    <div>
      <div className="mt-2 flex gap-1 rounded-full bg-line/50 p-1">
        {(["chat", "plan", "expenses", "photos"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 h-9 rounded-full text-sm font-medium transition first-letter:uppercase ${tab === t ? "bg-card shadow-sm" : "text-muted"}`}
          >
            {t === "chat" ? "Chat" : t === "plan" ? "Plan" : t === "expenses" ? "Expenses" : "Photos"}
          </button>
        ))}
      </div>
      {tab === "chat" && <Chat code={code} memberId={memberId} />}
      {tab === "plan" && <Itinerary plan={plan} members={members} code={code} />}
      {tab === "expenses" && <Expenses code={code} memberId={memberId} data={data} reload={load} />}
      {tab === "photos" && <Gallery code={code} memberId={memberId} data={data} reload={load} />}
    </div>
  );
}

function fmt(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function Expenses({ code, memberId, data, reload }: { code: string; memberId: string; data: TripData | null; reload: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function scan(file: File) {
    setBusy("Reading receipt with Muse Spark…");
    setMsg(null);
    const fd = new FormData();
    fd.append("file", await shrink(file), "receipt.jpg");
    fd.append("memberId", memberId);
    fd.append("kind", "receipt");
    const r = await fetch(`/api/rooms/${code}/photos`, { method: "POST", body: fd });
    const j = await r.json();
    setBusy(null);
    if (!r.ok) return setMsg(j.error ?? "Upload failed");
    setMsg(j.read?.total != null ? `Read ${j.read.merchant ?? "receipt"}: ${fmt(j.read.total)} ${j.read.currency ?? ""}. Edit anything below.` : "Added a row; the receipt could not be read, so fill it in.");
    await reload();
  }
  async function addManual() {
    setBusy("Adding…");
    await fetch(`/api/rooms/${code}/expenses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberId, at: new Date().toISOString().slice(0, 16), title: "New item", category: "other", amount: 0, currency: "JPY" }),
    });
    setBusy(null);
    await reload();
  }
  async function patch(id: string, p: Record<string, unknown>) {
    await fetch(`/api/expenses/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) });
    await reload();
  }
  async function remove(id: string) {
    await fetch(`/api/expenses/${id}`, { method: "DELETE" });
    await reload();
  }

  const totals = new Map<string, number>();
  for (const e of data?.expenses ?? []) totals.set(e.currency, (totals.get(e.currency) ?? 0) + e.amount);
  const rows = (data?.expenses ?? []).map((e, i, arr) => ({ e, showDay: i === 0 || arr[i - 1].at.slice(0, 10) !== e.at.slice(0, 10) }));

  return (
    <section className="mt-4 rise">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Expenses</h2>
          <p className="text-xs text-muted mt-0.5">Shared with everyone in the trip. Tap any cell to edit.</p>
        </div>
        <div className="text-right">
          {[...totals.entries()].map(([cur, n]) => (
            <div key={cur} className="text-sm font-semibold whitespace-nowrap">
              {fmt(n)} <span className="text-muted font-normal">{cur}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) scan(f);
            e.target.value = "";
          }}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={!!busy}
          className="flex-1 h-11 rounded-full bg-accent text-accent-ink font-medium text-sm disabled:opacity-50"
        >
          📷 Scan a receipt
        </button>
        <button onClick={addManual} disabled={!!busy} className="h-11 px-4 rounded-full border border-line bg-card text-sm font-medium disabled:opacity-50">
          + Add
        </button>
      </div>
      {busy && (
        <p className="mt-2 text-xs text-muted flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-accent pulse-dot" /> {busy}
        </p>
      )}
      {msg && <p className="mt-2 text-xs text-ok">{msg}</p>}

      <div className="mt-4 -mx-4 px-4 overflow-x-auto thin-scrollbar pb-2">
        <table className="table-fixed w-[860px] border-separate border-spacing-0 text-sm">
          <colgroup>
            <col style={{ width: 100 }} />
            <col style={{ width: 250 }} />
            <col style={{ width: 120 }} />
            <col style={{ width: 70 }} />
            <col style={{ width: 120 }} />
            <col style={{ width: 130 }} />
            <col style={{ width: 70 }} />
          </colgroup>
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-muted whitespace-nowrap">
              <th className="text-left font-medium pb-2 pr-2">Time</th>
              <th className="text-left font-medium pb-2 pr-2">Item</th>
              <th className="text-right font-medium pb-2 pr-2">Amount</th>
              <th className="text-left font-medium pb-2 pr-2">Cur</th>
              <th className="text-left font-medium pb-2 pr-2">Category</th>
              <th className="text-left font-medium pb-2 pr-2">Paid by</th>
              <th className="pb-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ e, showDay }) => {
              const day = e.at.slice(0, 10);
              return (
                <Fragment key={e.id}>
                  {showDay && (
                    <tr>
                      <td colSpan={7} className="pt-3 pb-1 text-[11px] uppercase tracking-wide text-muted">
                        {new Date(day + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
                      </td>
                    </tr>
                  )}
                  <tr className="bg-card">
                    <td className="border-y border-l border-line rounded-l-xl p-1.5">
                      <input type="time" defaultValue={e.at.slice(11, 16)} onBlur={(ev) => ev.target.value && ev.target.value !== e.at.slice(11, 16) && patch(e.id, { at: `${day}T${ev.target.value}` })} className={`${inputCls} w-full font-mono text-xs`} />
                    </td>
                    <td className="border-y border-line p-1.5">
                      <input defaultValue={e.title} onBlur={(ev) => ev.target.value !== e.title && patch(e.id, { title: ev.target.value })} className={`${inputCls} w-full font-medium`} />
                      {e.note && <div className="mt-0.5 text-[11px] text-muted truncate" title={e.note}>{e.note}</div>}
                    </td>
                    <td className="border-y border-line p-1.5">
                      <input type="number" step="0.01" defaultValue={e.amount} onBlur={(ev) => Number(ev.target.value) !== e.amount && patch(e.id, { amount: Number(ev.target.value) })} className={`${inputCls} w-full text-right tabular-nums`} />
                    </td>
                    <td className="border-y border-line p-1.5">
                      <input defaultValue={e.currency} maxLength={3} onBlur={(ev) => ev.target.value.toUpperCase() !== e.currency && patch(e.id, { currency: ev.target.value })} className={`${inputCls} w-full uppercase text-xs`} />
                    </td>
                    <td className="border-y border-line p-1.5">
                      <select value={e.category} onChange={(ev) => patch(e.id, { category: ev.target.value })} className={`${inputCls} w-full text-xs`}>
                        {CATS.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="border-y border-line p-1.5">
                      <select value={e.memberId} onChange={(ev) => patch(e.id, { memberId: ev.target.value })} className={`${inputCls} w-full text-xs`}>
                        {(data?.members ?? []).map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="border-y border-r border-line rounded-r-xl p-1.5 whitespace-nowrap">
                      {e.photoId && (
                        <a href={`/api/photos/${e.photoId}`} target="_blank" rel="noreferrer" className="inline-block align-middle mr-1">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={`/api/photos/${e.photoId}`} alt="receipt" className="h-7 w-7 rounded-md object-cover border border-line" />
                        </a>
                      )}
                      <button onClick={() => remove(e.id)} aria-label="Delete" className="h-7 w-7 rounded-md text-muted hover:bg-background align-middle">
                        ×
                      </button>
                    </td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
          {totals.size > 0 && (
            <tfoot>
              <tr>
                <td colSpan={2} className="pt-3 text-right text-xs uppercase tracking-wide text-muted pr-2">Total</td>
                <td colSpan={5} className="pt-3 font-semibold tabular-nums">
                  {[...totals.entries()].map(([cur, n]) => (
                    <span key={cur} className="mr-3">
                      {fmt(n)} <span className="text-muted font-normal">{cur}</span>
                    </span>
                  ))}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {data && data.expenses.length === 0 && (
        <p className="mt-6 text-center text-sm text-muted">No expenses yet. Scan the first receipt or add one by hand.</p>
      )}
    </section>
  );
}

function Gallery({ code, memberId, data, reload }: { code: string; memberId: string; data: TripData | null; reload: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  async function upload(files: FileList) {
    const list = Array.from(files).slice(0, 10);
    for (let i = 0; i < list.length; i++) {
      setBusy(`Uploading ${i + 1} of ${list.length}…`);
      const fd = new FormData();
      fd.append("file", await shrink(list[i]), "photo.jpg");
      fd.append("memberId", memberId);
      fd.append("kind", "gallery");
      await fetch(`/api/rooms/${code}/photos`, { method: "POST", body: fd });
    }
    setBusy(null);
    await reload();
  }
  const photos = (data?.photos ?? []).filter((p) => p.kind === "gallery");
  return (
    <section className="mt-4 rise">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Photos</h2>
          <p className="text-xs text-muted mt-0.5">One shared album for the whole trip.</p>
        </div>
        <Chip tone="neutral">{photos.length}</Chip>
      </div>
      <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => e.target.files && upload(e.target.files)} />
      <button onClick={() => fileRef.current?.click()} disabled={!!busy} className="mt-3 w-full h-11 rounded-full bg-accent text-accent-ink font-medium text-sm disabled:opacity-50">
        {busy ?? "＋ Add photos"}
      </button>
      <div className="mt-4 grid grid-cols-3 gap-1.5">
        {photos.map((p) => (
          <a key={p.id} href={`/api/photos/${p.id}`} target="_blank" rel="noreferrer" className="relative aspect-square rounded-xl overflow-hidden bg-line/40">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/photos/${p.id}`} alt={p.caption ?? ""} loading="lazy" className="h-full w-full object-cover" />
            <span className="absolute left-1 bottom-1 rounded-full bg-black/55 text-white text-[10px] px-1.5 py-0.5">{p.memberName}</span>
          </a>
        ))}
      </div>
      {data && photos.length === 0 && <p className="mt-6 text-center text-sm text-muted">No photos yet.</p>}
    </section>
  );
}


const AVATARS = 6;
/** Member icon: one of six Muse Image portraits, picked by name so it stays stable. Muse gets the accent mark. */
function Avatar({ name, agent, chosen, size = 28 }: { name: string; agent?: boolean; chosen?: number | null; size?: number }) {
  if (agent) {
    return (
      <span aria-hidden title="Muse" className="inline-flex shrink-0 items-center justify-center rounded-full bg-accent text-white font-semibold" style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}>
        ✦
      </span>
    );
  }
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`/avatars/${chosen ?? (h % AVATARS) + 1}.webp`} alt={name} title={name} className="shrink-0 rounded-full object-cover ring-1 ring-black/5" style={{ width: size, height: size }} />
  );
}

function Chat({ code, memberId }: { code: string; memberId: string }) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [text, setText] = useState("");
  const [waiting, setWaiting] = useState<number | null>(null); // timestamp of our last send awaiting a reply
  const bottom = useRef<HTMLDivElement>(null);
  const lastId = msgs.length ? msgs[msgs.length - 1].id : 0;

  const poll = useCallback(async () => {
    const r = await fetch(`/api/rooms/${code}/chat?after=${lastId}`, { cache: "no-store" });
    if (!r.ok) return;
    const j = (await r.json()) as { messages: ChatMsg[] };
    if (j.messages.length) {
      setMsgs((m) => [...m, ...j.messages.filter((x) => !m.some((y) => y.id === x.id))]);
      if (j.messages.some((x) => !x.memberId)) setWaiting(null);
    }
  }, [code, lastId]);
  useEffect(() => {
    // poll() fetches and sets state in its callback, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    poll();
    const t = setInterval(poll, 2500);
    return () => clearInterval(t);
  }, [poll]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [msgs.length, waiting]);
  useEffect(() => {
    if (waiting == null) return;
    const t = setTimeout(() => setWaiting(null), 120000);
    return () => clearTimeout(t);
  }, [waiting]);

  async function removeMsg(id: number) {
    await fetch(`/api/rooms/${code}/chat?memberId=${memberId}&id=${id}`, { method: "DELETE" });
    setMsgs((m) => m.filter((x) => x.id !== id));
  }
  async function clearChat() {
    if (!window.confirm("Delete the whole chat for everyone in this trip?")) return;
    await fetch(`/api/rooms/${code}/chat?memberId=${memberId}`, { method: "DELETE" });
    setMsgs([]);
    setWaiting(null);
  }

  async function send() {
    const t = text.trim();
    if (!t) return;
    setText("");
    setWaiting(Date.now());
    await fetch(`/api/rooms/${code}/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ memberId, text: t }) });
    await poll();
  }

  const suggestions = ["Move tomorrow's dinner to 19:30", "Show me the photos from today", "Fix the last receipt: it was 10,095 yen", "What's the plan for Day 2?"];
  // Wander is "typing" whenever the newest message is from a person and recent. Everyone sees it, reloads included.
  const last = msgs[msgs.length - 1];
  const utc = (t: string) => new Date(t.replace(" ", "T") + (t.endsWith("Z") ? "" : "Z"));
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const pending = waiting != null || (!!last && !!last.memberId && now - utc(last.createdAt).getTime() < 150000);
  const since = last && last.memberId ? Math.max(0, Math.round((now - utc(last.createdAt).getTime()) / 1000)) : 0;
  const localTime = (t: string) => utc(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <section className="mt-3 rise flex flex-col" style={{ minHeight: "60dvh" }}>
      {msgs.length > 0 && (
        <div className="flex justify-end">
          <button onClick={clearChat} className="text-[11px] text-muted hover:text-accent">
            Clear chat
          </button>
        </div>
      )}
      <div className="flex-1 space-y-2">
        {msgs.length === 0 && (
          <div className="rounded-2xl bg-accent-soft p-4 text-sm">
            <div className="flex items-center gap-2 font-medium">
              <Avatar name="Muse" agent size={22} /> Muse is in this chat
            </div>
            <p className="mt-1 text-muted">Ask Muse to change the plan, fix an expense, or pull up photos. Talk to each other too; it stays quiet unless you need it.</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {suggestions.map((sg) => (
                <button key={sg} onClick={() => setText(sg)} className="rounded-full border border-line bg-card px-3 py-1 text-xs">
                  {sg}
                </button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m) => {
          const mine = m.memberId === memberId;
          const agent = !m.memberId;
          return (
            <div key={m.id} className={`group flex items-end gap-2 ${mine ? "justify-end" : "justify-start"}`}>
              {!mine && <Avatar name={m.memberName} agent={agent} chosen={m.avatar} />}
              {mine && (
                <button onClick={() => removeMsg(m.id)} aria-label="Delete message" className="self-center h-6 w-6 rounded-full text-muted opacity-40 hover:opacity-100 hover:bg-line/60 text-xs">
                  ×
                </button>
              )}
              <div className={`relative max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm ${mine ? "bg-foreground text-background" : agent ? "bg-accent-soft" : "bg-card border border-line"}`}>
                {agent && (
                  <button onClick={() => removeMsg(m.id)} aria-label="Delete message" className="absolute right-1.5 top-1 h-5 w-5 rounded-full text-accent/60 hover:text-accent hover:bg-white/60 text-xs">
                    ×
                  </button>
                )}
                <div className={`text-[11px] font-medium mb-0.5 ${mine ? "text-background/70" : agent ? "text-accent" : "text-muted"}`}>{mine ? `${m.memberName} (you)` : m.memberName}</div>
                <div className="whitespace-pre-wrap leading-snug">{m.text}</div>
                {m.photoIds.length > 0 && (
                  <div className="mt-2 grid grid-cols-3 gap-1">
                    {m.photoIds.map((id) => (
                      <a key={id} href={`/api/photos/${id}`} target="_blank" rel="noreferrer" className="aspect-square rounded-lg overflow-hidden">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/api/photos/${id}`} alt="" className="h-full w-full object-cover" />
                      </a>
                    ))}
                  </div>
                )}
                {m.actions.length > 0 && (
                  <div className="mt-1.5 text-[11px] text-muted">
                    {m.actions.map((a, i) => (
                      <div key={i}>✓ {a}</div>
                    ))}
                  </div>
                )}
                <div className={`mt-1 text-[10px] ${mine ? "text-background/60" : "text-muted"}`}>{localTime(m.createdAt)}</div>
              </div>
              {mine && <Avatar name={m.memberName} chosen={m.avatar} />}
            </div>
          );
        })}
        {pending && (
          <div className="flex items-end gap-2 justify-start">
            <Avatar name="Muse" agent />
            <div className="rounded-2xl bg-accent-soft px-3.5 py-2.5 text-xs text-accent flex items-center gap-2">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent pulse-dot" />
              {since < 8 ? "Muse is reading the plan" : since < 25 ? "Muse is checking places and routes" : "Muse is writing the change"}
              <span className="text-accent/60">{since}s</span>
            </div>
          </div>
        )}
        <div ref={bottom} />
      </div>
      <form
        className="sticky bottom-0 mt-3 flex gap-2 bg-background py-2"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Message the group, or ask Muse…"
          className="flex-1 h-11 rounded-full border border-line bg-card px-4 text-sm outline-none focus:border-accent"
        />
        <button type="submit" disabled={!text.trim()} className="h-11 px-4 rounded-full bg-accent text-accent-ink text-sm font-medium disabled:opacity-40">
          Send
        </button>
      </form>
    </section>
  );
}
