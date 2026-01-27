/**
 * SSE Streaming endpoint for arbitrage scan
 * Returns results progressively as they are found
 * 
 * GET /api/arbitage/stream?minArbPct=0.1&minSimilarity=0.35&priceMode=bids
 */
import { streamArbitageOpportunities } from "@/lib/arbitageEngine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function toNum(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  
  const minArbPct = toNum(searchParams.get("minArbPct"), 0.1);
  const minSimilarity = Math.max(0.1, Math.min(1, toNum(searchParams.get("minSimilarity"), 0.35)));
  const priceMode = searchParams.get("priceMode") || "bids";
  const limit = Math.max(1, Math.min(500, Math.floor(toNum(searchParams.get("limit"), 100))));

  // Create a ReadableStream for SSE
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      
      const send = (eventType, data) => {
        const message = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(message));
      };

      try {
        // Stream results as they come
        await streamArbitageOpportunities({
          minArbPct,
          minSimilarity,
          priceMode,
          limit,
          onProgress: (progress) => {
            // Progress update: { phase, current, total, message }
            send("progress", progress);
          },
          onMatch: (match) => {
            // Single match found: { row data }
            send("match", match);
          },
          onBatch: (batch) => {
            // Batch of matches: { rows: [...] }
            send("batch", batch);
          }
        });

        // Done
        send("done", { ok: true });
      } catch (err) {
        console.error("[SSE scan] Error:", err);
        send("error", { message: err.message || "Scan failed" });
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no", // Disable nginx buffering
    }
  });
}
