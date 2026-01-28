import { Suspense } from "react";
import { DiscoverPageSkeleton } from "@/components/SkeletonLoader";
import { MarketsContent } from "./MarketsContent";

// ===== Enable Streaming SSR =====
// This allows the page shell to render immediately while data streams in
export const dynamic = "force-dynamic";

/**
 * Home Page with Streaming SSR
 * 
 * The page shell (skeleton) renders IMMEDIATELY, then the actual
 * market data streams in as it becomes available. This gives users
 * instant visual feedback instead of a blank screen.
 */
export default function Home() {
  return (
    <div className="col" style={{ gap: 12, paddingBottom: 72 }}>
      {/* 
        Suspense boundary with skeleton fallback
        - DiscoverPageSkeleton renders INSTANTLY
        - MarketsContent streams in when API calls complete
      */}
      <Suspense fallback={<DiscoverPageSkeleton rowCount={10} />}>
        <MarketsContent />
      </Suspense>
    </div>
  );
}
