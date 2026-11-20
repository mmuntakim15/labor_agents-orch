# Data fidelity — the numbers must match the product, digit for digit

The person reading you can open the product's own screen and compare. A
single digit of drift — a cent, a day, a currency symbol — and every other
number you have ever shown them becomes suspect. These rules exist because
one wrong figure costs more trust than a hundred slow answers.

## Figures are quoted, never derived

- **Present the product's numbers verbatim.** When a route returns a total,
  that total IS the answer. Never re-add line items to "check" it and never
  show your own sum in its place — if your sum disagrees, say so in a note
  and show the product's figure as the figure.
- **This is where the worst error this agent has made came from.** An Income
  Statement answer quoted revenue, gross profit, operating expenses and other
  income correctly from the response, then computed net income by adding them.
  The page said $89,157.32; the answer said ($17,007). Expense sections can
  carry a credit balance, so `opex.total` was negative — the product
  *subtracts* that total, which adds when it is negative, and the hand-rolled
  sum flipped the sign. `metrics.netIncome` was sitting in the same response
  the whole time. Sign conventions are the report's business, not yours.
- **Show every subtotal the screen shows**, not only the ones you can derive.
  The answer above never printed Operating Income, which is precisely why the
  six-figure gap was not obvious to anyone reading it.
- **No rounding in tables.** `54346.77` is `$54,346.77`, never `$54,347` and
  never `$54.3K`. Abbreviations are allowed in headline cards only, and the
  exact figure must appear in the table below.
- **Never convert currency.** Report amounts in the currency the route
  returned, with that currency's symbol. If someone asks for another
  currency, use the product's own multiCurrency routes — never your own rate.
- **Account names and codes verbatim.** "Cash – Operating Account" is not
  "Operating Cash". Copy names, codes and categories exactly as the response
  spelled them, dash and all.
- **Prefer the API over Mongo for anything a screen shows.** The API's
  numbers are the ones on the person's screen. Direct database reads are for
  questions with no route, for speed when a route is timing out, and for
  cross-checks — and when a Mongo figure differs from the route's figure,
  the route wins the presentation and the difference goes in a note.

## Dates are calendar dates, never arithmetic

**Never compute period boundaries in your head.** Months are 28, 29, 30 or
31 days; February depends on the leap rule; a year is 365 or 366. One day of
drift silently moves real transactions in or out of a period.

    node tools/api.js dates --month 2026-02     → 2026-02-01 … 2026-02-28 (28 days)
    node tools/api.js dates --month 2024-02     → 2024-02-01 … 2024-02-29 (leap)
    node tools/api.js dates --quarter 2026-Q1   → 2026-01-01 … 2026-03-31
    node tools/api.js dates --year 2024         → 366 days
    node tools/api.js dates --ytd 2026-08-21    → Jan 1 to that day, inclusive

Run it, then pass those exact strings to the route. "Last 30 days" is NOT a
month — when someone says "March", they mean March 1 through March 31, not a
30-day window ending today.

## Label figures with the period the data CAME FROM

Found live: someone asked for "the 2025 balance sheet", the newest saved 2025
period was February, and the answer presented February's figures labeled
"as of December 31, 2025". Every number was digit-perfect and the answer was
still wrong — a reader now believes these are year-end figures.

The label states the DATA'S period, never the QUESTION'S period:

- "as of February 28, 2025 — the most recent 2025 period on file", not
  "as of December 31, 2025".
- When the data covers less than what was asked, say so in the same breath:
  "Only January and February 2025 have been prepared; this is February's."
- A card or table title carries the real period too, not just the prose.

## Parameter names come from the appendix, never from memory

Every route catalog ends with an **appendix of machine-extracted parameter
names** — the exact `req.query` / `req.body` keys the controller reads. A
name not in that list is ignored silently: the route returns UNFILTERED data
that looks filtered. The traps that have already bitten:

- invoice/bill lists: `start` / `end` — not startDate/endDate
- realtime P&L: `currentStart` / `currentEnd` — not startDate/endDate
- realtime balance sheet: `currentTbId` / `priorTbId` — ids, no dates at all
- agings: `asOf`

## Verify before you present

After every filtered read, check the response against the request:
1. Date span of returned rows ⊆ the period you asked for.
2. Row count plausible for the period (12,000 rows for one month of a small
   business is a wrong filter, not a busy month).
3. Totals you present appear in the response — not computed by you.

If any check fails, fix the call. Never present data you have not verified
this way, and never paper over a mismatch.
