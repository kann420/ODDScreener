/**
 * SSE Streaming endpoint for arbitrage scan
 * Returns results progressively as they are found
 * 
 * GET /api/arbitage/stream?minArbPct=0.1&minSimilarity=0.35&priceMode=bids
 */
import { streamArbitageOpportunities } from "@/lib/arbitageEngine";
import { NextResponse } from "next/server";
import { clearArbitrageSessionCookie, requireArbitrageAccess } from "@/lib/arbitrageAccessSession";
import {
  acquireConcurrentLimitByKey,
  checkRateLimitByKey,
  getClientIp,
  releaseConcurrentLimitByKey,
} from "@/lib/apiRateLimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STREAM_START_RATE_LIMIT_OPTS = { windowMs: 15 * 60_000, maxRequests: 4 };
const STREAM_CONCURRENCY_OPTS = { maxConcurrent: 1, staleMs: 20 * 60_000 };

function toNum(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export async function GET(req) {
  const auth = await requireArbitrageAccess(req);
  if (!auth.ok) {
    const response = NextResponse.json(
      { ok: false, error: auth.error, reason: auth.reason },
      { status: auth.status }
    );
    clearArbitrageSessionCookie(response);
    return response;
  }

  const streamKey = auth.deviceId;
  const ip = getClientIp(req);
  const requestRateLimit = checkRateLimitByKey(streamKey, "arb-stream-start", STREAM_START_RATE_LIMIT_OPTS);
  if (requestRateLimit.limited) {
    console.warn(`[ArbStream] Rate limited device=${streamKey} ip=${ip}`);
    return NextResponse.json(
      { ok: false, error: "rate_limited", message: "Too many stream scans. Please wait and try again." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(requestRateLimit.resetMs / 1000)),
        },
      }
    );
  }

  const activeLimit = acquireConcurrentLimitByKey(streamKey, "arb-stream-active", STREAM_CONCURRENCY_OPTS);
  if (activeLimit.limited) {
    console.warn(`[ArbStream] Concurrent stream denied device=${streamKey} ip=${ip}`);
    return NextResponse.json(
      { ok: false, error: "stream_busy", message: "A stream is already running for this device." },
      { status: 429, headers: { "Retry-After": "10" } }
    );
  }

  let streamReleased = false;
  const releaseStreamSlot = () => {
    if (streamReleased) return;
    streamReleased = true;
    releaseConcurrentLimitByKey("arb-stream-active", streamKey);
  };

  const { searchParams } = new URL(req.url);
  
  const minArbPct = toNum(searchParams.get("minArbPct"), 0.1);
  const minSimilarity = Math.max(0.1, Math.min(1, toNum(searchParams.get("minSimilarity"), 0.35)));
  const priceMode = searchParams.get("priceMode") || "bids";
  const limit = Math.max(1, Math.min(500, Math.floor(toNum(searchParams.get("limit"), 100))));
  const scanMode = searchParams.get("scanMode") || "quick"; // "quick" = 100 markets, "full" = unlimited
  const platformA = searchParams.get("platformA") || "polymarket";
  const platformB = searchParams.get("platformB") || "opinion";

  // AbortController to propagate client disconnect into the scan engine
  const scanAbort = new AbortController();

  // If Next.js provides req.signal (client disconnect), forward it
  if (req.signal) {
    req.signal.addEventListener("abort", () => scanAbort.abort(), { once: true });
  }

  // Create a ReadableStream for SSE
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;

      // Safely enqueue data — guard against writing to a closed controller
      const send = (eventType, data) => {
        if (closed) return false;
        try {
          const message = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(message));
          return true;
        } catch {
          // Controller already closed (client disconnected)
          closed = true;
          scanAbort.abort(); // stop the engine too
          return false;
        }
      };

      // Heartbeat: send SSE comment every 15s to keep Render/Nginx proxy alive
      const heartbeat = setInterval(() => {
        if (closed) { clearInterval(heartbeat); return; }
        try {
          controller.enqueue(encoder.encode(":keepalive\n\n"));
        } catch {
          closed = true;
          clearInterval(heartbeat);
          scanAbort.abort();
        }
      }, 15_000);

      try {
        // Stream results as they come
        await streamArbitageOpportunities({
          minArbPct,
          minSimilarity,
          priceMode,
          limit,
          scanMode,
          platformA,
          platformB,
          signal: scanAbort.signal,
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
        if (!closed && err?.name !== "AbortError") {
          console.error("[SSE scan] Error:", err);
          send("error", { message: "Scan failed" });
        }
      } finally {
        clearInterval(heartbeat);
        releaseStreamSlot();
        if (!closed) {
          closed = true;
          try { controller.close(); } catch { /* already closed */ }
        }
      }
    },
    cancel() {
      // Called when client disconnects / stream is cancelled
      scanAbort.abort();
      releaseStreamSlot();
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
