"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function NavLinks() {
  const pathname = usePathname();

  const isActive = (href) => pathname === href;

  return (
    <div className="nav">
      <Link href="/" className={isActive("/") ? "active" : ""}>
        Discover
      </Link>

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

      {/* ✅ Smart Money is live now */}
<Link
  href="/smart-money"
  className={isActive("/smart-money") ? "nav-smart active" : "nav-smart"}
>
  <span className="nav-smart-title">Smart Money</span>
  <span className="nav-smart-badge">NEW</span>
</Link>

      <span className="nav-disabled">
        Copy Trade
        <span className="coming-soon">coming soon</span>
      </span>

      <Link
  href="/arbitage"
  className={isActive("/arbitage") ? "nav-smart active" : "nav-smart"}
>
  <span className="nav-smart-title">Arbitrage</span>
  <span className="nav-smart-badge">EARLY ACCESS</span>
</Link>
    </div>
  );
}
