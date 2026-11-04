import OpenAI from "openai";
import { spend } from "./budget";

/**
 * Meta Model API client. The API is OpenAI-compatible, so we use the OpenAI SDK
 * pointed at api.meta.ai. Muse Spark drives the planning agent (function calling);
 * Muse Image generates the swipe cards.
 */
export const SPARK_MODEL = process.env.META_SPARK_MODEL ?? "muse-spark-1.3";
export const IMAGE_MODEL = process.env.META_IMAGE_MODEL ?? "muse-image-1.0";

let client: OpenAI | undefined;
export function meta(): OpenAI {
  if (!client) {
    if (!process.env.META_API_KEY) throw new Error("META_API_KEY is not set");
    client = new OpenAI({
      apiKey: process.env.META_API_KEY,
      baseURL: process.env.META_API_BASE ?? "https://api.meta.ai/v1",
      // Long planning turns occasionally drop the connection; retry rather than fail the whole plan.
      // A long finalize_plan answer can take 4-5 minutes; never cut it off client-side.
      maxRetries: 2,
      timeout: 600_000,
    });
  }
  return client;
}

export type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
export type Tool = OpenAI.Chat.Completions.ChatCompletionTool;

export async function sparkChat(
  messages: ChatMessage[],
  tools?: Tool[],
  opts: { temperature?: number; json?: boolean; maxTokens?: number } = {},
) {
  spend("meta");
  const params = {
    model: SPARK_MODEL,
    messages,
    tools: tools && tools.length ? tools : undefined,
    temperature: opts.temperature ?? 0.4,
    max_tokens: opts.maxTokens ?? 6000,
    ...(opts.json ? { response_format: { type: "json_object" as const } } : {}),
  };
  return meta().chat.completions.create(params);
}

export async function generateImage(prompt: string, size = "1024x1024"): Promise<Buffer> {
  spend("meta");
  const r = await meta().images.generate({ model: IMAGE_MODEL, prompt, n: 1, size: size as "1024x1024" });
  const d = r.data?.[0];
  if (d?.b64_json) return Buffer.from(d.b64_json, "base64");
  if (d?.url) {
    const res = await fetch(d.url);
    return Buffer.from(await res.arrayBuffer());
  }
  throw new Error("Muse Image returned no image data");
}
