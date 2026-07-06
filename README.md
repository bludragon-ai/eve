# eval-harness

[![evals](https://github.com/bludragon-ai/eval-harness/actions/workflows/evals.yml/badge.svg)](https://github.com/bludragon-ai/eval-harness/actions/workflows/evals.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](https://nodejs.org)

A small, provider-agnostic eval harness for LLM and agent outputs. Point it at
any target function, describe what a good answer looks like with assertions,
and gate CI on a **committed baseline** so quality can't silently regress.

## What it is (and isn't)

- **11 deterministic assertion types** that run offline with no API key:
  `contains`, `contains_any`, `not_contains`, `max_words`, `min_words`,
  `regex`, `language`, plus an optional RAG capability
  (`rag_used`, `rag_not_used`, `source_includes`, `source_not_includes`).
- **1 pluggable LLM judge** (`llm_judge`) for subjective criteria (tone,
  helpfulness, faithfulness). Backend is chosen by env
  (`anthropic` | `openai` | `ollama`) and hit over plain `fetch` — **no SDK
  dependencies**. It returns a **0–1 rubric score + reason**, not just a
  boolean, and is **skipped** (never failed) when no provider is configured.
- **A real regression gate.** `baseline.json` records the expected pass/fail
  of every case; the gate exits non-zero the moment a case that used to pass
  now fails. This is the piece most eval scripts skip.

It is **not** a hosted platform, a tracing tool, or tied to any one model
vendor. It's the smallest thing that turns "looks good to me" into a CI gate.

## Install (3 steps)

```bash
git clone https://github.com/bludragon-ai/eval-harness && cd eval-harness
npm install
npm test          # runs green, offline, zero secrets
```

`npm test` runs the harness's own unit suite. To run the bundled example
evals end-to-end against the fixture target:

```bash
npm run eval          # deterministic assertion suite (offline)
npm run regression    # the gate: current vs examples/baseline.json
```

## Use it on your own target

1. Write a **target adapter** — any module that default-exports
   `(input) => { text, sources? }` (sync or async). Wrap your chatbot/agent/API here.

   ```ts
   // my-target.ts
   export default async function target(input: string) {
     const res = await fetch('http://localhost:3000/api/chat', {
       method: 'POST',
       body: JSON.stringify({ input }),
     })
     const data = await res.json()
     return { text: data.reply, sources: data.sources } // sources optional
   }
   ```

2. Write a **JSONL dataset** — one case per line:

   ```jsonl
   {"id": "greeting", "input": "hi", "expected_assertions": [{"type": "max_words", "value": 40}]}
   ```

3. Run it, and commit a baseline:

   ```bash
   tsx src/runner.ts     --dataset data.jsonl --target my-target.ts --threshold 0.9
   tsx src/regression.ts --dataset data.jsonl --target my-target.ts --baseline baseline.json --update  # once
   tsx src/regression.ts --dataset data.jsonl --target my-target.ts --baseline baseline.json           # in CI
   ```

The pass threshold is configurable (`--threshold`, default `1.0`); the runner
exits non-zero below it, and the regression gate exits non-zero on any
regression against the baseline.

## Enable the LLM judge

The judge is off until you configure a provider:

```bash
export EVAL_JUDGE_PROVIDER=anthropic   # anthropic | openai | ollama
export ANTHROPIC_API_KEY=...           # OPENAI_API_KEY for openai; ollama needs no key
export EVAL_JUDGE_MODEL=...            # optional override
```

Add `llm_judge` assertions to any case:

```json
{"type": "llm_judge", "criteria": "The response is polite and professional.", "threshold": 0.7}
```

When no key is present, `llm_judge` assertions are **skipped**, so the
deterministic suite still runs green in CI without secrets.

## CI

`.github/workflows/evals.yml` runs on every push to `main` and every PR:
typecheck → unit tests → assertion suite → regression gate. All offline.

## License

MIT © 2026 Jordan Truong
