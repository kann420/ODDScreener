import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", override: false });
loadEnv({ path: ".env", override: false });

const baseUrl = process.env.PREDICTFUN_BASE_URL || "https://api.predict.fun";
const apiKey = process.env.PREDICTFUN_API_KEY || "";

if (!apiKey) {
  console.error("[Probe] Missing PREDICTFUN_API_KEY");
  process.exit(1);
}

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value = ""] = arg.split("=");
    return [key, value];
  }),
);

const rpm = Number(args.get("--rpm") || 500);
const totalRequests = Number(args.get("--total") || Math.ceil((rpm / 60) * 62));
const path = args.get("--path") || "/v1/markets?first=1&status=OPEN";
const warmupMs = Number(args.get("--warmup-ms") || 0);
const timeoutMs = Number(args.get("--timeout-ms") || 10000);
const intervalMs = Math.ceil(60000 / rpm);
const maxInflight = Number(args.get("--max-inflight") || 12);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function doRequest(index) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const res = await fetch(new URL(path, baseUrl), {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        accept: "application/json",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    return {
      index,
      ok: res.ok,
      status: res.status,
      retryAfter: res.headers.get("retry-after"),
      latencyMs: Date.now() - startedAt,
      timestamp: Date.now(),
    };
  } catch (error) {
    return {
      index,
      ok: false,
      status: "ERROR",
      retryAfter: null,
      latencyMs: Date.now() - startedAt,
      timestamp: Date.now(),
      error: error?.name === "AbortError" ? `Timeout after ${timeoutMs}ms` : String(error?.message || error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  console.log(`[Probe] Base URL: ${baseUrl}`);
  console.log(`[Probe] Path: ${path}`);
  console.log(`[Probe] Target RPM: ${rpm}`);
  console.log(`[Probe] Total requests: ${totalRequests}`);
  console.log(`[Probe] Interval: ${intervalMs}ms`);
  console.log(`[Probe] Max inflight: ${maxInflight}`);

  if (warmupMs > 0) {
    console.log(`[Probe] Warmup: ${warmupMs}ms`);
    await sleep(warmupMs);
  }

  const startedAt = Date.now();
  let okCount = 0;
  let rateLimitedCount = 0;
  let otherFailureCount = 0;
  let first429 = null;
  let sample429 = null;
  let nextToSchedule = 1;
  const inflight = new Set();

  const handleResult = (result) => {
    if (result.status === 429) {
      rateLimitedCount++;
      first429 ||= result;
      sample429 ||= result;
    } else if (result.ok) {
      okCount++;
    } else {
      otherFailureCount++;
    }

    if (result.index === 1 || result.index % 25 === 0 || result.status === 429 || result.status === "ERROR") {
      console.log(
        `[Probe] #${String(result.index).padStart(4, " ")} status=${result.status} latency=${result.latencyMs}ms retry-after=${result.retryAfter || "-"}`
      );
    }
  };

  while (nextToSchedule <= totalRequests && !first429) {
    while (inflight.size >= maxInflight) {
      await Promise.race(inflight);
    }

    const targetAt = startedAt + (nextToSchedule - 1) * intervalMs;
    const waitMs = targetAt - Date.now();
    if (waitMs > 0) {
      await sleep(waitMs);
    }

    const index = nextToSchedule++;
    const requestPromise = doRequest(index)
      .then((result) => {
        handleResult(result);
        return result;
      })
      .finally(() => {
        inflight.delete(requestPromise);
      });

    inflight.add(requestPromise);
  }

  while (inflight.size > 0) {
    await Promise.race(inflight);
    if (first429) {
      break;
    }
  }

  const elapsedMs = Date.now() - startedAt;
  console.log("");
  console.log("[Probe] Summary");
  console.log(`ok=${okCount}`);
  console.log(`rate_limited=${rateLimitedCount}`);
  console.log(`other_failures=${otherFailureCount}`);
  console.log(`elapsed_ms=${elapsedMs}`);

  if (first429) {
    console.log(`first_429_request=${first429.index}`);
    console.log(`first_429_elapsed_ms=${first429.timestamp - startedAt}`);
    console.log(`first_429_retry_after=${first429.retryAfter || "-"}`);
    console.log("[Probe] Result: threshold is below requested RPM");
    process.exitCode = 2;
    return;
  }

  const achievedRpm = Math.floor((okCount * 60000) / Math.max(elapsedMs, 1));
  console.log(`achieved_rpm=${achievedRpm}`);
  console.log("[Probe] Result: no 429 seen during this probe window");
}

main().catch((error) => {
  console.error(`[Probe] Fatal: ${error?.stack || error?.message || error}`);
  process.exit(1);
});
