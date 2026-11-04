import { meta, SPARK_MODEL } from "@/lib/muse";
import { usage } from "@/lib/budget";

export const dynamic = "force-dynamic";

/**
 * Deployment check: which model/base the server will use, whether the keys are present,
 * today's API usage, and (with ?probe=1) one tiny Muse Spark call. Never returns key values.
 */
export async function GET(req: Request) {
  const probe = new URL(req.url).searchParams.get("probe") === "1";
  const out: Record<string, unknown> = {
    ok: true,
    model: SPARK_MODEL,
    base: process.env.META_API_BASE ?? "https://api.meta.ai/v1 (default)",
    keys: {
      meta: !!process.env.META_API_KEY,
      google: !!process.env.GOOGLE_MAPS_API_KEY,
      liteapi: !!process.env.LITEAPI_KEY,
    },
    dbPath: process.env.DB_PATH ?? "data/app.db (default)",
    usage: usage(),
    node: process.version,
  };
  if (new URL(req.url).searchParams.get("models") === "1") {
    try {
      const list = await meta().models.list();
      out.models = list.data.map((m) => m.id);
    } catch (e) {
      const err = e as { status?: number; message?: string };
      out.models = { status: err.status ?? null, message: String(err.message ?? e).slice(0, 200) };
    }
  }
  if (new URL(req.url).searchParams.get("net") === "1") {
    // Where do outbound calls come from, and what does Meta's API say to a bare request?
    try {
      const ip = await fetch("https://ipinfo.io/json", { headers: { Accept: "application/json" } }).then((r) => r.json());
      out.egress = { ip: ip.ip, city: ip.city, country: ip.country, org: ip.org };
    } catch (e) {
      out.egress = String(e).slice(0, 120);
    }
    try {
      const r = await fetch(`${process.env.META_API_BASE ?? "https://api.meta.ai/v1"}/models`, {
        headers: { Authorization: `Bearer ${process.env.META_API_KEY}` },
      });
      const hdr: Record<string, string> = {};
      r.headers.forEach((v, k) => {
        if (!/cookie|set-cookie/i.test(k)) hdr[k] = v.slice(0, 80);
      });
      out.rawModels = { status: r.status, body: (await r.text()).slice(0, 300), headers: hdr };
    } catch (e) {
      out.rawModels = String(e).slice(0, 120);
    }
  }
  if (probe) {
    try {
      const r = await meta().chat.completions.create({
        model: SPARK_MODEL,
        messages: [{ role: "user", content: "Reply with the single word ok." }],
        max_tokens: 5,
      });
      out.probe = { status: 200, reply: r.choices[0]?.message?.content ?? null, model: r.model };
    } catch (e) {
      const err = e as { status?: number; message?: string; error?: unknown; headers?: Record<string, string> };
      out.ok = false;
      out.probe = {
        status: err.status ?? null,
        message: String(err.message ?? e).slice(0, 300),
        body: err.error ? JSON.stringify(err.error).slice(0, 300) : undefined,
      };
    }
  }
  return Response.json(out, { status: out.ok ? 200 : 500 });
}
