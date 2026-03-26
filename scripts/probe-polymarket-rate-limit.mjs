import dns from "dns";
import https from "https";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", override: false });
loadEnv({ path: ".env", override: false });

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value = ""] = arg.split("=");
    return [key, value];
  }),
);

const gammaRates = parseList(args.get("--gamma-rates") || "4000,5000");
const clobRates = parseList(args.get("--clob-rates") || "9000,10000");
const pageLimits = parseList(args.get("--page-limits") || "100,200,300,400,500");
const windowSec = Number(args.get("--window-sec") || 10);
const timeoutMs = Number(args.get("--timeout-ms") || 10000);
const maxInflight = Number(args.get("--max-inflight") || 512);
const warmupMs = Number(args.get("--warmup-ms") || 0);
const stopOn429 = String(args.get("--stop-on-429") || "1") !== "0";

const gammaPath = args.get("--gamma-path") || "/events";
const gammaQuery = args.get("--gamma-query") || "closed=false&offset=0";
const clobPath = args.get("--clob-path") || "/book";
const clobTokenId = args.get("--clob-token-id") || process.env.POLY_CLOB_TOKEN_ID || "";
const clobConditionId = args.get("--clob-condition-id") || process.env.POLY_CLOB_CONDITION_ID || "";
const clobSide = args.get("--clob-side") || "buy";

const gammaBase = (process.env.POLY_GAMMA_BASE || "https://gamma-api.polymarket.com").replace(/\/+$/, "");
const clobBase = (process.env.POLY_CLOB_BASE || "https://clob.polymarket.com").replace(/\/+$/, "");

if (!gammaRates.length) {
  console.error("[Probe] Missing gamma rates");
  process.exit(1);
}

if (!clobRates.length) {
  console.error("[Probe] Missing clob rates");
  process.exit(1);
}

const cloudflareResolver = new dns.Resolver();
cloudflareResolver.setServers(["1.1.1.1"]);
console.log("[Probe][DNS] Using Cloudflare DNS resolver: 1.1.1.1");
const dnsCache = new Map();
const DNS_CACHE_TTL = 300000;
const keepAliveAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 128,
  maxFreeSockets: 32,
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseList(raw) {
  return String(raw)
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value > 0);
}

async function resolveWithCloudflareDns(hostname) {
  const cached = dnsCache.get(hostname);
  if (cached && Date.now() < cached.exp) {
    return cached.ip;
  }

  return new Promise((resolve, reject) => {
    cloudflareResolver.resolve4(hostname, (err, addresses) => {
      if (err || !addresses?.length) {
        reject(err || new Error(`DNS resolution failed for ${hostname}`));
        return;
      }

      const ip = addresses[0];
      dnsCache.set(hostname, { ip, exp: Date.now() + DNS_CACHE_TTL });
      resolve(ip);
    });
  });
}

async function fetchJsonDirectIp(url, timeoutMs) {
  const urlObj = new URL(url);
  const ip = await resolveWithCloudflareDns(urlObj.hostname);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: ip,
        path: urlObj.pathname + urlObj.search,
        method: "GET",
        agent: keepAliveAgent,
        timeout: timeoutMs,
        headers: {
          Host: urlObj.hostname,
          Accept: "application/json",
          "Cache-Control": "no-store",
          Pragma: "no-cache",
          "User-Agent": "Mozilla/5.0",
        },
        servername: urlObj.hostname,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          let parsed = null;
          try {
            parsed = data ? JSON.parse(data) : null;
          } catch {
            parsed = data;
          }

          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            retryAfter: res.headers?.["retry-after"] || null,
            data: parsed,
          });
        });
      },
    );

    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });
    req.on("error", reject);
    req.end();
  });
}

function buildGammaUrl(pageLimit, requestIndex) {
  const url = new URL(`${gammaBase}${gammaPath}`);
  const baseParams = new URLSearchParams(gammaQuery);
  for (const [key, value] of baseParams.entries()) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("limit", String(pageLimit));
  url.searchParams.set("_t", `${Date.now()}-${requestIndex}`);
  return url.toString();
}

function buildClobUrl(requestIndex) {
  const needsTokenId = clobPath === "/book" || clobPath === "/price" || clobPath === "/midpoint";
  if (needsTokenId && !clobTokenId) {
    throw new Error("Missing CLOB token id. Pass --clob-token-id=<tokenId> or set POLY_CLOB_TOKEN_ID.");
  }
  const resolvedPath = clobPath
    .replace("{tokenId}", clobTokenId)
    .replace("{conditionId}", clobConditionId);
  const url = new URL(`${clobBase}${resolvedPath}`);
  if (needsTokenId) {
    url.searchParams.set("token_id", clobTokenId);
  }
  if (clobPath === "/price") {
    url.searchParams.set("side", clobSide);
  }
  url.searchParams.set("_t", `${Date.now()}-${requestIndex}`);
  return url.toString();
}

