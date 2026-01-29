"use client";

import { useMemo, memo } from "react";

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function MiniSparkline({ points, width = 120, height = 36 }) {
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

    const W = width;
    const H = height;
    const pad = 2;
    const span = Math.max(1e-9, max - min);

    const toX = (i) => pad + (i * (W - pad * 2)) / (pts.length - 1);
    const toY = (v) => pad + (H - pad * 2) * (1 - (v - min) / span);

    let d = `M ${toX(0).toFixed(2)} ${toY(pts[0]).toFixed(2)}`;
    for (let i = 1; i < pts.length; i++) {
      d += ` L ${toX(i).toFixed(2)} ${toY(pts[i]).toFixed(2)}`;
    }

    return { path: d, up: isUp };
  }, [points, width, height]);

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: "block" }}>
      <path d={`M 2 ${height - 2} L ${width - 2} ${height - 2}`} stroke="rgba(255,255,255,0.08)" strokeWidth="1" fill="none" />
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
        <text x="0" y={height / 2 + 4} fill="rgba(255,255,255,0.35)" fontSize="12">
          —
        </text>
      )}
    </svg>
  );
}

// Memoize to prevent unnecessary re-renders
export default memo(MiniSparkline, (prev, next) => {
  // Only re-render if dimensions or points change
  if (prev.width !== next.width || prev.height !== next.height) return false;
  if (prev.points?.length !== next.points?.length) return false;
  // Quick check first and last point
  const prevPts = prev.points || [];
  const nextPts = next.points || [];
  if (prevPts.length === 0 && nextPts.length === 0) return true;
  if (prevPts[0]?.p !== nextPts[0]?.p) return false;
  if (prevPts[prevPts.length - 1]?.p !== nextPts[nextPts.length - 1]?.p) return false;
  return true;
});
