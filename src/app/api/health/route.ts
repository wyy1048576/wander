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
