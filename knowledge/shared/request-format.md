# Request format and how agents report back

A request is a folder `requests/<ID>/` with:
- `request.json`: `id`, `title`, `body`, `reporter`, `backend`, `status`, `kind` (report|export|question|data_task|change_request), `size` (S|M|L), `writes`, `worker`, `subject {businessIds, businessNames, periods, accounts}`, `done[]`, `gates {1,2}`, `loops {verify}`, `answers`, `pendingQuestions[]`, `attachments[]`, `proposals[]` (statuses), `children[]`, `parentId`, `runs[]`.
- `comments.jsonl`: `{at, author, stage, body}` per line.
- `artifacts/`: what agents produce; `attachments/` (from the requester, read-only), `data/` (pulled responses), `deliverables/` (what the requester gets), `receipts.jsonl` (every call, written by the HTTP tool).

## How an agent must end its run
Finish with a single fenced block tagged `lab-result` containing JSON. The orchestrator parses it; everything before it is treated as the comment on the request. Example:

```lab-result
{"status":"ok","summary":"Flux workbook and memo written; totals tie to Dime's P&L for both months.","artifacts":["deliverables/flux-aug-sep-2026.xlsx","deliverables/flux-memo.md","work.md"],"questions":[]}
```

Fields:
- `status`: `ok` | `needs_input` | `blocked` | `fail`
- `summary`: one to three plain sentences.
- `artifacts`: files written under `artifacts/` (relative names).
- `questions`: for `needs_input`, at most three questions a human must answer.
- Intake adds `kind`, `size`, `writes`, `worker`, `subject`, `done`. The Planner adds `size`, `writes`. The Verifier adds `verdict` (`pass` | `fail`).

Write artifacts with the Write tool into the absolute `artifacts/` path the prompt gives you (deliverables through the export tool, proposals through the HTTP tool's `propose`).
