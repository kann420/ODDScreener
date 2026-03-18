import PredictFunDetailView from "@/components/PredictFunDetailView";
import { getPredictFunMarketShell } from "@/lib/predictfunDetail";

export const dynamic = "force-dynamic";

export default async function PredictFunMarketPage({ params }) {
  const marketId = params?.marketId;
  const detail = await getPredictFunMarketShell(marketId);

  if (!detail) {
    return (
      <div className="panel" style={{ padding: 16 }}>
        <div style={{ fontSize: 18, fontWeight: 900 }}>Predict.fun market not found</div>
        <p className="muted" style={{ marginTop: 8 }}>
          Failed to load market #{marketId}.
        </p>
        <div style={{ marginTop: 12 }}>
          <a className="btn" href="/predictfun">
            Back to Predict.fun
          </a>
        </div>
      </div>
    );
  }

  return <PredictFunDetailView initialDetail={detail} />;
}
