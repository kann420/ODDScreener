"use client";

import { useState, useRef, useCallback, useEffect } from "react";

/* ==========================================================
   FloatingStreamPlayer
   - Twitch embed via iframe (no API key needed)
   - Draggable, resizable (2 presets), minimizable, closeable
   - Muted by default (autoplay policy)
   - position: fixed, bottom-right corner
========================================================== */

const SIZES = {
  normal: { w: 480, h: 270 },
  large:  { w: 720, h: 405 },
};

// Domains allowed for Twitch embed parent param
const PARENT_DOMAINS = ["oddscreeners.com", "www.oddscreeners.com", "localhost"];

function buildEmbedUrl(channel) {
  const parents = PARENT_DOMAINS.map((d) => `parent=${d}`).join("&");
  return `https://player.twitch.tv/?channel=${encodeURIComponent(channel)}&${parents}&muted=true&autoplay=true`;
}

export default function FloatingStreamPlayer({ channel, title, onClose }) {
  const [minimized, setMinimized] = useState(false);
  const [sizeKey, setSizeKey] = useState("normal");
  const [pos, setPos] = useState({ x: 20, y: 20 }); // offset from bottom-right
  const dragRef = useRef(null);
  const dragging = useRef(false);
  const dragStart = useRef({ mx: 0, my: 0, px: 0, py: 0 });

  const size = SIZES[sizeKey];

  // ── Drag handlers ──────────────────────────────────
  const onPointerDown = useCallback((e) => {
    if (e.target.closest("button") || e.target.closest("iframe")) return;
    dragging.current = true;
    dragStart.current = { mx: e.clientX, my: e.clientY, px: pos.x, py: pos.y };
    e.preventDefault();
  }, [pos]);

  useEffect(() => {
    const onMove = (e) => {
      if (!dragging.current) return;
      const dx = dragStart.current.mx - e.clientX;
      const dy = dragStart.current.my - e.clientY;
      setPos({
        x: Math.max(0, dragStart.current.px + dx),
        y: Math.max(0, dragStart.current.py + dy),
      });
    };
    const onUp = () => { dragging.current = false; };
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
  return (
    <div
      ref={dragRef}
      className="stream-player-float"
      style={{ right: pos.x, bottom: pos.y, width: size.w }}
      onPointerDown={onPointerDown}
    >
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
            onClick={() => setSizeKey((k) => (k === "normal" ? "large" : "normal"))}
            title={sizeKey === "normal" ? "Enlarge" : "Shrink"}
            className="stream-ctrl-btn"
          >
            {sizeKey === "normal" ? (
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
      </div>
    </div>
  );
}
