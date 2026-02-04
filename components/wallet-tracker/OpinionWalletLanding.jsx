"use client";

import { useState, useEffect } from "react";

const SLIDES = [
  { 
    id: 0, 
    header: "/wallet track/1.png", 
    banner: "/wallet track/big1.png",
    alt: "Wallet Tracker Feature 1",
    wallet: "0x9f5948c84d2567bd5ff9127ac14898334e66d002"
  },
  { 
    id: 1, 
    header: "/wallet track/2.png", 
    banner: "/wallet track/big2.png",
    alt: "Wallet Tracker Feature 2",
    wallet: "0x34d8619e909aa917cd176b733a5bfbafcdc0483e"
  },
  { 
    id: 2, 
    header: "/wallet track/3.png", 
    banner: "/wallet track/big3.png",
    alt: "Wallet Tracker Feature 3",
    wallet: "0x2d57911f5b0bc2e276bc6181cc64d9e94c5cb92b"
  },
];

// Mobile banner path
const MOBILE_BANNER = "/wallet track/banner mobi.png";

export default function OpinionWalletLanding() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isMobile, setIsMobile] = useState(false);

  // Detect mobile screen
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const handleHeaderEnter = (index) => {
    setActiveIndex(index);
  };
  
  // Keyboard navigation
  const handleKeyDown = (e, index) => {
    if (e.key === 'Enter' || e.key === ' ') {
      setActiveIndex(index);
    }
  };

  // Mobile Layout - Only big banner, no thumbnails
  if (isMobile) {
    return (
      <div className="opinion-landing-container-mobile" style={{ 
        width: "100%",
        maxWidth: "95vw",
        margin: "0 auto 32px auto",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        boxSizing: "border-box"
      }}>
        {/* Mobile Banner - Single image, no orange border */}
        <div style={{
          position: "relative",
          width: "100%",
          backgroundColor: "#0a0a0c",
          borderRadius: 12,
          overflow: "hidden"
        }}>
          <img 
            src={MOBILE_BANNER}
            alt="Wallet Tracker Mobile"
            style={{
              width: "100%",
              height: "auto",
              objectFit: "contain",
              display: "block"
            }}
          />
          
          {/* View More Link - Mobile */}
          <a 
            href={`/wallet/${SLIDES[0].wallet}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "block",
              textAlign: "center",
              padding: "12px 16px",
              fontSize: 16,
              fontWeight: 600,
              color: "#fff",
              textDecoration: "underline",
              textUnderlineOffset: 4,
              cursor: "pointer",
              backgroundColor: "rgba(0,0,0,0.5)"
            }}
          >
            View more 👉
          </a>
        </div>
      </div>
    );
  }

  // Desktop Layout (unchanged)
  return (
    <div className="opinion-landing-container" style={{ 
      width: 1080, // Fixed width = 320*3 + 16*2
      maxWidth: "95vw",
      // Break out of parent container and center relative to viewport
      position: "relative",
      left: "50%",
      transform: "translateX(-50%)",
      marginBottom: 32,
      display: "flex",
      flexDirection: "column",
      gap: 24,
      boxSizing: "border-box"
    }}>
      {/* Header Cards (Thumbnails) */}
      <div className="landing-headers-row" style={{
        display: "flex",
        gap: 16,
        justifyContent: "center",
        alignItems: "center"
      }}>
        {SLIDES.map((slide, i) => {
          const isActive = i === activeIndex;
          return (
            <div 
              key={slide.id}
              role="button"
              tabIndex={0}
              onMouseEnter={() => handleHeaderEnter(i)}
              onClick={() => setActiveIndex(i)}
              onKeyDown={(e) => handleKeyDown(e, i)}
              style={{
                width: 350,
                height: 230,
                borderRadius: 12,
                cursor: "pointer",
                overflow: "hidden",
                border: isActive ? "2px solid #f97316" : "2px solid rgba(255,255,255,0.1)",
                position: "relative",
                transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
                flexShrink: 0,
                transform: isActive ? "scale(1.02)" : "scale(1)",
                boxShadow: isActive ? "0 4px 24px rgba(249, 115, 22, 0.3)" : "none",
                opacity: isActive ? 1 : 0.7,
                backgroundColor: "#0d0d0f",
              }}
            >
              {/* Thumbnail Image */}
              <img 
                src={slide.header} 
                alt={`Slide ${i + 1}`}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  objectPosition: "top center",
                  display: "block"
                }}
              />
              
              {/* Hover overlay hint */}
              <div style={{
                position: "absolute",
                inset: 0,
                background: isActive ? "transparent" : "rgba(0,0,0,0.3)",
                transition: "background 0.2s"
              }} />
            </div>
          );
        })}
      </div>

      {/* Big Banner Area */}
      <div className="landing-banner-wrapper" style={{
        position: "relative",
        width: "100%",
        backgroundColor: "#0a0a0c",
        borderRadius: 16,
        overflow: "hidden",
        border: "2px solid #f97316",
        boxShadow: "0 4px 24px rgba(249, 115, 22, 0.3), 0 20px 50px -10px rgba(0,0,0,0.6)"
      }}>
        {SLIDES.map((slide, i) => {
          const isActive = i === activeIndex;
          return (
            <div 
              key={slide.id}
              style={{
                display: isActive ? "block" : "none",
                width: "100%",
                position: "relative"
              }}
            >
              <img 
                src={slide.banner} 
                alt={slide.alt}
                style={{
                  width: "100%",
                  height: "auto",
                  objectFit: "contain",
                  display: "block"
                }}
              />
              
              {/* View More Link - Inside Banner */}
              <a 
                href={`/wallet/${slide.wallet}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  position: "absolute",
                  bottom: 30,
                  left: "50%",
                  transform: "translateX(-50%)",
                  fontSize: 20,
                  fontWeight: 600,
                  color: "#fff",
                  textDecoration: "underline",
                  textUnderlineOffset: 4,
                  cursor: "pointer",
                  transition: "color 0.2s",
                  padding: "8px 16px",
                  backgroundColor: "rgba(0,0,0,0.5)",
                  borderRadius: 8
                }}
                onMouseEnter={(e) => e.target.style.color = "#f97316"}
                onMouseLeave={(e) => e.target.style.color = "#fff"}
              >
                View more 👉
              </a>
            </div>
          );
        })}
      </div>
    </div>
  );
}
