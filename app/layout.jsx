import "./globals.css";

export const metadata = {
  title: "ODDScreeners - Opinion Markets Explorer",
  description: "Demo UI for Opinion explorer + embedded chart service"
};

export default function RootLayout({ children }) {
  return (
    <html lang="vi">
      <body>
        <div className="topbar">
          <div className="container">
            <div className="topbar-inner">
              <a className="brand" href="/" aria-label="ODDScreeners">
                {/* Santa logo from v3 */}
                <img className="brand-icon" src="/logo.svg" alt="ODDScreeners" />

                {/* Wordmark */}
                <span className="brand-wordmark">
                  <span className="brand-odds">ODDS</span>
                  <span className="brand-screener">creeners</span>
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
                <svg
                  className="search-icon"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <span className="muted">Search</span>
              </div>
            </div>
          </div>
        </div>

        <div className="container">{children}</div>
      </body>
    </html>
  );
}
