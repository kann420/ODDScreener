import { addClient, getLatest, startSmartMoneyHub } from "@/lib/smartMoneyHub";
import { acquireIpSseLimit, enforceIpRateLimit } from "@/lib/apiRouteProtection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WARM_RATE_LIMIT_OPTS = { windowMs: 60_000, maxRequests: 20 };
const STREAM_START_RATE_LIMIT_OPTS = { windowMs: 60_000, maxRequests: 12 };
const STREAM_CONCURRENCY_OPTS = { maxConcurrent: 3, staleMs: 10 * 60_000 };

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const warm = searchParams.get("warm");

  if (warm === "1" || warm === "true") {
    const limited = enforceIpRateLimit(
      req,
      "smart-money-stream-warm",
      WARM_RATE_LIMIT_OPTS,
      "Too many smart money warm-up requests. Please slow down."
    );
    if (limited) return limited;

    startSmartMoneyHub();
    return new Response("ok", {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const streamGuard = acquireIpSseLimit(
    req,
    "smart-money-stream",
    STREAM_START_RATE_LIMIT_OPTS,
    STREAM_CONCURRENCY_OPTS,
    {
      rateLimitMessage: "Too many smart money stream requests. Please wait and try again.",
      busyMessage: "Too many active smart money streams from this IP. Please close another tab and try again.",
    }
  );
  if (streamGuard.response) {
    return streamGuard.response;
  }

  startSmartMoneyHub();

  const minAmount = Number(searchParams.get("minAmount") || 200);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const snapshot = getLatest()
        .filter((x) => Number(x.amount) >= minAmount)
        .slice(0, 100);

      controller.enqueue(encoder.encode(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`));

      const client = {
        minAmount,
        push: (obj) => {
          try {
            controller.enqueue(encoder.encode(`event: trade\ndata: ${JSON.stringify(obj)}\n\n`));
          } catch {
            // Client disconnected, controller already closed
          }
        },
      };

      const remove = addClient(client);

      req.signal.addEventListener("abort", () => {
        remove();
        streamGuard.release();
        try { controller.close(); } catch {}
      });
    },
    cancel() {
      streamGuard.release();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
