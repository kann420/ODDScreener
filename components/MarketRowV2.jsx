"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import MiniSparkline from "@/components/MiniSparkline";

import useInView from "@/components/hooks/useInView";
import { withConcurrency } from "@/lib/concurrency";
import { clientGet, clientSet } from "@/lib/clientCache";

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtUsdCompact(v) {
  const n = num(v);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  });
}

function fmtChanceFromPrice01(p01) {
  const pct = Math.max(0, Math.min(100, num(p01) * 100));
  const s = pct.toFixed(1).replace(/\.0$/, "");
  return `${s}%`;
}

function pickYesTokenId(m) {
  if (!m) return null;

  const direct =
    m.yesTokenId ??
    m.yes_token_id ??
    m.yesTokenID ??
    m.yes_tokenID ??
    m.outcomeYesTokenId ??
    m.outcome_yes_token_id ??
    m.tokenId ??
    m.token_id;

  if (direct) return String(direct);

  const nested =
    m?.yes?.token_id ??
    m?.yes?.tokenId ??
    m?.outcomes?.YES?.token_id ??
    m?.outcomes?.YES?.tokenId ??
    m?.outcomes?.yes?.token_id ??
    m?.outcomes?.yes?.tokenId;

  if (nested) return String(nested);

  const tokens =
    m?.tokens ??
    m?.token_list ??
    m?.tokenList ??
    m?.outcomeTokens ??
    m?.outcome_tokens ??
    null;

  if (Array.isArray(tokens) && tokens.length) {
    const yesLike =
      tokens.find((t) =>
        String(t?.outcome ?? t?.name ?? t?.label ?? "")
          .toLowerCase()
          .includes("yes")
      ) ?? null;

    const candidate = yesLike ?? tokens[0];
    const tid = candidate?.token_id ?? candidate?.tokenId ?? candidate?.id ?? null;
    if (tid) return String(tid);
  }

  return null;
}

function normalizeOrderbook(raw) {
  const root = raw?.result ?? raw ?? {};
  const rawBids = root?.bids ?? root?.buy ?? root?.bid ?? [];
  const rawAsks = root?.asks ?? root?.sell ?? root?.ask ?? [];

  const toRow = (r) => {
    if (Array.isArray(r) && r.length >= 2) {
      const a = num(r[0]);
      const b = num(r[1]);
      const aLooks = a >= 0 && a <= 1;
      const bLooks = b >= 0 && b <= 1;
      const price = aLooks ? a : bLooks ? b : a;
      return { price, shares: aLooks ? b : a };
    }
    if (r && typeof r === "object") {
      return {
        price: num(r.price ?? r.p ?? r.px),
        shares: num(r.shares ?? r.size ?? r.qty),
      };
    }
    return { price: 0, shares: 0 };
  };

  const bids = (Array.isArray(rawBids) ? rawBids : []).map(toRow).sort((a, b) => b.price - a.price);
  const asks = (Array.isArray(rawAsks) ? rawAsks : []).map(toRow).sort((a, b) => a.price - b.price);
  return { bids, asks };
}

