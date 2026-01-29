"use client";

import React from "react";

export default function FooterBar({ version = "1.1.1", live = true }) {
  return (
    <div className="odds-footer-wrap" aria-label="Site footer bar">
      {/* Liquid glass strip */}
      <div className="odds-footer-glass" />

      {/* Content */}
      <div className="odds-footer-inner">
        <div className="odds-footer-left">
          <span className="odds-footer-pill">
            <span className={`odds-footer-dot ${live ? "is-live" : ""}`} />
            <span className="odds-footer-text">
              {live ? "Live" : "Offline"} &nbsp;<span className="odds-footer-muted" style={{ fontStyle: "italic" }}>version {version}</span>
            </span>
          </span>
        </div>

        <div className="odds-footer-right">
          <a className="odds-footer-icon" href="https://oddscreeners.gitbook.io/oddscreeners-docs" target="_blank" rel="noreferrer" aria-label="Docs">
            DOCS
          </a>

          {/* X / Twitter */}
          <a
            className="odds-footer-icon"
            href="https://x.com/ODDScreeners"
            target="_blank"
            rel="noreferrer"
            aria-label="X"
            title="X"
          >
            X
          </a>
        </div>
      </div>

      <style jsx>{`
        .odds-footer-wrap {
          position: fixed;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 60;
          height: 30px; /* giống cảm giác thanh bar mỏng */
          pointer-events: none; /* để không cản click phía trên */
        }

        /* Line xuyên suốt */
        .odds-footer-wrap::after {
          content: "";
          position: absolute;
          left: 0;
          right: 0;
          bottom: 0;
          height: 1px;
          opacity: 0.8;
          background: linear-gradient(
            90deg,
            rgba(255, 255, 255, 0.05),
            rgba(255, 255, 255, 0.18),
            rgba(255, 255, 255, 0.05)
          );
        }

        /* Liquid glass layer */
        .odds-footer-glass {
          position: absolute;
          inset: 0;
          border-top: 1px solid rgba(255, 255, 255, 0.06);
          background: linear-gradient(
            180deg,
            rgba(255, 255, 255, 0.06),
            rgba(255, 255, 255, 0.03)
          );
          backdrop-filter: blur(6px) saturate(100%);
          -webkit-backdrop-filter: blur(6px) saturate(100%);
          box-shadow: 0 -10px 30px rgba(0, 0, 0, 0.35);
          overflow: hidden;
        }

        /* highlight “liquid” */
        .odds-footer-glass::before {
          content: "";
          position: absolute;
          top: -80%;
          left: -20%;
          width: 60%;
          height: 220%;
          transform: rotate(18deg);
          background: radial-gradient(
            closest-side,
            rgba(255, 255, 255, 0.18),
            rgba(255, 255, 255, 0.06),
            transparent 70%
          );
          opacity: 0.9;
          filter: blur(2px);
        }

        /* subtle moving sheen */
        .odds-footer-glass::after {
          content: "";
          position: absolute;
          inset: -40% -40%;
          background: linear-gradient(
            120deg,
            transparent 40%,
            rgba(255, 255, 255, 0.06) 50%,
            transparent 60%
          );
          transform: translateX(-20%);
          animation: oddsSheen 5.5s ease-in-out infinite;
          opacity: 0.6;
        }

        @keyframes oddsSheen {
          0% {
            transform: translateX(-18%);
          }
          50% {
            transform: translateX(18%);
          }
          100% {
            transform: translateX(-18%);
          }
        }

        .odds-footer-inner {
          position: relative;
          height: 30px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 14px;
          pointer-events: auto; /* bật lại click cho nội dung */
        }

        .odds-footer-left,
        .odds-footer-right {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 180px;
        }

        .odds-footer-right {
          justify-content: flex-end;
        }

        /* pill Live (cùng “size feel” với icon) */
        .odds-footer-pill {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          height: 20px;
          padding: 0 6px;
          border-radius: 999px;
          background: rgba(0, 0, 0, 0.25);
          border: 1px solid rgba(255, 255, 255, 0.08);
          box-shadow: 0 8px 18px rgba(0, 0, 0, 0.25);
        }

        .odds-footer-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.18);
        }

        .odds-footer-dot.is-live {
          background: #35d07f;
          box-shadow: 0 0 0 3px rgba(53, 208, 127, 0.15);
        }

        .odds-footer-text {
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.2px;
          color: rgba(255, 255, 255, 0.92);
          white-space: nowrap;
        }

        .odds-footer-muted {
          font-weight: 700;
          color: rgba(255, 255, 255, 0.65);
        }

        /* icon buttons right (cùng height với pill) */
        .odds-footer-icon {
          height: 28px;
          padding: 0 10px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 999px;
          background: rgba(0, 0, 0, 0.18);
          border: 1px solid rgba(255, 255, 255, 0.08);
          color: rgba(255, 255, 255, 0.85);
          text-decoration: none;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.4px;
          transition: transform 120ms ease, background 120ms ease, border 120ms ease;
          user-select: none;
        }

        .odds-footer-icon:hover {
          transform: translateY(-1px);
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.14);
          color: rgba(255, 255, 255, 0.95);
        }

        @media (max-width: 760px) {
          .odds-footer-left,
          .odds-footer-right {
            min-width: auto;
          }
          /* Giữ DOCS và X hiển thị trên mobile, chỉ ẩn nếu có link thứ 3+ */
          .odds-footer-right a:nth-child(n+3) {
            display: none;
          }
        }
      `}</style>
    </div>
  );
}
