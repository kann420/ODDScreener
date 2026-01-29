"use client";

/**
 * Skeleton Loader Components
 * Hiển thị placeholder giống layout thực khi đang load data
 */

// Single market row skeleton - matches MarketRowV2 layout
export function MarketRowSkeleton() {
  return (
    <div className="market-row skeleton-row" style={{
      display: 'flex',
      alignItems: 'center',
      padding: '12px 16px',
      borderBottom: '1px solid var(--border)',
      gap: '16px',
      animation: 'skeleton-pulse 1.5s ease-in-out infinite',
    }}>
      {/* Market Icon Placeholder */}
      <div className="skeleton-box" style={{
        width: '40px',
        height: '40px',
        borderRadius: '8px',
        background: 'rgba(255,255,255,0.06)',
        flexShrink: 0,
      }} />
      
      {/* Market Title & Info */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <div className="skeleton-box" style={{
          width: '70%',
          maxWidth: '300px',
          height: '16px',
          borderRadius: '4px',
          background: 'rgba(255,255,255,0.08)',
        }} />
        <div className="skeleton-box" style={{
          width: '40%',
          maxWidth: '150px',
          height: '12px',
          borderRadius: '4px',
          background: 'rgba(255,255,255,0.05)',
        }} />
      </div>

      {/* Chart Placeholder */}
      <div className="skeleton-box" style={{
        width: '120px',
        height: '40px',
        borderRadius: '6px',
        background: 'rgba(255,255,255,0.06)',
        flexShrink: 0,
      }} />

      {/* Chance */}
      <div className="skeleton-box" style={{
        width: '60px',
        height: '24px',
        borderRadius: '6px',
        background: 'rgba(255,255,255,0.08)',
        flexShrink: 0,
      }} />

      {/* Volume */}
      <div className="skeleton-box" style={{
        width: '80px',
        height: '20px',
        borderRadius: '4px',
        background: 'rgba(255,255,255,0.06)',
        flexShrink: 0,
      }} />

      {/* Expires */}
      <div className="skeleton-box" style={{
        width: '70px',
        height: '20px',
        borderRadius: '4px',
        background: 'rgba(255,255,255,0.06)',
        flexShrink: 0,
      }} />
    </div>
  );
}

// Tab bar skeleton - matches NEW/HOT/TRENDING/BONUS/ALL tabs
export function TabBarSkeleton() {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '0 4px',
    }}>
      {['NEW', 'HOT', 'TRENDING', 'BONUS', 'ALL'].map((tab, i) => (
        <div key={tab} className="skeleton-box" style={{
          padding: '8px 16px',
          borderRadius: '8px',
          background: i === 0 ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.05)',
          animation: 'skeleton-pulse 1.5s ease-in-out infinite',
          animationDelay: `${i * 0.1}s`,
        }}>
          <span style={{ 
            opacity: 0.6, 
            fontSize: '13px', 
            fontWeight: 600,
            color: 'var(--muted)',
          }}>{tab}</span>
        </div>
      ))}
      
      {/* Search bar placeholder */}
      <div style={{ flex: 1, minWidth: '200px', maxWidth: '400px', marginLeft: '12px' }}>
        <div className="skeleton-box" style={{
          width: '100%',
          height: '36px',
          borderRadius: '8px',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid var(--border)',
        }} />
      </div>
    </div>
  );
}

// Table header skeleton
export function TableHeaderSkeleton() {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      padding: '10px 16px',
      borderBottom: '1px solid var(--border)',
      color: 'var(--muted)',
      fontSize: '12px',
      fontWeight: 600,
      gap: '16px',
    }}>
      <span style={{ flex: 1 }}>Market</span>
      <span style={{ width: '120px', textAlign: 'center' }}>Chart</span>
      <span style={{ width: '60px', textAlign: 'center' }}>Chance</span>
      <span style={{ width: '80px', textAlign: 'center' }}>Volume (24h)</span>
      <span style={{ width: '70px', textAlign: 'center' }}>Expires</span>
    </div>
  );
}

// Full page skeleton - complete discover page loading state
export function DiscoverPageSkeleton({ rowCount = 10 }) {
  return (
    <div className="col" style={{ gap: 12, paddingBottom: 72 }}>
      {/* Main market list panel */}
      <div className="panel" style={{ overflow: 'hidden' }}>
        {/* Tabs */}
        <div style={{ 
          padding: '14px 16px',
          borderBottom: '1px solid var(--border)',
        }}>
          <TabBarSkeleton />
        </div>

        {/* Table header */}
        <TableHeaderSkeleton />

        {/* Market rows */}
        <div>
          {Array.from({ length: rowCount }, (_, i) => (
            <MarketRowSkeleton key={i} />
          ))}
        </div>

        {/* Loading indicator */}
        <div style={{
          padding: '20px',
          textAlign: 'center',
          color: 'var(--muted)',
          fontSize: '13px',
        }}>
          Loading...
        </div>

        {/* Footer count */}
        <div style={{
          padding: '12px 16px',
          borderTop: '1px solid var(--border)',
          textAlign: 'center',
          color: 'var(--muted)',
          fontSize: '12px',
        }}>
          <span className="skeleton-box" style={{
            display: 'inline-block',
            width: '100px',
            height: '14px',
            borderRadius: '4px',
            background: 'rgba(255,255,255,0.06)',
          }} />
        </div>
      </div>

      {/* CSS Animation */}
      <style jsx global>{`
        @keyframes skeleton-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}

export default DiscoverPageSkeleton;
