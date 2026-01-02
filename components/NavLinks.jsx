"use client";

import { usePathname } from "next/navigation";

export default function NavLinks() {
  const pathname = usePathname();
  const isHome = pathname === "/";

  return (
    <div className="nav">
      <a href="/" className={isHome ? "active" : ""}>Discover</a>
      <span className="nav-disabled">
        Portfolio
        <span className="coming-soon">coming soon</span>
      </span>
      <span className="nav-disabled">
        Watchlist
        <span className="coming-soon">coming soon</span>
      </span>
      <span className="nav-disabled">
        Wallet Tracker
        <span className="coming-soon">coming soon</span>
      </span>
      <span className="nav-disabled">
        Smart Money
        <span className="coming-soon">coming soon</span>
      </span>
      <span className="nav-disabled">
        Copy Trade
        <span className="coming-soon">coming soon</span>
      </span>
    </div>
  );
}
