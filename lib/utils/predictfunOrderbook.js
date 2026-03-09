function normalizeDecimalPrecision(decimalPrecision, fallback = 2) {
  const parsed = Number(decimalPrecision);
  if (!Number.isInteger(parsed) || parsed < 0) return fallback;
  return parsed;
}

function normalizeRawLevels(levels) {
  if (!Array.isArray(levels)) return [];

  return levels
    .map((level) => {
      const price = Number(Array.isArray(level) ? level[0] : level?.price);
      const shares = Number(
        Array.isArray(level)
          ? level[1]
          : (level?.shares ?? level?.size ?? level?.amount ?? level?.qty)
      );

      if (!Number.isFinite(price) || !Number.isFinite(shares) || shares <= 0) {
        return null;
      }

      return [price, shares];
    })
    .filter(Boolean);
}

function sortBidLevels(levels) {
  return [...levels].sort((a, b) => b[0] - a[0]);
}

function sortAskLevels(levels) {
  return [...levels].sort((a, b) => a[0] - b[0]);
}

function computeTotalLiquidity(rawBids, rawAsks) {
  return [...rawBids, ...rawAsks].reduce((sum, [, shares]) => sum + shares, 0);
}

function computeNotional(levels) {
  return levels.reduce((sum, [price, shares]) => sum + (price * shares), 0);
}

function mapBookEntries(levels) {
  return levels.map(([price, shares]) => ({
    price,
    shares,
    total: price * shares,
  }));
}

function buildSnapshot({ bids, asks, rawBids, rawAsks, totalLiquidity }) {
  const bidEntries = mapBookEntries(bids);
  const askEntries = mapBookEntries(asks);

  return {
    bids: bidEntries,
    asks: askEntries,
    rawBids: bids,
    rawAsks: asks,
    bestBid: bidEntries[0]?.price ?? null,
    bestAsk: askEntries[0]?.price ?? null,
    bestBidSize: bidEntries[0]?.shares ?? 0,
    bestAskSize: askEntries[0]?.shares ?? 0,
    bidNotional: computeNotional(bids),
    askNotional: computeNotional(asks),
    totalLiquidity,
    sourceBids: rawBids,
    sourceAsks: rawAsks,
  };
}

export function complementYesPrice(price, decimalPrecision = 2) {
  if (!Number.isFinite(Number(price))) return null;

  const precision = normalizeDecimalPrecision(decimalPrecision, 2);
  const scale = 10 ** precision;
  const yesInt = Math.round(Number(price) * scale);
  return (scale - yesInt) / scale;
}

export function buildPredictFunSideSnapshot(orderbook, { side = "yes", decimalPrecision = 2 } = {}) {
  const precision = normalizeDecimalPrecision(decimalPrecision, 2);
  const rawYesBids = sortBidLevels(normalizeRawLevels(orderbook?.bids));
  const rawYesAsks = sortAskLevels(normalizeRawLevels(orderbook?.asks));
  const totalLiquidity = computeTotalLiquidity(rawYesBids, rawYesAsks);

  if (side === "no") {
    const noBids = sortBidLevels(
      rawYesAsks
        .map(([price, shares]) => [complementYesPrice(price, precision), shares])
        .filter(([price, shares]) => Number.isFinite(price) && Number.isFinite(shares))
    );
    const noAsks = sortAskLevels(
      rawYesBids
        .map(([price, shares]) => [complementYesPrice(price, precision), shares])
        .filter(([price, shares]) => Number.isFinite(price) && Number.isFinite(shares))
    );

    return buildSnapshot({
      bids: noBids,
      asks: noAsks,
      rawBids: rawYesBids,
      rawAsks: rawYesAsks,
      totalLiquidity,
    });
  }

  return buildSnapshot({
    bids: rawYesBids,
    asks: rawYesAsks,
    rawBids: rawYesBids,
    rawAsks: rawYesAsks,
    totalLiquidity,
  });
}
