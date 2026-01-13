// SSE endpoint for market trades
// This proxies trades from the server-side WebSocket to clients via SSE
// API key stays on server - never exposed to client

import { addMarketClient, getMarketTrades } from "@/lib/marketTradesHub";

export const runtime = "nodejs";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const marketId = searchParams.get("marketId");

  if (!marketId) {
    return new Response(JSON.stringify({ error: "marketId is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const numericMarketId = Number(marketId);
  if (!Number.isFinite(numericMarketId)) {
    return new Response(JSON.stringify({ error: "Invalid marketId" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send initial snapshot of recent trades
      const snapshot = getMarketTrades(numericMarketId).slice(0, 100);
      controller.enqueue(
        encoder.encode(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`)
      );

      // Set up client to receive new trades
      const client = {
        push: (trade) => {
          try {
            controller.enqueue(
              encoder.encode(`event: trade\ndata: ${JSON.stringify(trade)}\n\n`)
            );
          } catch (e) {
            // Client disconnected
          }
        },
      };

      // Add client to hub and get cleanup function
      const removeClient = addMarketClient(numericMarketId, client);

      // Handle client disconnect
      req.signal.addEventListener("abort", () => {
        removeClient();
        try {
          controller.close();
        } catch (e) {
          // Already closed
        }
      });
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
