import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", override: false });
loadEnv({ path: ".env", override: false });

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value = ""] = arg.split("=");
    return [key, value];
  }),
);

const baseUrl = (process.env.OPINION_BASE_URL || process.env.OPINION_OPENAPI_BASE || "https://proxy.opinion.trade:8443/openapi").replace(/\/+$/, "");
const apiKey = process.env.OPINION_API_KEY || process.env.OPINION_WS_KEY || "";

const startRps = Number(args.get("--start-rps") || 15);
const stepRps = Number(args.get("--step-rps") || 5);
const maxRps = Number(args.get("--max-rps") || 120);
const stageSec = Number(args.get("--stage-sec") || 10);
const timeoutMs = Number(args.get("--timeout-ms") || 10000);
const maxInflight = Number(args.get("--max-inflight") || 64);
const stopOn429 = String(args.get("--stop-on-429") || "1") !== "0";
const warmupMs = Number(args.get("--warmup-ms") || 0);

const path = args.get("--path") || "/market?status=activated&sortBy=5&limit=1&page=1&marketType=2";
const wallet = args.get("--wallet") || "";
const chainId = args.get("--chain-id") || "56";
const page = args.get("--page") || "1";
const limit = args.get("--limit") || "1";

if (!apiKey) {
  console.error("[Probe] Missing OPINION_API_KEY in .env.local");
  process.exit(1);
}

if (startRps <= 0 || stepRps <= 0 || maxRps < startRps || stageSec <= 0) {
  console.error("[Probe] Invalid numeric arguments");
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildRequestUrl(index) {
  if (wallet) {
    const url = new URL(`${baseUrl}/trade/user/${wallet}`);
    url.searchParams.set("chainId", chainId);
    url.searchParams.set("page", page);
    url.searchParams.set("limit", limit);
    url.searchParams.set("_t", `${Date.now()}-${index}`);
    return url;
  }

  const url = new URL(path, baseUrl);
  url.searchParams.set("_t", `${Date.now()}-${index}`);
  return url;
}

async function doRequest(index) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const url = buildRequestUrl(index);

    const res = await fetch(url, {
      method: "GET",
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${apiKey}`,
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

async function runStage(rps) {
  const intervalMs = Math.max(1, Math.floor(1000 / rps));
  const totalRequests = Math.max(1, Math.ceil((stageSec * 1000) / intervalMs));
  const startedAt = Date.now();
  let okCount = 0;
  let rateLimitedCount = 0;
  let otherFailureCount = 0;
  let first429 = null;
  let nextToSchedule = 1;
  const inflight = new Set();

  console.log("");
  console.log(`[Probe] Stage rps=${rps}`);
  console.log(`[Probe] Path: ${wallet ? `/trade/user/${wallet}` : path}`);
  console.log(`[Probe] Duration: ${stageSec}s`);
  console.log(`[Probe] Planned requests: ${totalRequests}`);
  console.log(`[Probe] Interval: ${intervalMs}ms`);
  console.log(`[Probe] Max inflight: ${maxInflight}`);

  const handleResult = (result) => {
    if (result.status === 429) {
      rateLimitedCount++;
      first429 ||= result;
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

  while (nextToSchedule <= totalRequests && (!first429 || !stopOn429)) {
    while (inflight.size >= maxInflight) {
      await Promise.race(inflight);
      if (first429 && stopOn429) break;
    }

    if (first429 && stopOn429) break;

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
  }

  const elapsedMs = Date.now() - startedAt;
  const summary = {
    rps,
    totalRequests,
    okCount,
    rateLimitedCount,
    otherFailureCount,
    elapsedMs,
    first429Request: first429?.index || null,
    first429ElapsedMs: first429 ? first429.timestamp - startedAt : null,
    first429RetryAfter: first429?.retryAfter || null,
  };

  console.log("[Probe] Stage summary");
  console.log(JSON.stringify(summary, null, 2));

  return summary;
}

async function main() {
  console.log(`[Probe] Base URL: ${baseUrl}`);
  console.log(`[Probe] Path: ${wallet ? `/trade/user/${wallet}` : path}`);
  if (wallet) {
    console.log(`[Probe] Wallet mode: yes`);
    console.log(`[Probe] chainId=${chainId} page=${page} limit=${limit}`);
  }
  console.log(`[Probe] Start RPS: ${startRps}`);
  console.log(`[Probe] Step RPS: ${stepRps}`);
  console.log(`[Probe] Max RPS: ${maxRps}`);
  console.log(`[Probe] Duration per stage: ${stageSec}s`);

  if (warmupMs > 0) {
    console.log(`[Probe] Warmup: ${warmupMs}ms`);
    await sleep(warmupMs);
  }

  const results = [];
  for (let rps = startRps; rps <= maxRps; rps += stepRps) {
    const summary = await runStage(rps);
    results.push(summary);

    if (summary.first429Request !== null) {
      console.log("");
      console.log("[Probe] Rate limit detected, stopping.");
      break;
    }
  }

  const hit429 = results.find((item) => item.first429Request !== null) || null;
  console.log("");
  console.log("[Probe] Overall summary");
  console.log(`stages=${results.length}`);
  console.log(`hit_429=${hit429 ? "yes" : "no"}`);
  if (hit429) {
    console.log(`threshold_stage_rps=${hit429.rps}`);
    console.log(`first_429_request=${hit429.first429Request}`);
    console.log(`first_429_elapsed_ms=${hit429.first429ElapsedMs}`);
    console.log(`first_429_retry_after=${hit429.first429RetryAfter || "-"}`);
    process.exitCode = 2;
    return;
  }

  console.log("result=no_429_seen");
}

main().catch((error) => {
  console.error(`[Probe] Fatal: ${error?.stack || error?.message || error}`);
  process.exit(1);
});
