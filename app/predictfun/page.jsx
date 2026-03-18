import { Suspense } from "react";
import { DiscoverPageSkeleton } from "@/components/SkeletonLoader";
import { PredictFunContent } from "./PredictFunContent";

export const dynamic = "force-dynamic";

export default function PredictFunPage() {
  return (
    <div className="col" style={{ gap: 12, paddingBottom: 72 }}>
      <Suspense fallback={<DiscoverPageSkeleton rowCount={10} tabs={['NEW', 'TRENDING', 'BOOST', 'ALL']} />}>
        <PredictFunContent />
      </Suspense>
    </div>
  );
}
