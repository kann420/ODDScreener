---

name: oddscreeners-project-rules

description: Global rules for ODDScreeners. Next.js app router. Never store API keys in code (env only). Keep timestamps in ms. English UI copy style. Code quality standards.

---



\## Always follow these rules

\- NEVER commit API keys or secrets. Use environment variables only (process.env.\*).

\- Treat all timestamps as milliseconds (ms). Do not mix seconds vs ms.

\- Website content is 100% English. Use simple crypto-native wording (no complex IELTS words).

\- When unsure, ask for a concrete example (endpoint, payload, log) and mark assumptions clearly.

\- SPELL CHECK: Use "arbitrage" NOT "arbitage". Always double-check spelling before creating files/folders.



\## Coding conventions

\- Prefer small, testable functions.

\- Add guardrails (runtime checks) for tricky data: ts units, missing IDs, empty arrays.

\- For network calls: timeout + retry/backoff for transient errors.

\- Log with clear prefixes: \[Discover], \[Arb], \[SmartMoney], \[Opinion], \[Poly].



\## File size & component structure

\- MAX 300 lines per component file. If larger, split into subcomponents.

\- MAX 500 lines per utility/lib file. If larger, split by feature.

\- Extract reusable logic into hooks (useXxx.js) or utils.

\- One component = one responsibility. Don't mix data fetching + UI + state in same component.



\## Error handling (CRITICAL)

\- NEVER use empty catch blocks: `catch {}` or `catch { // ignore }`

\- Always log errors with context: `console.error("[Module] action failed:", error.message)`

\- For API routes: return meaningful error responses, not just 500.

\- Add fallback states for failed data fetches (show error UI, not blank).

\- Pattern to follow:

```javascript
try {
  // action
} catch (err) {
  console.error("[ModuleName] actionName failed:", err.message);
  // handle gracefully: return default, show error UI, or rethrow
}
```



\## Code consistency

\- Use camelCase for JS variables: `marketId`, not `market_id` or `MarketId`.

\- Use optional chaining consistently: `result?.data?.value ?? null`

\- Prefer nullish coalescing (??) over OR (||) for defaults.

\- Use consistent import aliases: `@/lib/`, `@/components/`, `@/app/`



\## DRY - Don't Repeat Yourself

\- Before writing new utility, check if similar exists in /lib.

\- Extract shared logic: DNS resolver, fetch helpers, cache utilities.

\- If copy-pasting code between files, extract to shared module.

\- Shared utilities location: `/lib/utils/` for generic, `/lib/` for feature-specific.



\## Testing requirements

\- Core business logic (engines, matchers, calculations) MUST have tests.

\- Test files: `*.test.js` next to source file OR in `__tests__/` folder.

\- Before refactoring core logic, write test first.

\- Minimum: test happy path + one error case.



\## TypeScript migration path

\- New files SHOULD use TypeScript (.ts/.tsx) when possible.

\- Add JSDoc types for existing JS files: @param, @returns, @typedef.

\- Critical types to define: Market, Position, Trade, ArbitrageOpportunity.

\- Create `/types/` folder for shared type definitions.



\## Performance considerations

\- Use sessionStorage/localStorage for client-side caching.

\- Add TTL (time-to-live) to all caches.

\- Implement pagination for lists > 50 items.

\- Use React.memo, useMemo, useCallback for expensive renders.

\- Lazy load heavy components with dynamic imports.



\## PR / patch style (even when local)

\- Provide full file if changes are large.

\- Otherwise provide minimal diff + exact file paths.

\- Include reason for change in commit message.

\- Review for typos before committing (especially folder/file names - they're hard to rename later).



