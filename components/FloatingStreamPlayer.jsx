"use client";

import { useState, useRef, useCallback, useEffect } from "react";

/* ==========================================================
   FloatingStreamPlayer
   - Twitch embed via iframe (no API key needed)
   - Draggable, corner-resizable, minimizable, closeable
   - Muted by default (autoplay policy)
   - position: fixed, bottom-right corner
========================================================== */

const SIZE_NORMAL = { w: 480, h: 270 };
const SIZE_LARGE  = { w: 720, h: 405 };
const MIN_W = 320, MIN_H = 180;
const MAX_W = 1010, MAX_H = 570;

// Domains allowed for Twitch embed parent param
const PARENT_DOMAINS = ["oddscreeners.com", "www.oddscreeners.com", "localhost"];

function buildEmbedUrl(channel) {
  const parents = PARENT_DOMAINS.map((d) => `parent=${d}`).join("&");
  return `https://player.twitch.tv/?channel=${encodeURIComponent(channel)}&${parents}&muted=true&autoplay=true`;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

export default function FloatingStreamPlayer({ channel, title, onClose }) {
  const [minimized, setMinimized] = useState(false);
  const [size, setSize] = useState({ w: SIZE_NORMAL.w, h: SIZE_NORMAL.h });
  const [pos, setPos] = useState({ x: 20, y: 20 }); // offset from bottom-right
  const [interacting, setInteracting] = useState(false); // blocks iframe pointer events
  const dragRef = useRef(null);
  const dragging = useRef(false);
  const dragStart = useRef({ mx: 0, my: 0, px: 0, py: 0 });

  // ── Refs for resize ────────────────────────────────
  const resizeData = useRef(null); // { corner, mx, my, w, h, px, py }

  // ── Drag handlers ──────────────────────────────────
  const onPointerDown = useCallback((e) => {
    if (e.target.closest("button") || e.target.closest("iframe") || e.target.closest(".stream-resize-handle")) return;
    dragging.current = true;
    dragStart.current = { mx: e.clientX, my: e.clientY, px: pos.x, py: pos.y };
    setInteracting(true);
    e.preventDefault();
  }, [pos]);

  // ── Resize handlers ────────────────────────────────
  const onResizePointerDown = useCallback((corner, e) => {
    e.preventDefault();
    e.stopPropagation();
    resizeData.current = {
      corner,
      mx: e.clientX,
      my: e.clientY,
      w: size.w,
      h: size.h,
      px: pos.x,
      py: pos.y,
    };
    setInteracting(true);
  }, [size, pos]);

  useEffect(() => {
    const onMove = (e) => {
      // ── Handle drag ──
      if (dragging.current) {
        const dx = dragStart.current.mx - e.clientX;
        const dy = dragStart.current.my - e.clientY;
        setPos({
          x: Math.max(0, dragStart.current.px + dx),
          y: Math.max(0, dragStart.current.py + dy),
        });
        return;
      }
      // ── Handle corner resize ──
      const r = resizeData.current;
      if (!r) return;
      const dx = e.clientX - r.mx;
      const dy = e.clientY - r.my;

      let newW = r.w, newH = r.h;

      // Position is anchored bottom-right (CSS right/bottom).
      // nw = top-left corner of element (opposite to anchor → no pos shift)
      // ne = top-right corner → shifts pos.x
      // sw = bottom-left corner → shifts pos.y
      // se = bottom-right corner → shifts pos.x + pos.y
      switch (r.corner) {
        case "nw": newW = r.w - dx; newH = r.h - dy; break;
        case "ne": newW = r.w + dx; newH = r.h - dy; break;
        case "sw": newW = r.w - dx; newH = r.h + dy; break;
        case "se": newW = r.w + dx; newH = r.h + dy; break;
      }

      newW = clamp(newW, MIN_W, MAX_W);
      newH = clamp(newH, MIN_H, MAX_H);

      const dw = newW - r.w; // actual delta after clamp
      const dh = newH - r.h;

      let newPx = r.px, newPy = r.py;
      if (r.corner === "ne" || r.corner === "se") newPx = r.px - dw;
      if (r.corner === "sw" || r.corner === "se") newPy = r.py - dh;

      setSize({ w: newW, h: newH });
      setPos({ x: Math.max(0, newPx), y: Math.max(0, newPy) });
    };

    const onUp = () => {
      dragging.current = false;
      resizeData.current = null;
      setInteracting(false);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  // ── ESC to close ──────────────────────────────────
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!channel) return null;

  const embedUrl = buildEmbedUrl(channel);

  // ── Minimized pill ────────────────────────────────
  if (minimized) {
    return (
      <div
        className="stream-player-minimized"
        style={{ right: pos.x, bottom: pos.y }}
        onPointerDown={onPointerDown}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
          <path d="M11.64 5.93h1.43v4.28h-1.43m3.93-4.28H17v4.28h-1.43M7 2L3.43 5.57v12.86h4.28V22l3.58-3.57h2.85L20.57 12V2m-1.43 9.29l-2.85 2.85h-2.86l-2.5 2.5v-2.5H7.71V3.43h11.43Z" />
        </svg>
        <span className="stream-player-pill-text">{title || channel}</span>
        <span className="stream-player-live-dot" />
        <button onClick={() => setMinimized(false)} title="Expand" className="stream-ctrl-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
            <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
          </svg>
        </button>
        <button onClick={onClose} title="Close" className="stream-ctrl-btn stream-ctrl-close">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    );
  }

  // ── Full player ───────────────────────────────────
  const isLarge = size.w > 600;

  return (
    <div
      ref={dragRef}
      className="stream-player-float"
      style={{ right: pos.x, bottom: pos.y, width: size.w }}
      onPointerDown={onPointerDown}
    >
      {/* Corner resize handles */}
      <div className="stream-resize-handle stream-resize-nw" onPointerDown={(e) => onResizePointerDown("nw", e)} />
      <div className="stream-resize-handle stream-resize-ne" onPointerDown={(e) => onResizePointerDown("ne", e)} />
      <div className="stream-resize-handle stream-resize-sw" onPointerDown={(e) => onResizePointerDown("sw", e)} />
      <div className="stream-resize-handle stream-resize-se" onPointerDown={(e) => onResizePointerDown("se", e)} />

      {/* Title bar (drag handle) */}
      <div className="stream-player-titlebar">
        <div className="stream-player-titlebar-left">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0, color: "#bf94ff" }}>
            <path d="M11.64 5.93h1.43v4.28h-1.43m3.93-4.28H17v4.28h-1.43M7 2L3.43 5.57v12.86h4.28V22l3.58-3.57h2.85L20.57 12V2m-1.43 9.29l-2.85 2.85h-2.86l-2.5 2.5v-2.5H7.71V3.43h11.43Z" />
          </svg>
          <span className="stream-player-channel">{title || channel}</span>
          <span className="stream-player-live-dot" />
        </div>
        <div className="stream-player-titlebar-actions">
          {/* Size toggle */}
          <button
            onClick={() => setSize(isLarge ? { w: SIZE_NORMAL.w, h: SIZE_NORMAL.h } : { w: SIZE_LARGE.w, h: SIZE_LARGE.h })}
            title={isLarge ? "Shrink" : "Enlarge"}
            className="stream-ctrl-btn"
          >
            {!isLarge ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
                <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" />
                <line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            )}
          </button>
          {/* Minimize */}
          <button onClick={() => setMinimized(true)} title="Minimize" className="stream-ctrl-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          {/* Open on Twitch */}
          <a
            href={`https://www.twitch.tv/${encodeURIComponent(channel)}`}
            target="_blank"
            rel="noopener noreferrer"
            title="Open on Twitch"
            className="stream-ctrl-btn"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
              <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </a>
          {/* Close */}
          <button onClick={onClose} title="Close (Esc)" className="stream-ctrl-btn stream-ctrl-close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* Iframe */}
      <div className="stream-player-iframe-wrap" style={{ paddingBottom: `${(size.h / size.w) * 100}%` }}>
        <iframe
          src={embedUrl}
          title={`Twitch: ${channel}`}
          allow="autoplay; encrypted-media; fullscreen"
          allowFullScreen
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
        />
        {/* Transparent overlay blocks iframe pointer events during drag/resize */}
        {interacting && (
          <div style={{ position: "absolute", inset: 0, zIndex: 2 }} />
        )}
      </div>
    </div>
  );
}
