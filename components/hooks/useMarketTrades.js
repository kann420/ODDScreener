// components/hooks/useMarketTrades.js
// Client-side hook: subscribe to per-market trades via SSE (server proxies WebSocket)

import { useEffect, useMemo, useRef, useState } from "react";

const MAX_TRADES = 500;
const HYDRATE_LIMIT = 200;

// SSE endpoint (API key stays on server side)
const SSE_ENDPOINT = "/api/opinion/token/trades/stream";

function normalizeTrade(t) {
  const price = t?.price != null ? Number(t.price) : null;
  const shares = t?.shares != null ? Number(t.shares) : null;
  const amount = t?.amount != null ? Number(t.amount) : null;

  const tsVal = t?.ts ?? t?.timestamp;

  return {
    ...t,
    ts: tsVal != null ? Number(tsVal) : Date.now(),
    marketId: t?.marketId != null ? Number(t.marketId) : null,
    rootMarketId: t?.rootMarketId != null ? Number(t.rootMarketId) : null,
    outcomeSide: t?.outcomeSide != null ? Number(t.outcomeSide) : null,
    price,
    shares,
    amount,
  };
}

function tradeKey(t) {
  const x = normalizeTrade(t);
  return [x.ts, x.marketId, x.rootMarketId, x.tokenId, x.outcomeSide, x.side, x.price, x.shares, x.amount].join("|");
}

export function useMarketTrades(marketId) {
  const [trades, setTrades] = useState([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);

  const eventSourceRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttempts = useRef(0);

  const maxReconnectAttempts = 8;

  function cleanup() {
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
  }

  function scheduleReconnect(message) {
    reconnectAttempts.current += 1;
    if (reconnectAttempts.current > maxReconnectAttempts) {
      setError(message || "Failed to reconnect");
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 15000);
    reconnectTimeoutRef.current = setTimeout(() => {
      connect();
    }, delay);
  }

  function connect() {
    if (!marketId) return;

    const cur = eventSourceRef.current;
    if (cur && cur.readyState !== EventSource.CLOSED) return;

    cleanup();
    setError(null);

    const raw = String(marketId);
    let sseUrl;
    if (raw.startsWith("root:")) {
      const rid = Number(raw.replace("root:", ""));
      sseUrl = `${SSE_ENDPOINT}?rootMarketId=${rid}`;
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
      } catch {}
    });

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
      } catch {}
    });

    es.onerror = () => {
      setConnected(false);
      cleanup();
      scheduleReconnect("Connection lost");
    };
  }

  // hydrate from DB/api (optional usage elsewhere)
  async function hydrate() {
    try {
      const raw = String(marketId);
      const qs = raw.startsWith("root:")
        ? `rootMarketId=${encodeURIComponent(raw.replace("root:", ""))}`
        : `marketId=${encodeURIComponent(raw)}`;

      const r = await fetch(`/api/recent-trades/recent?${qs}&limit=${HYDRATE_LIMIT}`);
      const j = await r.json();
      const rows = Array.isArray(j?.rows) ? j.rows : [];
      const normalized = rows.map((x) => normalizeTrade(x));

      setTrades((prev) => {
        const map = new Map();
        for (const t of normalized) map.set(tradeKey(t), t);
        for (const t of prev) map.set(tradeKey(normalizeTrade(t)), normalizeTrade(t));
        const merged = Array.from(map.values()).sort((a, b) => (b.ts || 0) - (a.ts || 0));
        return merged.slice(0, MAX_TRADES);
      });
    } catch {}
  }

  useEffect(() => {
    if (!marketId) return;
    setTrades([]);
    hydrate();
    connect();
    return () => cleanup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketId]);

  const sorted = useMemo(() => {
    return [...trades].sort((a, b) => (Number(b.ts) || 0) - (Number(a.ts) || 0));
  }, [trades]);

  return { trades: sorted, connected, error };
}
