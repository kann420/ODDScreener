import { addClient, getLatest, startSmartMoneyHub } from "@/lib/smartMoneyHub";

export const runtime = "nodejs";

export async function GET(req) {
  startSmartMoneyHub();

  const { searchParams } = new URL(req.url);
  const minAmount = Number(searchParams.get("minAmount") || 200);

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // send snapshot first
      const snapshot = getLatest().filter((x) => Number(x.amount) >= minAmount).slice(0, 100);
      controller.enqueue(encoder.encode(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`));

      const client = {
        minAmount,
        push: (obj) => {
          controller.enqueue(encoder.encode(`event: trade\ndata: ${JSON.stringify(obj)}\n\n`));
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
