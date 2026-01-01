"use client";

import { useEffect, useMemo, useState } from "react";

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtPctFromPrice01(p01) {
  const pct = Math.max(0, Math.min(100, num(p01) * 100));
  const s = pct.toFixed(1).replace(/\.0$/, "");
  return `${s}%`;
}

function fmtCentsFromPrice01(p01) {
  const cents = num(p01) * 100;
  const s = cents.toFixed(1).replace(/\.0$/, "");
  return `${s}¢`;
}

function fmtUsd(v) {
  const n = num(v);
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function pickYesTokenId(m) {
  if (!m) return null;

  const direct =
    m.yesTokenId ??
    m.yes_token_id ??
    m.yesTokenID ??
    m.yes_tokenID ??
    m.yesOutcomeTokenId ??
    m.yes_outcome_token_id ??
    m.outcomeYesTokenId ??
    m.outcome_yes_token_id ??
    m.tokenId ??
    m.token_id;

  if (direct) return String(direct);

  const nested =
    m?.yes?.token_id ??
    m?.yes?.tokenId ??
    m?.YES?.token_id ??
    m?.YES?.tokenId ??
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
  const rawBids = root?.bids ?? root?.buy ?? root?.bid ?? root?.b ?? [];
  const rawAsks = root?.asks ?? root?.sell ?? root?.ask ?? root?.a ?? [];

  const coerce = (row) => {
    if (Array.isArray(row) && row.length >= 2) {
      const a = num(row[0]);
      const b = num(row[1]);
      const aLooks = a >= 0 && a <= 1;
      const bLooks = b >= 0 && b <= 1;
      let price = a,
        shares = b;
      if (!aLooks && bLooks) {
        price = b;
        shares = a;
      }
      return { price: num(price), shares: num(shares) };
    }
    if (row && typeof row === "object") {
      const price = row?.price ?? row?.p ?? row?.px ?? 0;
      const shares = row?.shares ?? row?.s ?? row?.size ?? row?.qty ?? 0;
      return { price: num(price), shares: num(shares) };
    }
    return { price: 0, shares: 0 };
  };

  const mapSide = (arr) =>
    (Array.isArray(arr) ? arr : []).map((r) => {
      const { price, shares } = coerce(r);
      return { price, shares, total: shares * price };
    });

  const bids = mapSide(rawBids).sort((a, b) => b.price - a.price);
  const asks = mapSide(rawAsks).sort((a, b) => a.price - b.price);
  return { bids, asks };
}

function sumTopN(side, N) {
  const arr = (Array.isArray(side) ? side : []).slice(0, N);
  let usd = 0;
  for (const r of arr) usd += num(r.total);
  return usd;
}

function parseHistory(result) {
  const hist = result?.history || [];
  return hist
    .map((x) => ({ t: Number(x.t) * 1000, p: num(x.p) }))
    .filter((x) => x.t > 0)
    .sort((a, b) => a.t - b.t);
}

function computeMovePct(pts, days) {
  if (!pts?.length) return null;
  const last = pts[pts.length - 1];
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  let first = pts[0];
  for (const p of pts) {
    if (p.t >= cutoff) {
      first = p;
      break;
    }
  }
  if (!first || !last || first.p === 0) return null;
  return ((last.p - first.p) / first.p) * 100;
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

export default function MarketRow({ market, onOpen, onMetrics }) {
  const { marketId, title } = market || {};
  const tokenId = useMemo(() => pickYesTokenId(market), [market]);

  const [loading, setLoading] = useState(true);
  const [rowErr, setRowErr] = useState("");

  const [mid, setMid] = useState(0);
  const [spreadCents, setSpreadCents] = useState(null);
  const [liqBid, setLiqBid] = useState(0);
  const [liqAsk, setLiqAsk] = useState(0);

  const [move24h, setMove24h] = useState(null);
  const [move7d, setMove7d] = useState(null);

  useEffect(() => {
    let alive = true;

    async function load() {
      setRowErr("");
      setLoading(true);

      if (!tokenId) {
        setRowErr("missing_token");
        setLoading(false);
        return;
      }

      await sleep(150 + Math.floor(Math.random() * 250));

      try {
        const obJson = await fetchJsonWithRetry(
          `/api/opinion/token/orderbook?token_id=${encodeURIComponent(tokenId)}`,
          { cache: "no-store" }
        );
        if (obJson?.errno !== 0) throw new Error(obJson?.errormsg || "orderbook_failed");
        const ob = normalizeOrderbook(obJson?.result ?? obJson);

        const bestBid = ob.bids?.[0]?.price ?? 0;
        const bestAsk = ob.asks?.[0]?.price ?? 0;

        const m =
          bestBid > 0 && bestAsk > 0
            ? (bestBid + bestAsk) / 2
            : bestBid > 0
              ? bestBid
              : bestAsk > 0
                ? bestAsk
                : 0;

        const sp =
          bestBid > 0 && bestAsk > 0 && bestAsk >= bestBid
            ? (bestAsk - bestBid) * 100
            : null;

        const TOP_N = 20;
        const bidUsd = sumTopN(ob.bids, TOP_N);
        const askUsd = sumTopN(ob.asks, TOP_N);

        const phJson = await fetchJsonWithRetry(
          `/api/opinion/token/price-history?token_id=${encodeURIComponent(tokenId)}&interval=1d`,
          { cache: "no-store" }
        );
        if (phJson?.errno !== 0) throw new Error(phJson?.errormsg || "price_history_failed");
        const pts = parseHistory(phJson?.result);

        const m24 = computeMovePct(pts, 1);
        const m7 = computeMovePct(pts, 7);

        if (!alive) return;

        setMid(m);
        setSpreadCents(sp);
        setLiqBid(bidUsd);
        setLiqAsk(askUsd);
        setMove24h(m24);
        setMove7d(m7);

        const chance = m > 0 ? m * 100 : null;
        onMetrics?.(marketId, {
          chance,
          spread: sp,
          liq: bidUsd + askUsd,
          move24h: m24,
          move7d: m7,
        });

        setLoading(false);
      } catch (e) {
        if (!alive) return;
        setRowErr("fetch_failed");
        setLoading(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, [tokenId, marketId, onMetrics]);

  const liqTotal = liqBid + liqAsk;
  const dashOrErr = rowErr ? "ERR" : "-";

  return (
    <div
      className="panel"
      style={{ padding: 12, cursor: "pointer" }}
      onClick={() => onOpen?.(market)}
      title="Open market"
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 260 }}>
          <div className="muted" style={{ fontSize: 12 }}>#{marketId ?? "-"}</div>
          <div style={{ fontWeight: 900, marginTop: 4 }}>{title || "Market"}</div>
        </div>

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Chance</div>
            <div className="mono" style={{ fontWeight: 900 }}>
              {mid > 0 ? fmtPctFromPrice01(mid) : dashOrErr}
            </div>
          </div>

          <div>
            <div className="muted" style={{ fontSize: 12 }}>Mid</div>
            <div className="mono">{mid > 0 ? fmtCentsFromPrice01(mid) : dashOrErr}</div>
          </div>

          <div>
            <div className="muted" style={{ fontSize: 12 }}>Spread</div>
            <div className="mono">
              {spreadCents == null ? dashOrErr : `${spreadCents.toFixed(1).replace(/\.0$/, "")}¢`}
            </div>
          </div>

          <div>
            <div className="muted" style={{ fontSize: 12 }}>Liquidity (Top20)</div>
            <div className="mono">{liqTotal > 0 ? fmtUsd(liqTotal) : dashOrErr}</div>
          </div>

          <div>
            <div className="muted" style={{ fontSize: 12 }}>Move 24h</div>
            <div className="mono">{move24h == null ? dashOrErr : `${move24h.toFixed(2)}%`}</div>
          </div>

          <div>
            <div className="muted" style={{ fontSize: 12 }}>Move 7d</div>
            <div className="mono">{move7d == null ? dashOrErr : `${move7d.toFixed(2)}%`}</div>
          </div>

          <div className="muted" style={{ fontSize: 12 }}>
            {loading ? "Loading…" : rowErr ? "Row error" : ""}
          </div>
        </div>
      </div>
    </div>
  );
}
