"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Plan } from "@/lib/plan-schema";
import type { Expense, PhotoMeta } from "@/lib/trip";
import Itinerary from "./Itinerary";
import { Chip } from "./ui";

type TripData = { expenses: Expense[]; photos: PhotoMeta[]; members: { id: string; name: string }[] };
type Tab = "plan" | "expenses" | "photos";
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
  const [tab, setTab] = useState<Tab>("plan");
  const [data, setData] = useState<TripData | null>(null);
  const load = useCallback(async () => {
    const r = await fetch(`/api/rooms/${code}/trip`, { cache: "no-store" });
    if (r.ok) setData(await r.json());
  }, [code]);
  useEffect(() => {
    if (tab === "plan") return;
    // load() fetches, then sets state in its callback (not synchronously).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [tab, load]);

  return (
    <div>
      <div className="mt-2 flex gap-1 rounded-full bg-line/50 p-1">
        {(["plan", "expenses", "photos"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 h-9 rounded-full text-sm font-medium transition first-letter:uppercase ${tab === t ? "bg-card shadow-sm" : "text-muted"}`}
          >
            {t === "plan" ? "Plan" : t === "expenses" ? "Expenses" : "Photos"}
          </button>
        ))}
      </div>
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

      <ol className="mt-4 space-y-2">
        {rows.map(({ e, showDay }) => {
          const day = e.at.slice(0, 10);
          return (
            <li key={e.id}>
              {showDay && <div className="text-xs uppercase tracking-wide text-muted mt-3 mb-1">{new Date(day + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</div>}
              <div className="rounded-2xl bg-card border border-line p-3">
                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    defaultValue={e.at.slice(11, 16)}
                    onBlur={(ev) => ev.target.value && ev.target.value !== e.at.slice(11, 16) && patch(e.id, { at: `${day}T${ev.target.value}` })}
                    className={`${inputCls} w-[86px] font-mono text-xs`}
                  />
                  <input
                    defaultValue={e.title}
                    onBlur={(ev) => ev.target.value !== e.title && patch(e.id, { title: ev.target.value })}
                    className={`${inputCls} flex-1 min-w-0 font-medium`}
                  />
                  <button onClick={() => remove(e.id)} aria-label="Delete" className="h-8 w-8 rounded-lg text-muted hover:bg-background">
                    ×
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    type="number"
                    step="0.01"
                    defaultValue={e.amount}
                    onBlur={(ev) => Number(ev.target.value) !== e.amount && patch(e.id, { amount: Number(ev.target.value) })}
                    className={`${inputCls} w-[96px] text-right tabular-nums`}
                  />
                  <input
                    defaultValue={e.currency}
                    maxLength={3}
                    onBlur={(ev) => ev.target.value.toUpperCase() !== e.currency && patch(e.id, { currency: ev.target.value })}
                    className={`${inputCls} w-[54px] uppercase text-xs`}
                  />
                  <select value={e.category} onChange={(ev) => patch(e.id, { category: ev.target.value })} className={`${inputCls} text-xs w-[92px]`}>
                    {CATS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <select value={e.memberId} onChange={(ev) => patch(e.id, { memberId: ev.target.value })} className={`${inputCls} text-xs flex-1 min-w-[110px]`}>
                    {(data?.members ?? []).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} paid
                      </option>
                    ))}
                  </select>
                </div>
                {(e.note || e.photoId) && (
                  <div className="mt-2 flex items-center gap-2">
                    {e.photoId && (
                      <a href={`/api/photos/${e.photoId}`} target="_blank" rel="noreferrer" className="shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/api/photos/${e.photoId}`} alt="receipt" className="h-10 w-10 rounded-lg object-cover border border-line" />
                      </a>
                    )}
                    {e.note && <p className="text-xs text-muted truncate">{e.note}</p>}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
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
