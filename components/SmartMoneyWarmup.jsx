"use client";
import { useEffect } from "react";

export default function SmartMoneyWarmup() {
  useEffect(() => {
    // Warm up the Smart Money hub (WS) without opening an SSE stream.
    fetch("/api/smart-money/stream?warm=1", { cache: "no-store" }).catch(() => {});
  }, []);

  return null;
}
