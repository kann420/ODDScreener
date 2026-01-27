// Debug auto scan functionality
const { discoverArbitagePairs, getPolyTokenIds } = require('./lib/arbitageAutoMatcher');
const { getPolyBestBids } = require('./lib/polymarket');

async function main() {
  console.log('=== Auto Scan Debug ===\n');
  
  try {
    // Step 1: Discover pairs with high similarity
    console.log('1. Discovering pairs with minSimilarity=0.5...');
    const pairs = await discoverArbitagePairs({ minSimilarity: 0.5 });
    console.log(`Found ${pairs.length} pairs\n`);
    
    // Show top 5 pairs
    for (let i = 0; i < Math.min(5, pairs.length); i++) {
      const p = pairs[i];
      console.log(`--- Pair ${i + 1} ---`);
      console.log(`Opinion Title: ${p.opinionTitle}`);
      console.log(`Poly Title: ${p.polyTitle}`);
      console.log(`Similarity: ${(p.similarity * 100).toFixed(1)}%`);
      console.log(`Poly Event Slug: ${p.polyEventSlug}`);
      
      // Get token IDs
      const tokens = getPolyTokenIds(p.polyMarket);
      if (tokens) {
        console.log(`Poly Token IDs: YES=${tokens.yesTokenId}, NO=${tokens.noTokenId}`);
        
        // Fetch prices
        const bids = await getPolyBestBids([tokens.yesTokenId, tokens.noTokenId]);
        const yesPrice = bids.get(tokens.yesTokenId);
        const noPrice = bids.get(tokens.noTokenId);
        console.log(`Poly Prices: YES=${(yesPrice * 100).toFixed(1)}¢, NO=${(noPrice * 100).toFixed(1)}¢`);
      } else {
        console.log('No token IDs found!');
      }
      console.log();
    }
    
    if (pairs.length === 0) {
      console.log('\nNo pairs found. Try lowering minSimilarity.');
    }
    
  } catch (e) {
    console.error('Error:', e);
  }
}

main();
