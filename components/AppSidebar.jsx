"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export const SIDEBAR_WIDTH = 56;

export default function AppSidebar() {
  const pathname = usePathname();

  const isPredictfun = pathname.startsWith("/predictfun");
  const isOpinion = pathname === "/opinion" || pathname.startsWith("/market");
  const isAppFeature = !isPredictfun && !isOpinion; // wallet, smart-money, arbitage

  return (
    <aside className="app-sidebar">
      {/* Home */}
      <Link href="/" className={`app-sidebar-item${isAppFeature ? " app-sidebar-active" : ""}`} title="Home">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
      </Link>

      {/* Search – opens overlay */}
      <button
        className="app-sidebar-item"
        title="Search"
        onClick={() => window.dispatchEvent(new CustomEvent('toggle-search-overlay', { detail: { platform: isOpinion ? 'opinion' : 'predictfun' } }))}
        style={{ background: 'none', padding: 0 }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </button>

      <div className="app-sidebar-sep" />

      {/* Predict.fun - Highlighted (supported) */}
      <Link href="/predictfun" className={`app-sidebar-item app-sidebar-highlighted${isPredictfun ? " app-sidebar-active" : ""}`} title="Predict.fun">
        <img src="/predictfun_logo.svg" alt="Predict.fun" width={26} height={26} style={{ display: "block" }} />
      </Link>

      {/* Opinion - Highlighted (supported) */}
      <Link href="/opinion" className={`app-sidebar-item app-sidebar-highlighted${isOpinion ? " app-sidebar-active-opinion" : ""}`} title="Opinion">
        <img src="/2logo-opinion.webp" alt="Opinion" width={26} height={26} style={{ display: "block", borderRadius: 6 }} />
      </Link>

      <div className="app-sidebar-sep" />

      {/* Polymarket - Dimmed */}
      <div className="app-sidebar-item app-sidebar-dimmed" title="Polymarket - Coming Soon">
        <img src="/2polymarket_600.webp" alt="Polymarket" width={26} height={26} style={{ display: "block" }} />
      </div>

      {/* Kalshi - Dimmed */}
      <div className="app-sidebar-item app-sidebar-dimmed" title="Kalshi - Coming Soon">
        <img src="/kalshi.svg" alt="Kalshi" width={26} height={26} style={{ display: "block" }} />
      </div>

      {/* Probable - Dimmed */}
      <div className="app-sidebar-item app-sidebar-dimmed" title="Probable - Coming Soon">
        <img src="/proable.svg" alt="Probable" width={26} height={26} style={{ display: "block" }} />
      </div>
    </aside>
  );
}
