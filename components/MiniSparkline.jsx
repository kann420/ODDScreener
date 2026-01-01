"use client";

import { useMemo } from "react";

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export default function MiniSparkline({ points }) {
  const { path, up } = useMemo(() => {
    const pts = (points || []).map((p) => num(p.p));
    if (pts.length < 2) return { path: "", up: true };

    let min = Infinity;
    let max = -Infinity;
    for (const v of pts) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const first = pts[0];
    const last = pts[pts.length - 1];
    const isUp = last >= first;

    const W = 120;
    const H = 36;
    const pad = 2;
    const span = Math.max(1e-9, max - min);

    const toX = (i) => pad + (i * (W - pad * 2)) / (pts.length - 1);
    const toY = (v) => pad + (H - pad * 2) * (1 - (v - min) / span);

    let d = `M ${toX(0).toFixed(2)} ${toY(pts[0]).toFixed(2)}`;
    for (let i = 1; i < pts.length; i++) {
      d += ` L ${toX(i).toFixed(2)} ${toY(pts[i]).toFixed(2)}`;
    }

    return { path: d, up: isUp };
  }, [points]);

  return (
    <svg width="120" height="36" viewBox="0 0 120 36" style={{ display: "block" }}>
      {/* baseline */}
      <path d="M 2 34 L 118 34" stroke="rgba(255,255,255,0.08)" strokeWidth="1" fill="none" />
      {/* line */}
      {path ? (
        <path
          d={path}
          stroke={up ? "rgba(80, 220, 170, 0.95)" : "rgba(255, 120, 120, 0.95)"}
          strokeWidth="2"
          fill="none"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ) : (
        <text x="0" y="22" fill="rgba(255,255,255,0.35)" fontSize="12">
          —
        </text>
      )}
    </svg>
  );
}
