// SSE streaming and basic per-IP rate limiting for API routes.
import type { RunEvent } from "./types";

export function sseResponse(work: (emit: (e: RunEvent) => void) => Promise<void>): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const emit = (e: RunEvent) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          closed = true;
        }
      };
      const ping = setInterval(() => {
        if (!closed) {
          try {
            controller.enqueue(enc.encode(": ping\n\n"));
          } catch {
            closed = true;
          }
        }
      }, 15_000);
      try {
        await work(emit);
      } catch (err) {
        emit({ type: "error", message: (err as Error).message || "Something went wrong." });
      } finally {
        clearInterval(ping);
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
  });
}

const buckets = new Map<string, { tokens: number; at: number }>();

/** Token bucket per IP and route: `perMinute` requests, bursting to the same amount. Best-effort (per instance). */
export function rateLimit(req: Request, route: string, perMinute: number): Response | null {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
  const key = `${route}:${ip}`;
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: perMinute, at: now };
  b.tokens = Math.min(perMinute, b.tokens + ((now - b.at) / 60_000) * perMinute);
  b.at = now;
  if (b.tokens < 1) {
    buckets.set(key, b);
    return Response.json({ error: "Too many requests. Please wait a minute and try again." }, { status: 429, headers: { "Retry-After": "30" } });
  }
  b.tokens -= 1;
  buckets.set(key, b);
  if (buckets.size > 5000) for (const [k, v] of buckets) if (now - v.at > 600_000) buckets.delete(k);
  return null;
}
