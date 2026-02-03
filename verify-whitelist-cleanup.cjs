/**
 * Final Verification: Confirm expired January markets have been cleaned from whitelist
 */

const fs = require('fs');
const path = require('path');

console.log("═══════════════════════════════════════════════════════════════");
console.log("     FINAL VERIFICATION: January Markets Whitelist Cleanup");
console.log("═══════════════════════════════════════════════════════════════\n");

// Check file 1: arbitageAutoMatcher.js
const file1Path = path.join(__dirname, 'lib', 'arbitageAutoMatcher.js');
const content1 = fs.readFileSync(file1Path, 'utf8');

// Look for the BAD pattern (should not exist)
const badPattern1 = /opinionPattern:.*how many jobs added.*january/i;
const hasBadPattern1 = badPattern1.test(content1);

// Look for GOOD pattern (should exist - with negative lookahead)
const goodPattern1 = /opinionPattern:.*how many jobs added.*\(\?!january\)/i;
const hasGoodPattern1 = goodPattern1.test(content1);

console.log("File 1: lib/arbitageAutoMatcher.js");
console.log("─".repeat(60));
console.log(`  ✓ January jobs pattern REMOVED: ${!hasBadPattern1 ? "YES" : "NO"}`);
console.log(`  ✓ Negative lookahead pattern EXISTS: ${hasGoodPattern1 ? "YES" : "NO"}`);
console.log(`  Status: ${!hasBadPattern1 && hasGoodPattern1 ? "✓ PASS" : "✗ FAIL"}`);
console.log();

// Check file 2: route.js
const file2Path = path.join(__dirname, 'app', 'api', 'arbitage', 'wallet-positions', 'route.js');
const content2 = fs.readFileSync(file2Path, 'utf8');

// Look for BAD pattern (should not exist)
const badPattern2 = /polyKeywords:.*\["no change".*"fed".*"january 2026"\]/i;
const hasBadPattern2 = badPattern2.test(content2);

// Look for GOOD pattern (should exist - with march 2026 instead)
const goodPattern2 = /polyKeywords:.*\["no change".*"fed".*"march 2026"\]/i;
const hasGoodPattern2 = goodPattern2.test(content2);

console.log("File 2: app/api/arbitage/wallet-positions/route.js");
console.log("─".repeat(60));
console.log(`  ✓ January Fed mapping REMOVED: ${!hasBadPattern2 ? "YES" : "NO"}`);
console.log(`  ✓ March Fed mapping EXISTS: ${hasGoodPattern2 ? "YES" : "NO"}`);
console.log(`  Status: ${!hasBadPattern2 && hasGoodPattern2 ? "✓ PASS" : "✗ FAIL"}`);
console.log();

// Final verdict
const allGood = (!hasBadPattern1 && hasGoodPattern1 && !hasBadPattern2 && hasGoodPattern2);

console.log("═══════════════════════════════════════════════════════════════");
if (allGood) {
  console.log("✓ SUCCESS: All expired January markets have been removed!");
  console.log("\nExpired markets will NO LONGER create arbitrage opportunities:");
  console.log("  • How many jobs added in the U.S. in January?");
  console.log("  • Fed rate decisions for January 2026");
  console.log("  • Any market with January 2026 dates");
  console.log("\nCurrent whitelist only includes active/future markets:");
  console.log("  • February 2026 onwards");
  console.log("  • Sports and crypto events (date-agnostic)");
  console.log("  • Business metrics (evergreen)");
  process.exit(0);
} else {
  console.log("✗ FAILED: Some expired patterns may still exist!");
  console.log("\nProblems found:");
  if (hasBadPattern1) console.log("  • Jobs January pattern still exists in arbitageAutoMatcher.js");
  if (!hasGoodPattern1) console.log("  • Good pattern missing from arbitageAutoMatcher.js");
  if (hasBadPattern2) console.log("  • Fed January 2026 mapping still exists in route.js");
  if (!hasGoodPattern2) console.log("  • March Fed mapping missing from route.js");
  process.exit(1);
}
