---

name: smart-money-persistence

description: Smart Money local persistence (SQLite/JSON), consistent DB path env var, prune by ms timestamps, and safe migrations without wiping history.

---



\## When to use

\- Storing recent trades and showing last 24h history

\- Fixing "history suddenly empty" after deploy/local restart

\- Fixing ts seconds vs ms issues that cause prune to delete everything



\## Rules

\- Keep DB path consistent via env var (example: SMART\_MONEY\_DB\_PATH). Add fallback if renamed.

\- Store trade timestamps in milliseconds.

\- Prune logic must compare ms vs ms only.



\## Workflow

1\) On write: normalize `ts` to ms with a guard:

&nbsp;  - if ts < 10^12 => seconds => convert \* 1000

2\) On read: return ordered by ts desc.

3\) On prune: delete where ts < nowMs - 24hMs (or user selected window).

4\) Add debug endpoint:

&nbsp;  - total rows

&nbsp;  - distinct markets tracked

&nbsp;  - min/max ts



\## Output

\- Provide a patch that includes the ts-guard + debug summary route.



