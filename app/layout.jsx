import "./globals.css";
import Script from "next/script";
import NavLinks from "../components/NavLinks";
import GlobalMarketSearchInput from "../components/GlobalMarketSearchInput";
import FooterBar from "../components/FooterBar";

// ===== GOOGLE FONTS CDN =====
// Using Google Fonts CDN directly for exact rendering match
// Optimized with preconnect for fast loading

const GA_MEASUREMENT_ID = "G-P1NXMB82YZ";

export const metadata = {
  title: "ODDScreeners - Prediction Markets Explorer",
  description: "Realtime price charts and trading history on Opinion, Polymarket, Kalshi, and more.",
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon.ico",
  },
};

// ===== Viewport config for mobile optimization =====
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0b0d10',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        {/* ===== Google Fonts with preconnect for fast loading ===== */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link 
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" 
          rel="stylesheet" 
        />

        {/* ===== Preload critical images ===== */}
        <link rel="preload" href="/2logonewest.svg" as="image" />
        <link rel="preload" href="/logo-opinion.svg" as="image" />

        {/* Favicon */}
        <link rel="icon" href="/favicon.ico" sizes="any" />

        {/* ===== CRITICAL CSS: Inline above-the-fold styles ===== */}
        <style dangerouslySetInnerHTML={{ __html: `
          /* Critical CSS for instant render */
          :root {
            color-scheme: dark;
            --bg: #0b0d10;
            --panel: #12151a;
            --text: #e9eef5;
            --muted: #94a3b8;
            --border: rgba(255,255,255,0.08);
          }
          *, *::before, *::after { box-sizing: border-box; }
          html, body { height: 100%; margin: 0; }
          body {
            background: var(--bg);
            color: var(--text);
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
          }
          .topbar {
            position: sticky;
            top: 0;
            z-index: 50;
            background: rgba(8,10,12,0.9);
            backdrop-filter: blur(10px);
            border-bottom: 1px solid var(--border);
          }
          .container { max-width: 1500px; margin: 0 auto; padding: 12px 14px; }
          /* Skeleton animation */
          @keyframes skeleton-pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
          }
        `}} />

        {/* ===== Google Analytics - Load after interactive ===== */}
        <Script
          src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', '${GA_MEASUREMENT_ID}', {
              page_path: window.location.pathname,
            });
          `}
        </Script>
      </head>

      <body>
        {/* Smart Money hub warm-up - deferred with lazy loading */}
        <img 
          src="/api/smart-money/warm" 
          alt="" 
          style={{ display: "none" }} 
          loading="lazy"
        />

        {/* Notification Banner */}
        <div className="notification-banner" style={{
          background: 'linear-gradient(90deg, #1a1a1a 0%, #2d2d2d 100%)',
          padding: '8px 12px',
          textAlign: 'center',
          fontSize: '13px',
          color: '#e0e0e0',
          lineHeight: '1.5'
        }}>
          ODDScreeners is currently in early beta. We're shipping daily updates to improve your experience. Use code <strong>8YfTc9</strong> on Opinion to get up to 10% fee discount. Follow us on <a href="https://x.com/ODDScreeners" target="_blank" rel="noopener noreferrer" style={{ color: '#e0e0e0', textDecoration: 'underline' }}>X</a>.
        </div>

        {/* Topbar */}
        <div className="topbar">
          <div className="container">
            <div
              className="topbar-inner"
              style={{
                display: "flex",
                alignItems: "center",
                width: "100%",
              }}
            >
              {/* LEFT: brand + nav */}
              <div className="topbar-left" style={{ display: "flex", alignItems: "center", gap: 18 }}>
                <a className="brand" href="/" aria-label="ODDScreeners">
                  <img
                    src="/2logonewest.svg"
                    alt="ODDScreeners"
                    width={160}
                    height={52}
                    fetchPriority="high"
                    decoding="async"
                    style={{
                      height: 160,
                      width: "auto",
                      display: "block",
                      objectFit: "contain",
                      maxHeight: "none",
                    }}
                  />
                </a>

                <NavLinks />
              </div>

              <div style={{ flex: 1 }} />

              {/* RIGHT: Platform logos */}
              <div className="platform-logos" style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <a href="https://app.opinion.trade?code=8YfTc9" target="_blank" rel="noopener noreferrer" title="Opinion">
                  <img
                    src="/logo-opinion.svg"
                    alt="Opinion"
                    width={42}
                    height={42}
                    loading="lazy"
                    decoding="async"
                    style={{
                      height: 42,
                      width: "auto",
                      display: "block",
                    }}
                  />
                </a>
                <img
                  src="/polymarket_600.svg"
                  alt="Polymarket"
                  title="Polymarket - Coming Soon"
                  width={42}
                  height={42}
                  loading="lazy"
                  decoding="async"
                  style={{
                    height: 42,
                    width: "auto",
                    display: "block",
                    filter: "grayscale(100%) opacity(0.4)",
                  }}
                />
                <img
                  src="/kalshi.svg"
                  alt="Kalshi"
                  title="Kalshi - Coming Soon"
                  width={42}
                  height={42}
                  loading="lazy"
                  decoding="async"
                  style={{
                    height: 42,
                    width: "auto",
                    display: "block",
                    filter: "grayscale(100%) opacity(0.4)",
                  }}
                />
                <img
                  src="/proable.svg"
                  alt="Proable"
                  title="Proable - Coming Soon"
                  width={42}
                  height={42}
                  loading="lazy"
                  decoding="async"
                  style={{
                    height: 42,
                    width: "auto",
                    display: "block",
                    filter: "grayscale(100%) opacity(0.4)",
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Page content */}
        <div className="container">{children}</div>

        {/* New Premium Footer Bar (replaces old bottom-left & bottom-right footers) */}
        <FooterBar version="1.2.1" live />
      </body>
    </html>
  );
}
