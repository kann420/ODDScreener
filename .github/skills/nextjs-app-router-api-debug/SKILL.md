---

name: nextjs-app-router-api-debug

description: Debug Next.js App Router API routes (404, wrong folder placement), local vs deploy differences, and stable routing conventions.

---



\## When to use

\- API route works locally but 404 on deploy

\- Confusion between /pages/api vs /app/api

\- Duplicate route folders or wrong route.ts placement



\## Workflow

1\) Confirm route location:

&nbsp;  - app/api/<route>/route.ts

2\) Confirm method exports:

&nbsp;  - export async function GET/POST

3\) Confirm runtime:

&nbsp;  - node vs edge (if relevant)

4\) Add minimal smoke test:

&nbsp;  - /api/health returns ok + build version

5\) Add logging:

&nbsp;  - route hit

&nbsp;  - query params

&nbsp;  - upstream latency



\## Guardrails

\- Avoid circular imports from client components into route handlers.

\- Do not import secrets into client bundles.



\## Output

\- Provide exact file paths + final code for route.ts.



