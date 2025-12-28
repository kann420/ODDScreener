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
                <span className="brand-dot" />
                <span style={{letterSpacing:"0.2px"}}>fireplace <span style={{color:"#ff5b5b"}}>PRO</span></span>
              </div>
              <div className="nav">
                <a href="/">Discover</a>
                <a href="/portfolio">Portfolio</a>
                <a href="/watchlist">Watchlist</a>
                <a href="/referrals">Referrals</a>
              </div>
              <div className="spacer" />
              <div className="search">
                <span className="muted">Search</span>
                <span className="pill mono">Ctrl</span>
                <span className="pill mono">K</span>
              </div>
              <button className="btn">Sign in</button>
            </div>
          </div>
        </div>
        <div className="container">{children}</div>
      </body>
    </html>
  );
}
