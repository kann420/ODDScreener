import { addClient, getLatest, startSmartMoneyHub } from "@/lib/smartMoneyHub";

export const runtime = "nodejs";

export async function GET(req) {
  // Always make sure the hub is running
  startSmartMoneyHub();

  const { searchParams } = new URL(req.url);

  // ✅ Warm-up mode: start hub but do NOT open SSE stream
  // Call: /api/smart-money/stream?warm=1
  const warm = searchParams.get("warm");
  if (warm === "1" || warm === "true") {
    return new Response("ok", {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const minAmount = Number(searchParams.get("minAmount") || 200);

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send a snapshot first (already newest-first, already pruned to last 24h)
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
        controller.close();
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
