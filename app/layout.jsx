import "./globals.css";
import Script from "next/script";

const GA_MEASUREMENT_ID = "G-P1NXMB82YZ";

export const metadata = {
  title: "ODDScreeners - Opinion Markets Explorer",
  description: "Demo UI for Opinion explorer + embedded chart service"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        {/* Google Analytics */}
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
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />
      </head>
      <body>
        <div className="topbar">
          <div className="container">
            <div className="topbar-inner">
              <a className="brand" href="/" aria-label="ODDScreeners">
                <img className="brand-icon" src="/logo.svg" alt="ODDScreeners" />

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
