"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import LineChart from "./LineChart";

function fmtPct(p) {
  return `${p.toFixed(1)}%`;
}

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

const __CACHE__ =
  globalThis.__ODD_CLIENT_CACHE__ ?? (globalThis.__ODD_CLIENT_CACHE__ = new Map());

function cacheGetEntry(key, ttlMs) {
  const hit = __CACHE__.get(key);
  if (!hit) return null;
  if (!ttlMs) return hit;
  if (Date.now() - hit.t > ttlMs) return null;
  return hit;
}
function cacheSet(key, v) {
  __CACHE__.set(key, { t: Date.now(), v });
}

const RANGES = [
  { key: "1H", label: "1h", days: null, hours: 1 },
  { key: "6H", label: "6h", days: null, hours: 6 },
  { key: "1D", label: "1d", days: 1 },
  { key: "1W", label: "1w", days: 7 },
  { key: "ALL", label: "All", days: null },
];

export default function ChartView({ tokenId, outcome = "YES", mid, selectedCents, onOutcomeChange }) {
  const [range, setRange] = useState("1D");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [allPts, setAllPts] = useState([]);

  const [flipT, setFlipT] = useState(outcome === "NO" ? 1 : 0);
  const [isFlip3D, setIsFlip3D] = useState(false);
  const flipRef = useRef(flipT);

  const appliedCacheAtRef = useRef(0);
  const lastTokenIdRef = useRef(null);

  const interval = "1d";

  useEffect(() => {
    flipRef.current = flipT;
  }, [flipT]);

  useEffect(() => {
    const target = outcome === "NO" ? 1 : 0;
    const from = flipRef.current;
    const dur = 260; // ms
    const start = performance.now();
    let raf = null;

    const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

    const tick = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const e = easeInOut(t);
      setFlipT(from + (target - from) * e);
      if (t < 1) raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => raf && cancelAnimationFrame(raf);
  }, [outcome]);

  useEffect(() => {
    setIsFlip3D(true);
    const t = setTimeout(() => setIsFlip3D(false), 220);
    return () => clearTimeout(t);
  }, [outcome]);

  const pts = useMemo(() => {
    if (!Array.isArray(allPts) || allPts.length === 0) return [];
    const r = RANGES.find((x) => x.key === range);
    if (!r) return allPts;

    let cutoff;
    if (r.hours) {
      cutoff = Date.now() - r.hours * 60 * 60 * 1000;
    } else if (r.days) {
      cutoff = Date.now() - r.days * 24 * 60 * 60 * 1000;
    } else {
      return allPts; // ALL
    }

    const sliced = allPts.filter((x) => Number(x.t) >= cutoff);
    return sliced.length >= 2 ? sliced : allPts.slice(-Math.max(2, allPts.length));
  }, [allPts, range]);

  const displayPts = useMemo(() => {
    if (!pts || pts.length === 0) return [];
    return pts.map((pt) => {
      const v = clamp01(pt.p);
      const v2 = v * (1 - flipT) + (1 - v) * flipT;
      return { ...pt, p: clamp01(v2) };
    });
  }, [pts, flipT]);

  const lastPct = displayPts.length ? displayPts[displayPts.length - 1].p * 100 : 0;

  useEffect(() => {
    let mounted = true;
    const ac = new AbortController();

    if (lastTokenIdRef.current !== tokenId) {
      appliedCacheAtRef.current = 0;
      lastTokenIdRef.current = tokenId;
    }

    async function run() {
      if (!tokenId) {
        setAllPts([]);
        setErr("");
        setLoading(false);
        return;
      }

      const key = `ph:${tokenId}:${interval}`;

      const cachedEntry = cacheGetEntry(key, 30_000);
      if (cachedEntry) {
        if (cachedEntry.t > appliedCacheAtRef.current && mounted) {
          appliedCacheAtRef.current = cachedEntry.t;
          setAllPts(Array.isArray(cachedEntry.v) ? cachedEntry.v : []);
          setErr("");
          setLoading(false);
        } else if (mounted) {
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      setErr("");

      try {
        const res = await fetch(
          `/api/opinion/token/price-history?token_id=${encodeURIComponent(tokenId)}&interval=${encodeURIComponent(interval)}`,
          { cache: "no-store", signal: ac.signal }
        );
        const j = await res.json();
        if (j?.errno !== 0) throw new Error(j?.errormsg || "price_history_failed");

        const raw = j?.result ?? j;
        const rows = raw?.prices ?? raw?.history ?? raw?.data ?? raw ?? [];

        const out = (Array.isArray(rows) ? rows : [])
          .map((r) => {
            if (Array.isArray(r) && r.length >= 2) {
              const t = Number(r[0]);
              const p = Number(r[1]);
              return { t: t > 1e12 ? t : t * 1000, p: clamp01(p) };
            }
            if (r && typeof r === "object") {
              const tRaw = r.t ?? r.time ?? r.ts ?? r.timestamp ?? r.date ?? 0;
              const pRaw = r.p ?? r.price ?? r.value ?? r.y ?? 0;
              const tNum = Number(tRaw);
              const t = tNum > 1e12 ? tNum : tNum * 1000;
              const p = clamp01(Number(pRaw));
              return { t, p };
            }
            return null;
          })
          .filter(Boolean)
          .sort((a, b) => a.t - b.t);

        cacheSet(key, out);

        if (!mounted) return;
        setAllPts(Array.isArray(out) ? out : []);
        setLoading(false);
      } catch (e) {
        if (!mounted) return;
        if (e?.name === "AbortError" || String(e?.message || "").toLowerCase().includes("abort")) return;
        setErr(String(e?.message || e));
        setLoading(false);
      }
    }

    run();

    return () => {
      mounted = false;
      ac.abort();
    };
  }, [tokenId, interval]);

  const chartColor = outcome === "YES" ? "rgba(34,211,238,0.95)" : "rgba(168,85,247,0.95)";

  return (
    <div className="panel" style={{ padding: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              display: "inline-flex",
              border: "1px solid rgba(255,255,255,0.10)",
              background: "rgba(255,255,255,0.03)",
              borderRadius: 12,
              padding: 2,
              gap: 2,
            }}
          >
            <button
              className="btn"
              onClick={() => onOutcomeChange?.("YES")}
              style={{
                padding: "6px 10px",
                borderRadius: 10,
                opacity: outcome === "YES" ? 1 : 0.65,
                background: outcome === "YES" ? "rgba(34,211,238,0.18)" : "transparent",
                border: outcome === "YES" ? "1px solid rgba(34,211,238,0.30)" : "1px solid transparent",
              }}
            >
              YES
            </button>
            <button
              className="btn"
              onClick={() => onOutcomeChange?.("NO")}
              style={{
                padding: "6px 10px",
                borderRadius: 10,
                opacity: outcome === "NO" ? 1 : 0.65,
                background: outcome === "NO" ? "rgba(168,85,247,0.16)" : "transparent",
                border: outcome === "NO" ? "1px solid rgba(168,85,247,0.28)" : "1px solid transparent",
              }}
            >
              NO
            </button>
          </div>

          <div
            style={{
              fontSize: 22,
              fontWeight: 900,
              color: outcome === "YES" ? "rgba(34,211,238,0.95)" : "rgba(168,85,247,0.95)",
            }}
          >
            {loading ? (
              <div className="skeleton" style={{ width: 120, height: 26, borderRadius: 6 }} />
            ) : (
              `${fmtPct(lastPct)} CHANCE`
            )}
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className="tag">
            <span className="dot"></span>LIVE
          </span>
        </div>
      </div>

      <div style={{ marginTop: 8 }}>
        <div
          style={{
            height: 340,
            transformOrigin: "50% 50%",
            transform: isFlip3D ? "perspective(900px) rotateX(10deg) scale(0.995)" : "perspective(900px) rotateX(0deg) scale(1)",
            transition: "transform 220ms ease",
            willChange: "transform",
            filter: isFlip3D ? "saturate(1.06)" : "none",
          }}
        >
          {loading && displayPts.length === 0 ? (
            <div className="skeleton" style={{ width: "100%", height: "100%", borderRadius: 12 }} />
          ) : (
            <LineChart pts={displayPts} color={chartColor} range={range} selectedCents={selectedCents} />
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
        {RANGES.map((r) => (
          <button key={r.key} className="btn" onClick={() => setRange(r.key)} style={{ opacity: range === r.key ? 1 : 0.65 }}>
            {r.label}
          </button>
        ))}
        <div className="spacer" />
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
        <div style={{ display: "flex", gap: 12, color: "rgba(148,163,184,0.95)", fontSize: 12 }}>
          <div>
            Volume: <span style={{ color: "rgba(34,197,94,0.95)", fontWeight: 900 }}>-</span>
          </div>
          <div>
            Last:{" "}
            <span style={{ color: chartColor, fontWeight: 900 }}>{displayPts.length ? (displayPts[displayPts.length - 1]?.p ?? 0).toFixed(2) : "-"}</span>
          </div>
        </div>
      </div>

      {err && (
        <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          Error: {err}
        </div>
      )}
    </div>
  );
}
