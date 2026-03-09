import { NextResponse } from "next/server";
import {
  acquireConcurrentLimitByKey,
  checkRateLimit,
  checkRateLimitByKey,
  getClientIp,
  releaseConcurrentLimitByKey,
} from "@/lib/apiRateLimit";

function getPathname(request) {
  try {
    return new URL(request.url).pathname;
  } catch {
    return request.url || "unknown";
  }
}

function buildRateLimitResponse({ message, retryAfterSec, error = "rate_limited" }) {
  return NextResponse.json(
    { ok: false, error, message },
    {
      status: 429,
      headers: {
        "Retry-After": String(Math.max(1, Math.ceil(retryAfterSec || 1))),
      },
    }
  );
}

export function enforceIpRateLimit(
  request,
  name,
  opts,
  message = "Too many requests. Please try again later."
) {
  const rl = checkRateLimit(request, name, opts);
  if (!rl.limited) return null;

  const ip = getClientIp(request);
  console.warn(`[RateLimit] ${name} path=${getPathname(request)} ip=${ip}`);

  return buildRateLimitResponse({
    message,
    retryAfterSec: rl.resetMs / 1000,
  });
}

export function enforceKeyRateLimit(
  request,
  key,
  name,
  opts,
  message = "Too many requests. Please try again later."
) {
  const rl = checkRateLimitByKey(key, name, opts);
  if (!rl.limited) return null;

  const ip = getClientIp(request);
  console.warn(`[RateLimit] ${name} path=${getPathname(request)} key=${key} ip=${ip}`);

  return buildRateLimitResponse({
    message,
    retryAfterSec: rl.resetMs / 1000,
  });
}

export function acquireIpSseLimit(
  request,
  name,
  startOpts,
  concurrentOpts,
  {
    rateLimitMessage = "Too many stream requests. Please wait and try again.",
    busyMessage = "Too many active streams. Please close another tab and try again.",
  } = {}
) {
  const key = getClientIp(request);
  const startLimit = checkRateLimitByKey(key, `${name}:start`, startOpts);
  if (startLimit.limited) {
    console.warn(`[RateLimit] ${name}:start path=${getPathname(request)} ip=${key}`);
    return {
      response: buildRateLimitResponse({
        message: rateLimitMessage,
        retryAfterSec: startLimit.resetMs / 1000,
      }),
      release: () => {},
    };
  }

  const activeLimit = acquireConcurrentLimitByKey(key, `${name}:active`, concurrentOpts);
  if (activeLimit.limited) {
    console.warn(`[RateLimit] ${name}:active path=${getPathname(request)} ip=${key}`);
    return {
      response: buildRateLimitResponse({
        message: busyMessage,
        retryAfterSec: 10,
        error: "stream_busy",
      }),
      release: () => {},
    };
  }

  let released = false;
  return {
    response: null,
    release() {
      if (released) return;
      released = true;
      releaseConcurrentLimitByKey(`${name}:active`, key);
    },
  };
}
