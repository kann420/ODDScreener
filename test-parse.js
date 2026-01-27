// Test full flow
const clobTokenIds = '["44887169701994335927823089621118076056870238093278517619124422906156550392335", "57728890528615343651563034819317281053592421758468004253497912736179536297476"]';

function parseMaybeJsonArray(v) {
  if (!v) return null;
  if (Array.isArray(v)) return v;
  if (typeof v !== "string") return null;

  try {
    const j = JSON.parse(v);
    if (Array.isArray(j)) return j;
  } catch {}

  const s = v.trim().replace(/^\[/, "").replace(/\]$/, "");
  if (!s) return null;
  return s
    .split(",")
    .map((x) => x.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
}

function getClobTokenIds(gammaMarket) {
  return (
    parseMaybeJsonArray(gammaMarket?.clobTokenIds) ||
    parseMaybeJsonArray(gammaMarket?.clob_token_ids) ||
    null
  );
}

// Simulate market object as received from API
const market = {
  clobTokenIds: clobTokenIds, // This is a string!
  outcomes: '["Yes", "No"]'
};

console.log("market.clobTokenIds:", market.clobTokenIds);
console.log("typeof:", typeof market.clobTokenIds);

// Direct access (WRONG - this is what debug log was doing)
console.log("Direct access [0]:", market.clobTokenIds[0]); // Should be "["!
console.log("Direct access [1]:", market.clobTokenIds[1]); // Should be "\""!

// Proper access via getClobTokenIds
const tokenIds = getClobTokenIds(market);
console.log("Via getClobTokenIds:", tokenIds);
console.log("tokenIds[0]:", tokenIds?.[0]);
console.log("tokenIds[1]:", tokenIds?.[1]);
