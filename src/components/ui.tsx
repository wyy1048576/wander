import type { ReactNode } from "react";

export function Phone({ children }: { children: ReactNode }) {
  return <main className="mx-auto w-full max-w-[430px] min-h-dvh flex flex-col px-4 pb-10">{children}</main>;
}

export function Button({
  children,
  onClick,
  type = "button",
  variant = "primary",
  disabled,
  full,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: "primary" | "ghost";
  disabled?: boolean;
  full?: boolean;
}) {
  const base =
    "inline-flex items-center justify-center rounded-full px-5 h-12 font-medium transition active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100";
  const styles =
    variant === "primary"
      ? "bg-accent text-accent-ink shadow-sm hover:brightness-95"
      : "bg-card text-foreground border border-line hover:bg-accent-soft";
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${styles} ${full ? "w-full" : ""}`}>
      {children}
    </button>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs uppercase tracking-wide text-muted mb-1">{label}</span>
      {children}
    </label>
  );
}

export const inputCls =
  "w-full h-11 rounded-xl border border-line bg-card px-3 text-base outline-none focus:border-accent";

export function Chip({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" | "ok" | "warn" }) {
  const t =
    tone === "accent"
      ? "bg-accent-soft text-accent"
      : tone === "ok"
        ? "bg-ok-soft text-ok"
        : tone === "warn"
          ? "bg-warn-soft text-foreground"
          : "bg-line/60 text-muted";
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${t}`}>{children}</span>;
}

export function Brand() {
  return (
    <div className="flex items-center gap-2 py-4">
      <span className="inline-block h-3 w-3 rounded-full bg-accent" />
      <span className="font-semibold tracking-tight">Wander</span>
    </div>
  );
}
