import { Suspense } from "react";
import { DiscoverPageSkeleton } from "@/components/SkeletonLoader";
import { MarketsContent } from "../MarketsContent";

export const dynamic = "force-dynamic";

export default function OpinionPage() {
  return (
    <div className="col" style={{ gap: 12, paddingBottom: 72 }}>
      <Suspense fallback={<DiscoverPageSkeleton rowCount={10} />}>
        <MarketsContent />
      </Suspense>
    </div>
  );
}
