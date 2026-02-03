---

name: oddscreeners-ui-ux-guidelines

description: UI/UX guidelines for ODDScreeners dashboard (Discover, Smart Money, Arbitrage, Wallet Tracker). Desktop-first with strong mobile optimization. Based on Vercel web design principles.

---



\## Purpose

Improve UI and UX quality of ODDScreeners without breaking logic, data flow, or performance.

This skill focuses on clarity, speed, and usability for trading dashboards.



\## Design philosophy

\- Dashboard-first, not marketing-first

\- Clarity > visual effects

\- Data density is allowed, confusion is not

\- Desktop power users + mobile quick checks



\## General UI rules

\- Follow Vercel-style web design principles:

&nbsp; - Clean layout

&nbsp; - Consistent spacing

&nbsp; - Clear typography

\- Avoid unnecessary animations

\- Avoid decorative UI that does not improve usability

\- Prefer simple transitions (hover, focus) only when useful



\## Typography

\- Use readable system fonts or existing project fonts

\- Font sizes:

&nbsp; - Table text: small but readable

&nbsp; - Section titles: clear hierarchy, not oversized

\- Avoid fancy fonts or decorative text



\## Spacing \& layout

\- Use consistent spacing scale (4 / 8 / 12 / 16 / 24)

\- Avoid tight stacking of UI elements

\- Group related controls visually (filters, actions, stats)

\- Use dividers or subtle background blocks instead of heavy borders



\## Color usage

\- Color is for meaning, not decoration:

&nbsp; - Green / red: price movement, PnL, arbitrage %

&nbsp; - Yellow / orange: warning, attention, early access

\- Avoid overusing bright colors

\- Background should stay neutral and low-contrast



\## Tables \& data-heavy UI

\- Tables are first-class UI components

\- Always consider:

&nbsp; - column alignment

&nbsp; - number formatting

&nbsp; - consistent units (%, $, ¢)

\- Highlight important columns subtly (bold, slightly brighter)

\- Avoid horizontal scroll on desktop if possible



\## Filters \& controls

\- Filters must be:

&nbsp; - easy to scan

&nbsp; - easy to reset

\- Group filters by purpose (price, volume, arb %, time)

\- Avoid hiding critical filters behind multiple clicks



\## Loading \& empty states

\- Always show loading states for async data

\- Use skeletons or lightweight placeholders

\- Empty state should explain:

&nbsp; - why it's empty

&nbsp; - what the user can do next



\## Error states

\- Errors must be visible but not scary

\- Use clear, short messages

\- Never expose raw stack traces to users



\## Mobile-specific rules

\- Mobile is for:

&nbsp; - quick scan

&nbsp; - checking opportunities

&nbsp; - monitoring positions

\- Do NOT try to fit full desktop tables on mobile

\- On mobile:

&nbsp; - Collapse tables into cards or stacked rows

&nbsp; - Reduce columns to the most important 2–3 values

&nbsp; - Keep action buttons large and thumb-friendly

\- Avoid horizontal scrolling whenever possible



\## Responsiveness

\- Desktop-first layout

\- Mobile layout must be intentionally designed, not auto-shrunk

\- Use breakpoints thoughtfully:

&nbsp; - Desktop: full tables and filters

&nbsp; - Tablet: reduced columns

&nbsp; - Mobile: card-based or simplified views



\## Performance UX

\- Avoid UI patterns that trigger excessive re-renders

\- Prefer stable layouts (no jumping when data updates)

\- Real-time data updates should feel smooth, not noisy



\## What NOT to do

\- Do not redesign UX flow without explicit instruction

\- Do not change business logic to "improve UX"

\- Do not add animations, charts, or visuals unless requested

\- Do not remove data just to make UI look cleaner



\## Output expectations

When using this skill:

\- Propose UI changes with reasoning

\- Prefer incremental improvements

\- Preserve existing structure unless asked otherwise

\- Respect current component and state architecture



## Strictness rules (ODDScreeners)
- Do not claim something is "following Vercel principles" unless you point to specific UI evidence.
- UI-only: do not require new backend data (ETA, new metrics) unless explicitly requested.
- Only mention file paths after confirming they exist in the workspace; otherwise say "likely files" and ask for confirmation.



## Scalability & Future-Proof UI (ODDScreeners)
- Assume the product will grow with more features, tabs, and data.
- Prefer modular UI patterns that can be extended without redesign:
  - Reusable panels
  - Config-driven tables
  - Flexible filter groups
- Avoid UI decisions that hard-code assumptions (fixed column counts, fixed layouts).
- Leave visual and spacing room for:
  - New filters
  - Additional columns
  - New wallet types or exchanges
- Design layouts that degrade gracefully when new features are added.






