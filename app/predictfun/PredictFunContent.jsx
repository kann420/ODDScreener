import PredictFunListClient from "@/components/PredictFunListClient";
import { getPredictFunDiscoverPageState } from "@/lib/predictfunDiscover";

async function PredictFunContent() {
  const { error, markets, needsFullFetch } = await getPredictFunDiscoverPageState();

  if (error && (!markets || markets.length === 0)) {
    return (
      <div className="panel" style={{ padding: 14 }}>
        <p className="muted" style={{ marginTop: 8 }}>
          Failed to load Predict.fun markets. Please try again later.
        </p>
      </div>
    );
  }

  return (
    <PredictFunListClient
      initialMarkets={markets}
      needsFullFetch={needsFullFetch}
    />
  );
}

export { PredictFunContent };
