"use client";

import { useEffect, useMemo, useRef, useState } from "react";

function fmtDate(ts) {
  const d = new Date(ts);
  return d.toISOString().slice(0, 10);
}

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function fmtCentsFromPrice01(p) {
  const cents = clamp01(p) * 100;
  const s = cents.toFixed(1).replace(/\.0$/, "");
  return `${s}¢`;
}

const __CACHE__ =
  globalThis.__ODD_CLIENT_CACHE__ ?? (globalThis.__ODD_CLIENT_CACHE__ = new Map());
const __INFLIGHT__ =
  globalThis.__ODD_CLIENT_INFLIGHT__ ?? (globalThis.__ODD_CLIENT_INFLIGHT__ = new Map());

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
  { key: "1H", days: 1 }, // daily history => best-effort
  { key: "6H", days: 1 },
  { key: "12H", days: 1 },
  { key: "1D", days: 1 },
  { key: "1W", days: 7 },
  { key: "ALL", days: null },
];

export default function ChartView({ tokenId, mid, selectedCents }) {
  const [range, setRange] = useState("1W");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [allPts, setAllPts] = useState([]);
  const [hover, setHover] = useState(null);

  const wrapRef = useRef(null);
  const canvasRef = useRef(null);

  const rafRef = useRef(0);
  const lastMoveRef = useRef(null);

  const appliedCacheAtRef = useRef(0);
  const lastTokenIdRef = useRef(null);

  const interval = "1d";

  const pts = useMemo(() => {
    if (!Array.isArray(allPts) || allPts.length === 0) return [];
    const r = RANGES.find((x) => x.key === range);
    if (!r || !r.days) return allPts;

    const cutoff = Date.now() - r.days * 24 * 60 * 60 * 1000;
    const sliced = allPts.filter((x) => Number(x.t) >= cutoff);
    return sliced.length >= 2 ? sliced : allPts.slice(-Math.max(2, allPts.length));
  }, [allPts, range]);

  const last = pts.length ? pts[pts.length - 1] : null;

  const changePct = useMemo(() => {
    if (pts.length < 2) return null;
    const a = pts[0]?.p;
    const b = pts[pts.length - 1]?.p;
    if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0) return null;
    return ((b - a) / a) * 100;
  }, [pts]);

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
        if (e?.name === 'AbortError' || String(e?.message || '').toLowerCase().includes('abort')) return;
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

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const w = Math.max(320, Math.floor(wrap.clientWidth));
    const h = 250;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.height = `${h}px`;

    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.clearRect(0, 0, w, h);

    const padX = 16;
    const padY = 18;
    const plotW = w - padX * 2;
    const plotH = h - padY * 2;

    const data = pts.length ? pts : [{ t: Date.now(), p: 0.5 }, { t: Date.now(), p: 0.5 }];

    const min = Math.min(...data.map((x) => x.p));
    const max = Math.max(...data.map((x) => x.p));
    const span = Math.max(1e-6, max - min);

    function yOf(p) {
      const n = (p - min) / span;
      return padY + (1 - n) * plotH;
    }

    const xStep = plotW / Math.max(1, data.length - 1);

    const up = data[data.length - 1].p >= data[0].p;
    ctx.strokeStyle = up ? "rgba(52, 211, 153, 0.95)" : "rgba(248, 113, 113, 0.95)";
    ctx.fillStyle = up ? "rgba(52, 211, 153, 0.08)" : "rgba(248, 113, 113, 0.08)";

    ctx.beginPath();
    data.forEach((x, i) => {
      const xx = padX + i * xStep;
      const yy = yOf(x.p);
      if (i === 0) ctx.moveTo(xx, yy);
      else ctx.lineTo(xx, yy);
    });
    ctx.lineTo(padX + plotW, padY + plotH);
    ctx.lineTo(padX, padY + plotH);
    ctx.closePath();
    ctx.fill();

    ctx.lineWidth = 2.2;
    ctx.beginPath();
    data.forEach((x, i) => {
      const xx = padX + i * xStep;
      const yy = yOf(x.p);
      if (i === 0) ctx.moveTo(xx, yy);
      else ctx.lineTo(xx, yy);
    });
    ctx.stroke();

    if (Number.isFinite(selectedCents) && selectedCents > 0) {
      const selP = clamp01(selectedCents / 100);
      const ySel = yOf(selP);

      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = "rgba(255,255,255,0.65)";
      ctx.beginPath();
      ctx.moveTo(padX, ySel);
      ctx.lineTo(padX + plotW, ySel);
      ctx.stroke();

      ctx.globalAlpha = 0.95;
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
      ctx.fillText(
        `SEL ${String(selectedCents.toFixed(1)).replace(/\.0$/, "")}¢`,
        padX + 6,
        Math.max(14, ySel - 6)
      );
      ctx.restore();
    }

    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
    ctx.fillText(fmtCentsFromPrice01(max), padX, 12);
    ctx.fillText(fmtCentsFromPrice01(min), padX, h - 4);

    if (hover && Number.isFinite(hover.i) && data[hover.i]) {
      const i = hover.i;
      const xx = padX + i * xStep;
      const yy = yOf(data[i].p);

      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(xx, padY);
      ctx.lineTo(xx, padY + plotH);
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.beginPath();
      ctx.arc(xx, yy, 3.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [pts, hover, mid, selectedCents]);

  const tooltipPos = useMemo(() => {
    if (!hover) return null;
    const pad = 10;
    const left = Math.min(window.innerWidth - 230, hover.x + pad);
    const top = Math.max(10, hover.y - 70);
    return { left, top };
  }, [hover]);

  function onMove(e) {
    if (!wrapRef.current || !pts.length) return;
    lastMoveRef.current = { x: e.clientX, y: e.clientY };

    if (rafRef.current) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = 0;
      const wrap = wrapRef.current;
      if (!wrap || !pts.length || !lastMoveRef.current) return;

      const rect = wrap.getBoundingClientRect();
      const x = lastMoveRef.current.x - rect.left;

      const padX = 16;
      const plotW = rect.width - padX * 2;
      const step = plotW / Math.max(1, pts.length - 1);
      const i = Math.max(0, Math.min(pts.length - 1, Math.round((x - padX) / step)));

      setHover({
        i,
        t: pts[i].t,
        p: pts[i].p,
        x: lastMoveRef.current.x,
        y: lastMoveRef.current.y,
      });
    });
  }

  function onLeave() {
    setHover(null);
  }

  return (
    <div className="panel" style={{ padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 900 }}>Price Chart</div>

          <div className="muted" style={{ fontSize: 12, marginTop: 4, display: "flex", alignItems: "center", gap: 6 }}>
            {loading ? (
              <>
                <div className="skeleton" style={{ width: 100, height: 12, borderRadius: 4 }} />
              </>
            ) : err ? (
              `Error: ${err}`
            ) : last ? (
              <>
                Last: {fmtCentsFromPrice01(last.p)}
                {changePct != null && (
                  <>
                    {" "}· Change: <span className="mono">{changePct.toFixed(2)}%</span>
                  </>
                )}
              </>
            ) : (
              "No data"
            )}
          </div>
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {RANGES.map((r) => (
            <button key={r.key} className={range === r.key ? "btn" : "btn ghost"} onClick={() => setRange(r.key)}>
              {r.key}
            </button>
          ))}
          <div className="muted" style={{ fontSize: 12, marginLeft: 10 }}>
            Interval: <span className="mono">{interval}</span>
          </div>
        </div>
      </div>

      <div ref={wrapRef} style={{ marginTop: 10, position: "relative" }} onMouseMove={onMove} onMouseLeave={onLeave}>
        {loading && pts.length === 0 ? (
          <div 
            className="skeleton" 
            style={{ 
              width: "100%", 
              height: 250, 
              borderRadius: 12,
            }} 
          />
        ) : (
          <canvas ref={canvasRef} style={{ width: "100%", borderRadius: 12 }} />
        )}

        {hover && tooltipPos ? (
          <div
            className="panel"
            style={{
              position: "fixed",
              left: tooltipPos.left,
              top: tooltipPos.top,
              padding: "8px 10px",
              fontSize: 12,
              pointerEvents: "none",
              zIndex: 9999,
              maxWidth: 220,
              backdropFilter: "blur(8px)",
            }}
          >
            <div className="mono">{fmtDate(hover.t)}</div>
            <div style={{ marginTop: 4 }}>
              Price: <span className="mono">{fmtCentsFromPrice01(hover.p)}</span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}