/**
 * Deterministic assertion functions for evals.
 *
 * Provider-agnostic: every check here runs offline on a plain string
 * (plus an optional RAG-sources capability). No API keys, no cloud calls.
 *
 * Ported and generalized from a production chatbot eval suite. The RAG
 * assertions operate on an OPTIONAL `sources` capability — if the target
 * adapter does not return sources, those assertions are reported as skipped
 * rather than silently passing or failing.
 */

export type AssertionType =
  | 'contains'
  | 'contains_any'
  | 'not_contains'
  | 'max_words'
  | 'min_words'
  | 'regex'
  | 'language'
  | 'rag_used'
  | 'rag_not_used'
  | 'source_includes'
  | 'source_not_includes'
  | 'llm_judge'

export interface Assertion {
  type: AssertionType
  /** For contains / not_contains / max_words / min_words / source_(not_)includes */
  value?: string | number
  /** For contains_any */
  values?: string[]
  /** For language */
  expected?: 'en' | 'es'
  /** For regex */
  pattern?: string
  flags?: string
  /** For llm_judge (see ../src/judge.ts) */
  criteria?: string
  /** For llm_judge — score >= threshold passes (default 0.7) */
  threshold?: number
}

/** One retrieved RAG source. `section_id` is optional. */
export interface RagSource {
  article_id: string
  section_id?: string
}

/** What a target adapter returns. `sources` is the optional RAG capability. */
export interface EvalResult {
  text: string
  sources?: RagSource[]
}

export interface AssertionResult {
  passed: boolean
  /** True when the assertion could not be evaluated (e.g. RAG capability off,
   *  or an llm_judge with no configured provider). Skipped != failed. */
  skipped?: boolean
  assertion: Assertion
  reason: string
}

// ── individual checks (exported for direct use / testing) ──────────────────

/** Response contains an exact substring (case-insensitive). */
export function assertContains(response: string, value: string): boolean {
  return response.toLowerCase().includes(value.toLowerCase())
}

/** Response contains at least one of the values (case-insensitive). */
export function assertContainsAny(response: string, values: string[]): boolean {
  return values.some((v) => response.toLowerCase().includes(v.toLowerCase()))
}

/** Response does NOT contain a substring (case-insensitive). */
export function assertNotContains(response: string, value: string): boolean {
  return !response.toLowerCase().includes(value.toLowerCase())
}

/** Word count (whitespace-split). */
export function wordCount(response: string): number {
  const t = response.trim()
  return t === '' ? 0 : t.split(/\s+/).length
}

export function assertMaxWords(response: string, maxWords: number): boolean {
  return wordCount(response) <= maxWords
}

export function assertMinWords(response: string, minWords: number): boolean {
  return wordCount(response) >= minWords
}

/** Response matches a regex. Invalid patterns fail (they don't throw). */
export function assertRegex(response: string, pattern: string, flags = ''): boolean {
  try {
    return new RegExp(pattern, flags).test(response)
  } catch {
    return false
  }
}

const SPANISH_STOPWORDS = new Set([
  'el', 'la', 'los', 'las', 'de', 'en', 'que', 'es', 'un', 'una', 'mi', 'con',
  'para', 'por', 'del', 'al', 'como', 'más', 'pero', 'su', 'sus', 'este',
  'esta', 'estos', 'estas', 'he', 'ha', 'años',
])
const ENGLISH_STOPWORDS = new Set([
  'the', 'is', 'are', 'was', 'were', 'have', 'has', 'had', 'my', 'your',
  'with', 'for', 'and', 'but', 'or', 'from', 'this', 'that', 'these', "i'm",
  "i've", 'years',
])

/**
 * Lightweight language heuristic: counts en vs es stopwords.
 * ponytail: stopword heuristic, good enough for eval gates; swap for a real
 * language-id model only if a test set proves it wrong.
 */
export function assertLanguage(response: string, expected: 'en' | 'es'): boolean {
  const words = response.toLowerCase().split(/\s+/)
  let es = 0
  let en = 0
  for (const w of words) {
    if (SPANISH_STOPWORDS.has(w)) es++
    if (ENGLISH_STOPWORDS.has(w)) en++
  }
  return expected === 'es' ? es > en : en > es
}