function parseHistory(result) {
  const hist = result?.history || [];
  return hist
    .map((x) => ({ t: Number(x.t) * 1000, p: num(x.p) }))
    .filter((x) => x.t > 0)
    .sort((a, b) => a.t - b.t);
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJsonWithRetry(url, opts) {
  const r1 = await fetch(url, opts);
  const j1 = await r1.json();
  if (j1?.errno === 0) return j1;

  await sleep(900);
  const r2 = await fetch(url, opts);
  const j2 = await r2.json();
  return j2;
}

function getInflightMap() {
  const g = globalThis;
  if (!g.__ODD_INFLIGHT__) g.__ODD_INFLIGHT__ = new Map();
  return g.__ODD_INFLIGHT__;
}

async function fetchOnce(key, fn) {
  const inflight = getInflightMap();
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try {
      return await fn();
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

async function fetchOrderbookCached(tokenId) {
  const obKey = `ob:${tokenId}`;
  const cached = clientGet(obKey);
  if (cached) return cached;

  return fetchOnce(`inflight:${obKey}`, async () => {
    const obJson = await withConcurrency(
      () =>
        fetchJsonWithRetry(`/api/opinion/token/orderbook?token_id=${encodeURIComponent(tokenId)}`, {
          cache: "no-store",
        }),
      4
    );
    if (obJson?.errno !== 0) throw new Error("orderbook_failed");
    clientSet(obKey, obJson, 30_000);
    return obJson;
  });
}

async function fetchHistoryCached(tokenId, interval = "1d") {
  const phKey = `hist:${tokenId}:${interval}`;
  const cached = clientGet(phKey);
  if (cached) return cached;

  return fetchOnce(`inflight:${phKey}`, async () => {
    const phJson = await withConcurrency(
      () =>
        fetchJsonWithRetry(
          `/api/opinion/token/price-history?token_id=${encodeURIComponent(tokenId)}&interval=${interval}`,
          { cache: "no-store" }
        ),
      4
    );
    if (phJson?.errno !== 0) throw new Error("price_history_failed");
    clientSet(phKey, phJson, 30_000);
    return phJson;
  });
}

export default function MarketRowV2({ market, volMode, onOpen, priority = false, onChanceLoaded }) {
  const tokenId = useMemo(() => pickYesTokenId(market), [market]);
  const title = market?.title || "Market";

  const rowRef = useRef(null);
  const inView = useInView(rowRef, { root: null, rootMargin: "220px", threshold: 0.01 });

  const [loading, setLoading] = useState(false);
  const [rowErr, setRowErr] = useState("");

  const [mid, setMid] = useState(0);
  const [sparkPts, setSparkPts] = useState([]);

  const interval = "1d";

  const computeMidFromOrderbook = (obJson) => {
    const ob = normalizeOrderbook(obJson?.result ?? obJson);
    const bestBid = ob.bids?.[0]?.price ?? 0;
    const bestAsk = ob.asks?.[0]?.price ?? 0;
    return bestBid > 0 && bestAsk > 0
      ? (bestBid + bestAsk) / 2
      : bestBid > 0
        ? bestBid
        : bestAsk > 0
          ? bestAsk
          : 0;
  };

  const prefetch = useCallback(async () => {
    if (!tokenId) return;
    try {
      await Promise.all([fetchOrderbookCached(tokenId), fetchHistoryCached(tokenId, interval)]);
    } catch {
    }
  }, [tokenId]);

  useEffect(() => {
    let alive = true;

    async function load() {
      if (!inView && !priority) return;

      setLoading(true);
      setRowErr("");

      if (!tokenId) {
        setRowErr("missing_token");
        setLoading(false);
        return;
      }

      try {
        const [obJson, phJson] = await Promise.all([
          fetchOrderbookCached(tokenId),
          fetchHistoryCached(tokenId, interval),
        ]);

        if (!alive) return;

        const m = computeMidFromOrderbook(obJson);
        const pts = parseHistory(phJson?.result);

        setMid(m);
        setSparkPts((pts || []).slice(-90));
        setLoading(false);

        if (m > 0 && onChanceLoaded) {
          onChanceLoaded(market?.marketId, m);
        }
      } catch {
        if (!alive) return;
        setRowErr("fetch_failed");
        setLoading(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, [tokenId, inView, priority]);

  const chanceText = mid > 0 ? fmtChanceFromPrice01(mid) : "-";
  const volText = volMode === "24h" ? fmtUsdCompact(market?.volume24h) : fmtUsdCompact(market?.volume);

  return (
    <div
      ref={rowRef}
      className="panel"
      style={{ padding: "12px 12px", cursor: "pointer" }}
      onMouseEnter={() => {
        prefetch();
      }}
      onClick={() => {
        prefetch();
        onOpen?.(market);
      }}
      title="Open market"
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(320px, 1.6fr) 140px 110px 140px 130px",
          gap: 12,
          alignItems: "center",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontWeight: 900,
              lineHeight: 1.15,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {title}
          </div>

          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            {rowErr ? "" : ""}
          </div>
        </div>

        <div>
          {loading ? (
            <div className="skeleton skeleton-chart" style={{ width: 120, height: 32 }} />
          ) : (
            <MiniSparkline points={sparkPts} />
          )}
        </div>

        <div className="mono" style={{ fontWeight: 900 }}>
          {loading ? (
            <div className="skeleton skeleton-text" style={{ width: 50, height: 14 }} />
          ) : (
            chanceText
          )}
        </div>

        <div className="mono">{volText}</div>

        <div className="mono muted">—</div>
      </div>
    </div>
  );
}
