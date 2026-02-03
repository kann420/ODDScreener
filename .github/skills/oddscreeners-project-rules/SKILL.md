---

name: oddscreeners-project-rules

description: Global rules for ODDScreeners. Next.js app router. Never store API keys in code (env only). Keep timestamps in ms. English UI copy style.

---



\## Always follow these rules

\- NEVER commit API keys or secrets. Use environment variables only (process.env.\*).

\- Treat all timestamps as milliseconds (ms). Do not mix seconds vs ms.

\- Website content is 100% English. Use simple crypto-native wording (no complex IELTS words).

\- When unsure, ask for a concrete example (endpoint, payload, log) and mark assumptions clearly.



\## Coding conventions

\- Prefer small, testable functions.

\- Add guardrails (runtime checks) for tricky data: ts units, missing IDs, empty arrays.

\- For network calls: timeout + retry/backoff for transient errors.

\- Log with clear prefixes: \[Discover], \[Arb], \[SmartMoney], \[Opinion], \[Poly].



\## PR / patch style (even when local)

\- Provide full file if changes are large.

\- Otherwise provide minimal diff + exact file paths.



