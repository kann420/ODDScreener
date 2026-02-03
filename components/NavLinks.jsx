"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";

export default function NavLinks() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  const isActive = (href) => pathname === href;

  // Close menu when route changes
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // Prevent body scroll when menu is open
  useEffect(() => {
    if (menuOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  return (
    <>
      {/* Desktop Navigation */}
      <div className="nav nav-desktop">
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

        <Link
          href="/wallet"
          className={pathname?.startsWith("/wallet") ? "nav-smart active" : "nav-smart"}
        >
          <span className="nav-smart-title">Wallet Tracker</span>
          <span className="nav-smart-badge">NEW</span>
        </Link>

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

      {/* Mobile Hamburger Button */}
      <button
        className="mobile-menu-btn"
        onClick={() => setMenuOpen(!menuOpen)}
        aria-label="Toggle menu"
      >
        {menuOpen ? (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        ) : (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        )}
      </button>

      {/* Mobile Menu Overlay */}
      {menuOpen && (
        <div className="mobile-menu-overlay" onClick={() => setMenuOpen(false)} />
      )}

      {/* Mobile Slide Menu */}
      <div className={`mobile-menu ${menuOpen ? "open" : ""}`}>
        <div className="mobile-menu-header">
          <span style={{ fontWeight: 700, fontSize: 16 }}>Menu</span>
          <button onClick={() => setMenuOpen(false)} style={{ background: "none", border: "none", color: "#fff", cursor: "pointer" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <nav className="mobile-menu-nav">
          <Link href="/" className={`mobile-menu-item ${isActive("/") ? "active" : ""}`}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            Discover
          </Link>

          <Link href="/smart-money" className={`mobile-menu-item ${isActive("/smart-money") ? "active" : ""}`}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
            </svg>
            Smart Money
            <span className="mobile-menu-badge">NEW</span>
          </Link>

          <Link href="/arbitage" className={`mobile-menu-item ${isActive("/arbitage") ? "active" : ""}`}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23,6 13.5,15.5 8.5,10.5 1,18"/>
              <polyline points="17,6 23,6 23,12"/>
            </svg>
            Arbitrage
            <span className="mobile-menu-badge orange">EARLY</span>
          </Link>

          <Link href="/wallet" className={`mobile-menu-item ${pathname?.startsWith("/wallet") ? "active" : ""}`}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
              <line x1="1" y1="10" x2="23" y2="10"/>
            </svg>
            Wallet Tracker
            <span className="mobile-menu-badge">NEW</span>
          </Link>

          <div className="mobile-menu-divider" />

          <div className="mobile-menu-item disabled">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
            Portfolio
            <span className="mobile-menu-soon">Soon</span>
          </div>

          <div className="mobile-menu-item disabled">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
            </svg>
            Watchlist
            <span className="mobile-menu-soon">Soon</span>
          </div>
        </nav>
      </div>
    </>
  );
}
