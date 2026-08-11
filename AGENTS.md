# eval-harness — setup / router

Provider-agnostic LLM eval + regression framework (assertions, pluggable judge, CI gate). MIT.

> **Work the Fable way.** Any model working here follows `~/all41n14lla/01-Identity/FABLE-WAY.md` — the voice, standards, and step-by-step method that make it feel like Fable regardless of model. Read it first.

## Commands
- `npm install && npm test` — offline assertion suite (no key)
- `npm run eval` · `npm run regression` — the gate (exits non-zero on regression)
