"use client";

import { useEffect, useRef, useState, useCallback } from "react";

const MAX_TRADES = 500;
const HYDRATE_LIMIT = 200;

// SSE endpoint - API key stays on server side, never exposed to client
const SSE_ENDPOINT = "/api/opinion/token/trades/stream";

function normalizeTrade(t) {
  // DB rows hoặc SSE msg đều đưa về shape thống nhất
  const price = t?.price != null ? Number(t.price) : null;
  const shares = t?.shares != null ? Number(t.shares) : null;
  const amount = t?.amount != null ? Number(t.amount) : null;

  return {
    ...t,
    ts: t?.ts ?? t?.timestamp != null ? Number(t.ts ?? t.timestamp) : Date.now(),
    marketId: t?.marketId != null ? Number(t.marketId) : null,
    rootMarketId: t?.rootMarketId != null ? Number(t.rootMarketId) : null,
    outcomeSide: t?.outcomeSide != null ? Number(t.outcomeSide) : null,
    price,
    shares,
    amount,
  };
}

// de-dupe by a simple fingerprint
function tradeKey(t) {
  return [
    t.ts,
    t.marketId ?? "",
    t.rootMarketId ?? "",
    t.tokenId ?? "",
    t.side ?? "",
    t.outcomeSide ?? "",
    t.price ?? "",
    t.shares ?? "",
    t.amount ?? "",
  ].join("|");
}

export default function useMarketTrades(marketId) {
  const [trades, setTrades] = useState([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);

  const eventSourceRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttempts = useRef(0);

  const maxReconnectAttempts = 8;

  const cleanup = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    const es = eventSourceRef.current;
    eventSourceRef.current = null;

    if (es) {
      try {
        es.close();
      } catch {}
    }

    setConnected(false);
  }, []);

  const scheduleReconnect = useCallback((reason) => {
    if (reconnectAttempts.current >= maxReconnectAttempts) {
      setError(reason || "Connection lost");
      return;
    }

    reconnectAttempts.current += 1;
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);

    reconnectTimeoutRef.current = setTimeout(() => {
      connect();
    }, delay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hydrateFromDb = useCallback(async () => {
    if (!marketId) return;

    try {
      let url = `/api/recent-trades/recent?limit=${HYDRATE_LIMIT}`;

      const raw = String(marketId);
      if (raw.startsWith("root:")) {
        const rid = Number(raw.replace("root:", ""));
        url += `&rootMarketId=${encodeURIComponent(String(rid))}`;
      } else {
        url += `&marketId=${encodeURIComponent(String(Number(raw)))}`;
      }

      const res = await fetch(url, { method: "GET" });
      if (!res.ok) return;

      const data = await res.json();
      const rows = Array.isArray(data?.rows) ? data.rows : [];

      if (rows.length === 0) return;

      const normalized = rows.map(normalizeTrade);

      // merge -> keep newest first, dedupe
      setTrades((prev) => {
        const map = new Map();
        for (const t of normalized) map.set(tradeKey(t), t);
        for (const t of prev) map.set(tradeKey(normalizeTrade(t)), normalizeTrade(t));

        const merged = Array.from(map.values()).sort((a, b) => (b.ts || 0) - (a.ts || 0));
        return merged.slice(0, MAX_TRADES);
      });
    } catch {
      // ignore hydrate errors
    }
  }, [marketId]);

  function connect() {
    if (!marketId) return;

    // avoid dev double-connect
    const cur = eventSourceRef.current;
    if (cur && cur.readyState !== EventSource.CLOSED) {
      return;
    }

    cleanup();
    setError(null);

    // Build SSE URL - no API key needed, it's handled server-side
    const raw = String(marketId);
    let sseUrl;
    if (raw.startsWith("root:")) {
      // For root markets, use the numeric rootMarketId
      const rid = Number(raw.replace("root:", ""));
      sseUrl = `${SSE_ENDPOINT}?marketId=${rid}`;
    } else {
      sseUrl = `${SSE_ENDPOINT}?marketId=${Number(raw)}`;
    }

    let es;
    try {
      es = new EventSource(sseUrl);
    } catch {
      setError("Failed to create SSE connection");
      return;
    }

    eventSourceRef.current = es;

    es.onopen = () => {
      setConnected(true);
      setError(null);
      reconnectAttempts.current = 0;
    };

    // Handle snapshot event (initial batch of trades)
    es.addEventListener("snapshot", (evt) => {
      try {
        const snapshot = JSON.parse(evt.data);
        if (!Array.isArray(snapshot)) return;

        const normalized = snapshot.map(normalizeTrade);

        setTrades((prev) => {
          const map = new Map();
          for (const t of normalized) map.set(tradeKey(t), t);
          for (const t of prev) map.set(tradeKey(normalizeTrade(t)), normalizeTrade(t));

          const merged = Array.from(map.values()).sort((a, b) => (b.ts || 0) - (a.ts || 0));
          return merged.slice(0, MAX_TRADES);
        });
      } catch {
        // ignore parse errors
      }
    });

    // Handle individual trade events
    es.addEventListener("trade", (evt) => {
      try {
        const tradeRaw = JSON.parse(evt.data);
        if (!tradeRaw || typeof tradeRaw !== "object") return;

        const trade = normalizeTrade(tradeRaw);

        const looksLikeTrade =
          trade?.price != null &&
          (trade?.shares != null || trade?.amount != null) &&
          (trade?.outcomeSide != null || trade?.tokenId != null);

        if (!looksLikeTrade) return;

        setTrades((prev) => {
          const map = new Map();
          map.set(tradeKey(trade), trade);
          for (const t of prev) map.set(tradeKey(normalizeTrade(t)), normalizeTrade(t));
          const merged = Array.from(map.values()).sort((a, b) => (b.ts || 0) - (a.ts || 0));
          return merged.slice(0, MAX_TRADES);
        });
      } catch {
        // ignore parse errors
      }
    });

    es.onerror = () => {
      setConnected(false);
      // EventSource auto-reconnects, but we handle it manually for better control
      cleanup();
      scheduleReconnect("Connection lost");
    };
  }

  // When marketId changes: clear -> hydrate -> connect SSE
  useEffect(() => {
    if (!marketId) return;

    setTrades([]);
    hydrateFromDb();
    connect();

    return () => cleanup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketId]);

  return { trades, connected, error };
}
