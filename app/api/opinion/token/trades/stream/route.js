// SSE endpoint for market trades
// Proxies trades from server-side Opinion WebSocket to the browser via SSE.
// The API key stays on the server - never exposed to client.

import { addMarketClient, getMarketTrades } from "@/lib/marketTradesHub";
import { acquireIpSseLimit } from "@/lib/apiRouteProtection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STREAM_START_RATE_LIMIT_OPTS = { windowMs: 60_000, maxRequests: 20 };
const STREAM_CONCURRENCY_OPTS = { maxConcurrent: 4, staleMs: 10 * 60_000 };

export async function GET(req) {
  const streamGuard = acquireIpSseLimit(
    req,
    "opinion-token-trades-stream",
    STREAM_START_RATE_LIMIT_OPTS,
    STREAM_CONCURRENCY_OPTS,
    {
      rateLimitMessage: "Too many live trade stream requests. Please wait and try again.",
      busyMessage: "Too many live trade streams from this IP. Please close another tab and try again.",
    }
  );
  if (streamGuard.response) {
    return streamGuard.response;
  }

  const { searchParams } = new URL(req.url);
  const marketIdParam = searchParams.get("marketId");
  const rootMarketIdParam = searchParams.get("rootMarketId");

  const marketId = marketIdParam != null ? Number(marketIdParam) : null;
  const rootMarketId = rootMarketIdParam != null ? Number(rootMarketIdParam) : null;

  if (!Number.isFinite(marketId) && !Number.isFinite(rootMarketId)) {
    streamGuard.release();
    return new Response(JSON.stringify({ error: "marketId or rootMarketId is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const sub = {
    marketId: Number.isFinite(marketId) ? marketId : null,
    rootMarketId: Number.isFinite(rootMarketId) ? rootMarketId : null,
  };

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Initial snapshot
      const snapshot = getMarketTrades(sub).slice(0, 100);
      controller.enqueue(
        encoder.encode(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`)
      );

      const client = {
        push: (trade) => {
          try {
            controller.enqueue(
              encoder.encode(`event: trade\ndata: ${JSON.stringify(trade)}\n\n`)
            );
          } catch {
            // client disconnected
          }
        },
      };

      let remove = () => {};
      try {
        remove = addMarketClient(sub, client);
      } catch (e) {
        streamGuard.release();
        controller.enqueue(
          encoder.encode(
            `event: error\ndata: ${JSON.stringify({ error: String(e?.message || e) })}\n\n`
          )
        );
        try { controller.close(); } catch {}
      }

      req.signal.addEventListener("abort", () => {
        try { remove(); } catch {}
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
      // Helps avoid buffering on some proxies
      "X-Accel-Buffering": "no",
    },
  });
}
