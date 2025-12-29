import "./globals.css";

export const metadata = {
  title: "Opinion GMGN Clone (Demo)",
  description: "Demo UI for Opinion explorer + embedded chart service"
};

export default function RootLayout({ children }) {
  return (
    <html lang="vi">
      <body>
        <div className="topbar">
          <div className="container">
            <div className="topbar-inner">
              <a className="brand" href="/" aria-label="ODDScreener">
                {/* Icon (match reference) */}
                <svg className="brand-icon" viewBox="0 0 64 64" aria-hidden="true">
                  <defs>
                    <linearGradient id="oddsMetal" x1="8" y1="56" x2="56" y2="8" gradientUnits="userSpaceOnUse">
                      <stop offset="0" stopColor="#0B1D33" />
                      <stop offset="0.38" stopColor="#7BDFF2" />
                      <stop offset="0.70" stopColor="#D7F9FF" />
                      <stop offset="1" stopColor="#1F6FEB" />
                    </linearGradient>
                    <filter id="softGlow" x="-30%" y="-30%" width="160%" height="160%">
                      <feGaussianBlur stdDeviation="1.1" result="blur" />
                      <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                  </defs>

                  <circle
                    cx="32"
                    cy="32"
                    r="21"
                    fill="none"
                    stroke="url(#oddsMetal)"
                    strokeWidth="9"
                    strokeLinecap="round"
                    strokeDasharray="112 30"
                    transform="rotate(-35 32 32)"
                    filter="url(#softGlow)"
                  />
                </svg>

                {/* Wordmark */}
                <span className="brand-wordmark">
                  <span className="brand-odds">ODDS</span>
                  <span className="brand-screener">creener</span>
                  <span className="brand-beta">beta</span>
                </span>
              </a>

              <div className="nav">
                <a href="/">Discover</a>
                <a href="/portfolio">Portfolio</a>
                <a href="/watchlist">Watchlist</a>
              </div>

              <div className="spacer" />

              <div className="search">
                <span className="muted">Search</span>
                <span className="pill mono">Ctrl</span>
                <span className="pill mono">K</span>
              </div>
            </div>
          </div>
        </div>

        <div className="container">{children}</div>
      </body>
    </html>
  );
}
