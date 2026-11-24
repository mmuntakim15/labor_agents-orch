# Sandbox programs and gaps

## Rerun every sandbox program
A worker who found no compute verb for a calculation may have run a small
program through `sandbox.js run`. Each such run left a receipt
`{ kind: "compute", method: "SANDBOX", path: <programSha>, outFile: "data/<name>.json" }`
and a data file whose `trace.programSha` names the program stored under
`programs/<sha>.js`.

For every distinct `programSha` in receipts.jsonl:
1. `sandbox.js rerun --request <ID> --sha <programSha>` — it replays the stored program on the inputs the trace recorded and compares the output file byte for byte.
2. `identical: true` → the figures from that file are reproduced; cite the rerun receipt as the evidence.
3. `identical: false` → the done items that rest on that file **fail**. Quote `diff` (the first differing path) in the item's evidence. The usual causes are a program that read the clock without `asOf` in args, random order, or an input file the worker overwrote after the run (`inputChanged` names it).
4. A program you cannot rerun (not stored, hashes to a different name, refused on replay) fails the items that depend on it; a figure whose arithmetic cannot be replayed has no receipt.

Read the program text (Read `programs/<sha>.js`) when the request's wording
decides the arithmetic: a deterministic program can still compute the wrong
thing. A threshold, a sign, a date boundary that disagrees with the request
is a failing item with the line quoted.

You may `rerun`; you never `run` a new program, and you never edit one.

## Gap vocabulary
A Planner who could not express the request in the five primitives (pull,
compute, compare, propose, prove) blocked it with
`{ status: "blocked", gap: "read"|"compute"|"change"|"prove"|"input", detail }`
and `plan.json.gaps[]`. When you verify work on a request whose plan carries
non-blocking gaps, check that the deliverable says plainly what was not done
and why (the gap's `detail` in the requester's words); a deliverable that is
silent about a planned gap fails the prose item that covers completeness.