// ── dispatcher ─────────────────────────────────────────────────────────────

/**
 * Run one deterministic assertion against a target result.
 *
 * `llm_judge` is NOT handled here (it is async and provider-backed — the
 * runner routes it to ../src/judge.ts). If passed here it is reported skipped.
 */
export function runAssertion(result: EvalResult, assertion: Assertion): AssertionResult {
  const response = result.text
  const sources = result.sources
  const ragSkipped = (): AssertionResult => ({
    passed: false,
    skipped: true,
    assertion,
    reason: 'RAG capability not enabled (target returned no sources)',
  })

  switch (assertion.type) {
    case 'contains': {
      const passed = assertContains(response, assertion.value as string)
      return { passed, assertion, reason: passed ? `Contains "${assertion.value}"` : `Missing "${assertion.value}"` }
    }
    case 'contains_any': {
      const passed = assertContainsAny(response, assertion.values as string[])
      return { passed, assertion, reason: passed ? `Contains one of: ${assertion.values?.join(', ')}` : `Missing all of: ${assertion.values?.join(', ')}` }
    }
    case 'not_contains': {
      const passed = assertNotContains(response, assertion.value as string)
      return { passed, assertion, reason: passed ? `Does not contain "${assertion.value}"` : `Unexpectedly contains "${assertion.value}"` }
    }
    case 'max_words': {
      const wc = wordCount(response)
      const passed = wc <= (assertion.value as number)
      return { passed, assertion, reason: passed ? `Word count ${wc} <= ${assertion.value}` : `Word count ${wc} exceeds max ${assertion.value}` }
    }
    case 'min_words': {
      const wc = wordCount(response)
      const passed = wc >= (assertion.value as number)
      return { passed, assertion, reason: passed ? `Word count ${wc} >= ${assertion.value}` : `Word count ${wc} below min ${assertion.value}` }
    }
    case 'regex': {
      const passed = assertRegex(response, assertion.pattern as string, assertion.flags)
      return { passed, assertion, reason: passed ? `Matches /${assertion.pattern}/${assertion.flags ?? ''}` : `Does not match /${assertion.pattern}/${assertion.flags ?? ''}` }
    }
    case 'language': {
      const passed = assertLanguage(response, assertion.expected as 'en' | 'es')
      return { passed, assertion, reason: passed ? `Language detected as ${assertion.expected}` : `Language is not ${assertion.expected}` }
    }

    // ── optional RAG capability ──
    case 'rag_used': {
      if (sources === undefined) return ragSkipped()
      const passed = sources.length > 0
      return { passed, assertion, reason: passed ? `RAG used (${sources.length} sources)` : 'RAG was NOT used (no sources)' }
    }
    case 'rag_not_used': {
      if (sources === undefined) return ragSkipped()
      const passed = sources.length === 0
      return { passed, assertion, reason: passed ? 'RAG not used (as expected)' : `RAG unexpectedly used (${sources.map((s) => s.article_id).join(', ')})` }
    }
    case 'source_includes': {
      if (sources === undefined) return ragSkipped()
      const passed = sources.some((s) => s.article_id === assertion.value)
      return { passed, assertion, reason: passed ? `Sources include "${assertion.value}"` : `Sources missing "${assertion.value}" (got: ${sources.map((s) => s.article_id).join(', ') || 'none'})` }
    }
    case 'source_not_includes': {
      if (sources === undefined) return ragSkipped()
      const passed = !sources.some((s) => s.article_id === assertion.value)
      return { passed, assertion, reason: passed ? `Sources exclude "${assertion.value}" (correct)` : `Sources unexpectedly include "${assertion.value}"` }
    }

    case 'llm_judge':
      return { passed: false, skipped: true, assertion, reason: 'llm_judge is routed to the LLM judge by the runner' }

    default:
      return { passed: false, assertion, reason: `Unknown assertion type: ${(assertion as Assertion).type}` }
  }
}
