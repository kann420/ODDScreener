import "./globals.css";
import Script from "next/script";
import NavLinks from "../components/NavLinks";
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
        {/* ===== DNS Prefetch for external resources ===== */}
        <link rel="dns-prefetch" href="https://fonts.googleapis.com" />
        <link rel="dns-prefetch" href="https://fonts.gstatic.com" />
        <link rel="dns-prefetch" href="https://www.googletagmanager.com" />
        
        {/* ===== Google Fonts with preconnect for fast loading ===== */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Opinion font stack: Manrope (headings), Open Sans (body), Space Mono (mono) */}
        <link 
          href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700;800&family=Open+Sans:wght@300;400;500;600;700;800&family=Space+Mono:wght@400;700&display=swap" 
          rel="stylesheet" 
        />

        {/* NOTE: Removed preload for large SVGs (600KB+) - consider converting to optimized PNG/WebP */}

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
            --desktop-container-max-width: 1500px;
            --desktop-container-padding-x: 14px;
          }
          *, *::before, *::after { box-sizing: border-box; }
          html, body { height: 100%; margin: 0; }
          body {
            background: var(--bg);
            color: var(--text);
            font-family: 'Open Sans', 'Manrope', -apple-system, BlinkMacSystemFont, sans-serif;
          }
          .topbar {
            position: sticky;
            top: 0;
            z-index: 50;
            background: rgba(8,10,12,0.9);
            backdrop-filter: blur(10px);
            border-bottom: 1px solid var(--border);
          }
          .container {
            max-width: var(--desktop-container-max-width);
            margin: 0 auto;
            padding: 12px var(--desktop-container-padding-x);
          }
          @media (min-width: 1024px) {
            .topbar > .container,
            body > .container {
              width: 100% !important;
              max-width: none !important;
              margin: 0 !important;
              padding-left: 4px !important;
              padding-right: 4px !important;
            }
          }
          @media (min-width: 1280px) {
            :root {
              --desktop-container-max-width: none;
              --desktop-container-padding-x: 4px;
            }
          }
          /* Skeleton animation */
          @keyframes skeleton-pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
          }
        `}} />

        {/* ===== Google Analytics - Defer heavily to not block main thread ===== */}
        {/* Load GA only after page is fully interactive (afterInteractive is too early) */}
        <Script
          src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
          strategy="lazyOnload"
        />
        <Script id="google-analytics" strategy="lazyOnload">
          {`
            // Defer GA initialization to idle time
            if ('requestIdleCallback' in window) {
              requestIdleCallback(function() {
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', '${GA_MEASUREMENT_ID}', {
                  page_path: window.location.pathname,
                  send_page_view: false
                });
                // Send page view after a small delay
                setTimeout(function() {
                  gtag('event', 'page_view');
                }, 100);
              }, { timeout: 3000 });
            } else {
              // Fallback for browsers without requestIdleCallback
              setTimeout(function() {
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', '${GA_MEASUREMENT_ID}', {
                  page_path: window.location.pathname,
                });
              }, 2000);
            }
          `}
        </Script>
        
        {/* Smart Money hub warm-up - load after page is interactive */}
        <Script id="smart-money-warmup" strategy="lazyOnload">
          {`
            // Warm up the smart money API after page is fully loaded
            if (typeof fetch !== 'undefined') {
              fetch('/api/smart-money/warm', { method: 'GET', priority: 'low' })
                .catch(() => {}); // Silently fail if warmup fails
            }
          `}
        </Script>
      </head>

      <body>
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
                    src="/2oddscreeners_logo.webp"
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
              <div className="platform-logos" style={{ display: "flex", alignItems: "center", gap: 16, marginRight: 28 }}>
                <a href="https://app.opinion.trade?code=8YfTc9" target="_blank" rel="noopener noreferrer" title="Opinion">
                  <img
                    src="/2logo-opinion.webp"
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
                  src="/2polymarket_600.webp"
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
        <FooterBar version="1.4.0" live />
      </body>
    </html>
  );
}
