# eval-harness — setup / router

Provider-agnostic LLM eval + regression framework (assertions, pluggable judge, CI gate). MIT.

## Commands
- `npm install && npm test` — offline assertion suite (no key)
- `npm run eval` · `npm run regression` — the gate (exits non-zero on regression)
