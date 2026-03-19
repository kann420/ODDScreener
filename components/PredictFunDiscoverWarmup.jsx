"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const WARMUP_KEY = "__PF_DISCOVER_WARMUP_STARTED__";

function shouldSkipWarmup() {
  if (typeof navigator === "undefined") return false;
  if (navigator.connection?.saveData) return true;
  return false;
}

export default function PredictFunDiscoverWarmup() {
  const router = useRouter();

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    if (window[WARMUP_KEY]) return undefined;
    if (shouldSkipWarmup()) return undefined;

    window[WARMUP_KEY] = true;

    const warm = () => {
      router.prefetch("/predictfun");
      fetch("/api/predictfun/discover?warm=1", {
        method: "GET",
        cache: "no-store",
        keepalive: true,
      }).catch(() => {});
    };

    if ("requestIdleCallback" in window) {
      const idleId = window.requestIdleCallback(warm, { timeout: 2000 });
      return () => window.cancelIdleCallback(idleId);
    }

    const timer = window.setTimeout(warm, 1200);
    return () => window.clearTimeout(timer);
  }, [router]);

  return null;
}
