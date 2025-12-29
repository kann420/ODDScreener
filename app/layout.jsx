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
              <div className="brand">
  {/* Icon */}
  <svg
    className="brand-icon"
    viewBox="0 0 64 64"
    aria-hidden="true"
  >
    <defs>
      <linearGradient id="oddsGrad" x1="10" y1="54" x2="54" y2="10">
        <stop offset="0" stopColor="#0B1D33" />
        <stop offset="0.5" stopColor="#2D78FF" />
        <stop offset="1" stopColor="#34D399" />
      </linearGradient>
    </defs>
    <circle
      cx="32"
      cy="32"
      r="22"
      fill="none"
      stroke="url(#oddsGrad)"
      strokeWidth="8"
      strokeLinecap="round"
      strokeDasharray="120 22"
      transform="rotate(-35 32 32)"
    />
  </svg>

  {/* Text */}
  <div className="brand-text">
    <div className="brand-row">
      <span className="odd">ODD</span>
      <span className="odd">S</span>
      <span className="rest">creener</span>
    </div>
    <div className="beta">beta</div>
  </div>
</div>
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
