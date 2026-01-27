import "./globals.css";

export const metadata = {
  title: "ODDScreeners - Prediction Markets Explorer",
  description: "Realtime price charts and trading history on Opinion, Polymarket, Kalshi, and more."
};

export default function RootLayout({ children }) {
  return (
    <html lang="vi">
      <body>
        <div className="topbar">
          <div className="container">
            <div className="topbar-inner">
              <div className="brand">
                <div className="brand-logo">
                  <div className="brand-name">
                    <span style={{color:"#fff"}}>ODDS</span>
                    <span className="brand-screener">creener</span>
                  </div>
                  <div className="brand-beta">Beta</div>
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
