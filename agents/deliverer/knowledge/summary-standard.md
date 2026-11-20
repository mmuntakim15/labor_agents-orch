# Summary standard (summary.md)

Written for the person who asked, in plain English, no tool or route names.

```
# <Request title>

<One sentence: what they are getting and the headline.>

## Files
- flux-aug-sep-2026.xlsx — open this first. P&L flux, one tab per month pair, totals tie to Dime's P&L.
- flux-memo.pdf — the five largest movements and their drivers.

## Headline figures
- Net income: August $11,902.10 → September $12,418.22 (+$516.12).
- Largest movement: Payroll +$2,795.74 (new hire started 9/8).

## Changes to the books
- 12 vendors proposed (P-1 to P-12, tier A); 11 approved and created by Mo on 2026-11-20; P-7 rejected (duplicate of "Acme Supply").
- or: none; this request did not change the books.

## Could not determine / needs a decision
- Two Ramp transactions have no Dime row and no sync error: a pull sync after 2026-10-01 would settle them.

## Where to look first
- The Summary tab of the workbook, then the memo. The evidence page lists every figure's source.
```

Rules: figures only from work.md and verify.md; dates as the requester would say them; no apologies, no process narrative.

The reader is an accountant at the client, not a developer. In summary.md and in the one-sentence summary of your result: no working-file names (work.md, verify.md, sheets.json), no route or tool names, no receipt ids, no run numbers, no "guard", "evaluator" or "artifact". Name a deliverable by the file name they will open (the .xlsx or the .pdf, never a .md), and name a source the way Dime's menu does ("the profit and loss report", "the AP aging").

## Formats

The requester opens deliverables in Excel or a PDF reader. You decide the format from the content and the request; a format the requester named always wins.

| What the file is | Format |
|---|---|
| Figures in rows and columns that someone will sort, filter, total or tie out (flux, aging, exception lists, tie-outs, registers) | `.xlsx` |
| Something to read, sign off or forward: a memo, an answer to a question, an explanation, a letter | `.pdf` |
| Rows meant to be imported into another system | `.csv` |
| A file Dime exported | leave it as Dime produced it |

- A `.md` or `.html` file is a draft, never a deliverable. Render it with `export.js pdf --name <same name>.pdf --from <the file>`; the pdf is the deliverable and the summary names the pdf.
- Do not turn a short answer into a workbook, and do not put a table of more than about 30 rows in a pdf: that table belongs in a workbook the pdf refers to.
- When a question was answered and the evidence is a list, deliver both: the pdf with the answer and the workbook with the rows.
- Mark the one file to open first with `export.js first --name <file> --why "<one line>"`: the workbook when they asked for figures, the pdf when they asked a question. The "Files" list in summary.md starts with that file.
