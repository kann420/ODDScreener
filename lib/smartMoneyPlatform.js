import {
  addClient as addOpinionSmartMoneyClient,
  getLatest as getOpinionSmartMoneyLatest,
  getSmartMoneyHubStatus as getOpinionSmartMoneyHubStatus,
  startSmartMoneyHub as startOpinionSmartMoneyHub,
} from "@/lib/smartMoneyHub";
import {
  addPredictFunSmartMoneyClient,
  getPredictFunSmartMoneyHubStatus,
  getPredictFunSmartMoneyLatest,
  getPredictFunSmartMoneyMarketMeta,
  startPredictFunSmartMoneyHub,
} from "@/lib/predictfunSmartMoneyHub";

export function normalizeSmartMoneyPlatform(platform) {
  return String(platform || "opinion").toLowerCase() === "predictfun" ? "predictfun" : "opinion";
}

export function getSmartMoneyPlatformAdapter(platform) {
  const normalized = normalizeSmartMoneyPlatform(platform);

  if (normalized === "predictfun") {
    return {
      platform: normalized,
      start: startPredictFunSmartMoneyHub,
      addClient: addPredictFunSmartMoneyClient,
      getLatest: getPredictFunSmartMoneyLatest,
      getStatus: getPredictFunSmartMoneyHubStatus,
      getMarketMeta: getPredictFunSmartMoneyMarketMeta,
    };
  }

  return {
    platform: normalized,
    start: startOpinionSmartMoneyHub,
    addClient: addOpinionSmartMoneyClient,
    getLatest: getOpinionSmartMoneyLatest,
    getStatus: getOpinionSmartMoneyHubStatus,
    getMarketMeta: () => null,
  };
}
