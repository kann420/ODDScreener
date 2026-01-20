// SSE endpoint for market trades
// Proxies trades from server-side Opinion WebSocket to the browser via SSE.
// The API key stays on the server - never exposed to client.

import { addMarketClient, getMarketTrades } from "@/lib/marketTradesHub";

export const runtime = "nodejs";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const marketIdParam = searchParams.get("marketId");
  const rootMarketIdParam = searchParams.get("rootMarketId");

  const marketId = marketIdParam != null ? Number(marketIdParam) : null;
  const rootMarketId = rootMarketIdParam != null ? Number(rootMarketIdParam) : null;

  if (!Number.isFinite(marketId) && !Number.isFinite(rootMarketId)) {
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
      let remove = () => {};
      let pingTimer = null;

      const send = (str) => {
        controller.enqueue(encoder.encode(str));
      };

      try {
        // Initial snapshot
        const snapshot = getMarketTrades(sub).slice(0, 100);
        send(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);

        const client = {
          push: (trade) => {
            try {
              send(`event: trade\ndata: ${JSON.stringify(trade)}\n\n`);
            } catch {
              // ignore
            }
          },
        };

        remove = addMarketClient(sub, client);

        // ✅ Keep-alive ping (prevents some proxies from closing idle SSE)
        pingTimer = setInterval(() => {
          try {
            send(`event: ping\ndata: ${Date.now()}\n\n`);
          } catch {
            // ignore
          }
        }, 15000);
      } catch (e) {
        try {
          send(`event: error\ndata: ${JSON.stringify({ error: String(e?.message || e) })}\n\n`);
        } catch {}
        try { controller.close(); } catch {}
        return;
      }

      const cleanup = () => {
        try { if (pingTimer) clearInterval(pingTimer); } catch {}
        try { remove(); } catch {}
        try { controller.close(); } catch {}
      };

      req.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
