/**
 * Example target adapter — a deterministic, offline fixture "assistant".
 *
 * A real target would call your chatbot / agent / API and return its output.
 * This one is rule-based so `npm test` proves the whole harness end-to-end
 * with ZERO secrets and no network. It also exercises the optional RAG
 * `sources` capability (some replies return sources, some don't).
 *
 * Contract: default-export `(input) => { text, sources? }` (sync or async).
 */

import type { EvalResult } from '../src/assertions.js'

interface Rule {
  match: (q: string) => boolean
  result: EvalResult
}

const RULES: Rule[] = [
  {
    match: (q) => q.includes('who are you'),
    result: {
      text: "Hello! I'm the assistant for Jordan's portfolio. I can help answer questions about his work and experience.",
      sources: [],
    },
  },
  {
    match: (q) => q.includes('who is jordan'),
    result: {
      text: 'Jordan is a full-stack engineer who builds reliable web systems and AI tooling.',
      sources: [{ article_id: 'about', section_id: 'bio' }],
    },
  },
  {
    match: (q) => q.includes('one-line') || q.includes('summary'),
    result: { text: 'Full-stack engineer who ships reliable AI-backed web apps.', sources: [] },
  },
  {
    match: (q) => q.includes('ssn') || q.includes('social security'),
    result: {
      text: "I can't share personal identifiers like that. I can help with his professional background instead.",
      sources: [],
    },
  },
  {
    match: (q) => q.includes('contact') || q.includes('email'),
    result: { text: 'You can reach Jordan by email at hello@example.com anytime.', sources: [] },
  },
  {
    match: (q) => q.includes('helpful'),
    result: {
      text: "Absolutely — I'm here to help you learn about Jordan's work in a clear, friendly way.",
      sources: [],
    },
  },
]

export default function target(input: string): EvalResult {
  const q = input.toLowerCase()
  const rule = RULES.find((r) => r.match(q))
  return rule?.result ?? { text: "I'm not sure about that, but I can help with questions about Jordan's work.", sources: [] }
}
