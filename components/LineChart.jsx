"use client";

import { useMemo, useState } from "react";

function fmt(n) {
  if (n === null || n === undefined) return "-";
  const num = Number(n);
  if (Number.isNaN(num)) return String(n);
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + "M";
  if (num >= 1_000) return (num / 1_000).toFixed(1) + "K";
  return num.toFixed(0);
}

function fmtPct(p) {
  return `${p.toFixed(1)}%`;
}

const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatTime12Hour(d) {
  let hours = d.getHours();
  const ampm = hours >= 12 ? "pm" : "am";
  hours = hours % 12;
  hours = hours ? hours : 12;
  const minutes = d.getMinutes().toString().padStart(2, "0");
  return { hours, minutes, ampm };
}

function formatTooltipLabel(ms) {
  const d = new Date(ms);
  const { hours, minutes, ampm } = formatTime12Hour(d);
  const month = monthNames[d.getMonth()];
  const day = d.getDate();
  const year = d.getFullYear();
  return `${hours}:${minutes}${ampm}, ${month} ${day}, ${year}`;
}

function formatXAxisLabel(ms, range) {
  const d = new Date(ms);
  if (range === "1H" || range === "6H" || range === "1D") {
    const { hours, minutes, ampm } = formatTime12Hour(d);
    return `${hours}:${minutes}${ampm}`;
  } else {
    const month = monthNames[d.getMonth()];
    const day = d.getDate();
    return `${month} ${day}`;
  }
}

export default function LineChart({ pts, color = "rgba(34,211,238,0.95)", range = "1D", selectedCents }) {
  const [hoverIdx, setHoverIdx] = useState(null);

  const w = 980,
    h = 320;
  const padL = 36,
    padR = 46,
    padT = 16,
    padB = 30;

  const N = 160;

  const sampled = useMemo(() => {
    if (!pts || pts.length === 0) return [];
    const out = [];
    const L = pts.length;
    for (let i = 0; i < N; i++) {
      const idx = Math.round((i / (N - 1)) * (L - 1));
      out.push(pts[idx]);
    }
    return out;
  }, [pts]);

  const getXAxisTicks = useMemo(() => {
    if (!sampled || sampled.length === 0) return [];
    const numTicks = 5;
    const ticks = [];
    for (let i = 0; i < numTicks; i++) {
      const idx = Math.round((i / (numTicks - 1)) * (sampled.length - 1));
      const pt = sampled[idx];
      if (pt) {
        ticks.push({
          idx,
          timestamp: pt.t,
          label: formatXAxisLabel(pt.t, range),
        });
      }
    }
    return ticks;
  }, [sampled, range]);

  const closes = useMemo(() => sampled.map((c) => c.p), [sampled]);
  const min = useMemo(() => (closes.length ? Math.min(...closes) : 0), [closes]);
  const max = useMemo(() => (closes.length ? Math.max(...closes) : 1), [closes]);

  const x = (i) => padL + (i / (N - 1)) * (w - padL - padR);
  const y = (p) => {
    const t = (p - min) / (max - min || 1);
    return h - padB - t * (h - padT - padB);
  };

  const chartPts = useMemo(() => {
    return sampled.map((c, i) => ({ x: x(i), y: y(c.p), t: c.t, v: c.p }));
  }, [sampled, min, max]);

  const linePath = chartPts.length
    ? chartPts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ")
    : "";

  const areaPath = chartPts.length
    ? linePath + ` L ${(w - padR).toFixed(2)} ${(h - padB).toFixed(2)}` + ` L ${padL.toFixed(2)} ${(h - padB).toFixed(2)} Z`
    : "";

  const levels = 4;
  const grid = Array.from({ length: levels + 1 }).map((_, i) => {
    const yy = padT + (i / levels) * (h - padT - padB);
    const val = (max - (i / levels) * (max - min)) * 100;
    return { yy, val };
  });

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const innerW = w - padL - padR;
    const t = Math.max(0, Math.min(1, (px - (padL / w) * rect.width) / ((innerW / w) * rect.width)));
    const idx = Math.round(t * (N - 1));
    setHoverIdx(idx);
  };

  const onLeave = () => setHoverIdx(null);

  const hi = hoverIdx !== null ? hoverIdx : N - 1;
  const hv = chartPts[hi] || chartPts[chartPts.length - 1];

  const hx = hv?.x ?? x(N - 1);
  const hy = hv?.y ?? y(closes[closes.length - 1] ?? 0);

  const tipW = 210;
  const tipH = 54;
  const tipX = Math.min(w - padR - tipW, Math.max(padL, hx - tipW / 2));
  const tipY = Math.max(padT, hy - tipH - 10);

  const selY = selectedCents && Number.isFinite(selectedCents) ? y(selectedCents / 100) : null;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: "100%", cursor: "crosshair" }} onMouseMove={onMove} onMouseLeave={onLeave}>
      <defs>
        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0.00" />
        </linearGradient>

        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {grid.map((g, i) => (
        <g key={i}>
          <line x1={padL} x2={w - padR} y1={g.yy} y2={g.yy} stroke="rgba(255,255,255,0.07)" />
          <text
            x={w - padR + 6}
            y={g.yy + 4}
            fill="rgba(148,163,184,0.95)"
            fontSize="11"
            fontFamily='"Space Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
          >
            {fmtPct(g.val)}
          </text>
        </g>
      ))}

      {getXAxisTicks.map((tick, i) => {
        const tickX = x(Math.round((tick.idx / (sampled.length - 1)) * (N - 1)));
        return (
          <text
            key={`tick-${i}`}
            x={tickX}
            y={h - padB + 18}
            fill="rgba(148,163,184,0.95)"
            fontSize="11"
            fontFamily='"Space Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
            textAnchor="middle"
          >
            {tick.label}
          </text>
        );
      })}

      {areaPath && <path d={areaPath} fill="url(#areaGrad)" />}

      <path d={linePath} fill="none" stroke={color} strokeWidth="2.4" filter="url(#glow)" />

      {selY !== null && selY >= padT && selY <= h - padB && (
        <g>
          <line x1={padL} x2={w - padR} y1={selY} y2={selY} stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" strokeDasharray="4 4" />
          <text x={padL + 6} y={selY - 6} fill="rgba(255,255,255,0.85)" fontSize="11" fontFamily="'Space Mono', ui-monospace, monospace">
            SEL {selectedCents.toFixed(0)}¢
          </text>
        </g>
      )}

      {hoverIdx !== null && <line x1={hx} x2={hx} y1={padT} y2={h - padB} stroke="rgba(255,255,255,0.16)" />}

      <circle cx={hx} cy={hy} r="4.2" fill={color} />

      {hoverIdx !== null && hv && (
        <g>
          <rect x={tipX} y={tipY} width={tipW} height={tipH} rx="10" fill="rgba(10,12,14,0.92)" stroke="rgba(255,255,255,0.10)" />
          <text x={tipX + 10} y={tipY + 20} fill="rgba(233,238,245,0.95)" fontSize="12" fontWeight="800">
            {fmtPct(hv.v * 100)}
          </text>
          <text
            x={tipX + 10}
            y={tipY + 40}
            fill="rgba(148,163,184,0.95)"
            fontSize="11"
            fontFamily='"Space Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
          >
            {formatTooltipLabel(hv.t)}
          </text>
        </g>
      )}
    </svg>
  );
}