async function runScenario({ label, baseUrl, buildUrl, targetCount }) {
  const intervalMs = Math.max(1, Math.floor((windowSec * 1000) / targetCount));
  const startedAt = Date.now();
  let okCount = 0;
  let rateLimitedCount = 0;
  let otherFailureCount = 0;
  let first429 = null;
  let nextToSchedule = 1;
  const inflight = new Set();

  console.log("");
  console.log(`[Probe] Scenario: ${label}`);
  console.log(`[Probe] Base URL: ${baseUrl}`);
  console.log(`[Probe] Target req/10s: ${targetCount}`);
  console.log(`[Probe] Window sec: ${windowSec}`);
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

    if (result.index === 1 || result.index % 100 === 0 || result.status === 429 || result.status === "ERROR") {
      console.log(
        `[Probe] #${String(result.index).padStart(5, " ")} status=${result.status} latency=${result.latencyMs}ms retry-after=${result.retryAfter || "-"}`
      );
    }
  };

  const doRequest = async (index) => {
    const started = Date.now();
    try {
      const res = await fetchJsonDirectIp(buildUrl(index), timeoutMs);
      return {
        index,
        ok: res.ok,
        status: res.status,
        retryAfter: res.retryAfter,
        latencyMs: Date.now() - started,
        timestamp: Date.now(),
      };
    } catch (error) {
      return {
        index,
        ok: false,
        status: "ERROR",
        retryAfter: null,
        latencyMs: Date.now() - started,
        timestamp: Date.now(),
        error: error?.name === "AbortError" ? `Timeout after ${timeoutMs}ms` : String(error?.message || error),
      };
    }
  };

  while (nextToSchedule <= targetCount && (!first429 || !stopOn429)) {
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
    label,
    targetCount,
    okCount,
    rateLimitedCount,
    otherFailureCount,
    elapsedMs,
    first429Request: first429?.index || null,
    first429ElapsedMs: first429 ? first429.timestamp - startedAt : null,
    first429RetryAfter: first429?.retryAfter || null,
  };

  console.log("[Probe] Summary");
  console.log(JSON.stringify(summary, null, 2));

  return summary;
}

async function main() {
  console.log(`[Probe] Gamma base: ${gammaBase}`);
  console.log(`[Probe] CLOB base: ${clobBase}`);
  console.log(`[Probe] Window: ${windowSec}s`);
  console.log(`[Probe] Gamma rates: ${gammaRates.join(", ")}`);
  console.log(`[Probe] CLOB rates: ${clobRates.join(", ")}`);
  console.log(`[Probe] Page limits: ${pageLimits.join(", ")}`);
  console.log(`[Probe] CLOB path: ${clobPath}`);
  console.log(`[Probe] CLOB token id: ${clobTokenId.slice(0, 8)}...`);
  console.log(`[Probe] CLOB condition id: ${clobConditionId.slice(0, 8)}...`);

  if (warmupMs > 0) {
    console.log(`[Probe] Warmup: ${warmupMs}ms`);
    await sleep(warmupMs);
  }

  const results = [];

  for (const pageLimit of pageLimits) {
    for (const rate of gammaRates) {
      results.push(
        await runScenario({
          label: `gamma rate=${rate}/10s pageLimit=${pageLimit}`,
          baseUrl: gammaBase,
          targetCount: rate,
          buildUrl: (index) => buildGammaUrl(pageLimit, index),
        }),
      );
    }
  }

  for (const rate of clobRates) {
    results.push(
      await runScenario({
        label: `clob rate=${rate}/10s path=${clobPath}`,
        baseUrl: clobBase,
        targetCount: rate,
        buildUrl: (index) => buildClobUrl(index),
      }),
    );
  }

  const failed = results.filter((item) => item.first429Request !== null);
  console.log("");
  console.log("[Probe] Matrix complete");
  console.log(`scenarios=${results.length}`);
  console.log(`scenarios_with_429=${failed.length}`);
  console.log(`stop_on_429=${stopOn429 ? "yes" : "no"}`);

  process.exitCode = failed.length ? 2 : 0;
}

main().catch((error) => {
  console.error(`[Probe] Fatal: ${error?.stack || error?.message || error}`);
  process.exit(1);
});
