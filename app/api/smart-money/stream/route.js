import { getSmartMoneyPlatformAdapter, normalizeSmartMoneyPlatform } from "@/lib/smartMoneyPlatform";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const warm = searchParams.get("warm");
  const platform = normalizeSmartMoneyPlatform(searchParams.get("platform"));
  const adapter = getSmartMoneyPlatformAdapter(platform);

  if (warm === "1" || warm === "true") {
    await adapter.start();
    return new Response("ok", {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  }

  await adapter.start();

  const minAmount = Number(searchParams.get("minAmount") || 200);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const snapshot = adapter.getLatest()
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

      const remove = adapter.addClient(client);

      req.signal.addEventListener("abort", () => {
        remove();
        try { controller.close(); } catch {}
      });
    },
    cancel() {},
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
