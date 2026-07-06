/**
 * LLM-as-judge for subjective assertions (tone, helpfulness, faithfulness…).
 *
 * Two upgrades over the original binary Claude-only judge:
 *   1. Provider-agnostic. Backend is chosen by EVAL_JUDGE_PROVIDER
 *      (anthropic | openai | ollama). All three are hit over plain `fetch`,
 *      so the harness has ZERO SDK dependencies.
 *   2. Rubric score. The judge returns a 0-1 score + reason (not just a
 *      boolean). `pass` is score >= threshold (per-assertion, default 0.7),
 *      which makes borderline outputs visible instead of a hard yes/no.
 *
 * Optional by design: if the selected provider has no credentials,
 * `isJudgeConfigured()` is false and the runner SKIPS llm_judge assertions
 * (skipped != failed) so the deterministic suite still runs green offline.
 */

export type JudgeProvider = 'anthropic' | 'openai' | 'ollama'

export interface JudgeResult {
  /** 0.0 (fails criteria) … 1.0 (fully meets criteria). */
  score: number
  /** score >= threshold. */
  pass: boolean
  reason: string
}

export const DEFAULT_JUDGE_THRESHOLD = 0.7

export function judgeProvider(): JudgeProvider {
  const p = (process.env.EVAL_JUDGE_PROVIDER || 'anthropic').toLowerCase()
  if (p === 'anthropic' || p === 'openai' || p === 'ollama') return p
  throw new Error(`Unknown EVAL_JUDGE_PROVIDER "${p}" (want anthropic|openai|ollama)`)
}

/** True when the selected provider can actually be called. Ollama is local — no key. */
export function isJudgeConfigured(): boolean {
  switch (judgeProvider()) {
    case 'anthropic':
      return !!process.env.ANTHROPIC_API_KEY
    case 'openai':
      return !!process.env.OPENAI_API_KEY
    case 'ollama':
      return true
  }
}

function rubricPrompt(response: string, criteria: string): string {
  return `You are grading a single AI response against one criterion.

Criterion: ${criteria}

Response to grade:
"""
${response}
"""

Return ONLY strict JSON, no markdown:
{"score": <number between 0 and 1>, "reason": "<one short sentence>"}
where score is how fully the response meets the criterion
(1 = fully meets it, 0 = does not meet it at all).`
}

/**
 * Parse a judge model's raw text into a JudgeResult. Tolerant of ```json
 * fences and surrounding prose. Exported so it can be unit-tested without a
 * network call. Clamps score to [0,1].
 */
export function parseJudgeResponse(raw: string, threshold: number): JudgeResult {
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) throw new Error(`Judge returned no JSON: ${raw.slice(0, 120)}`)
  const parsed = JSON.parse(match[0]) as { score?: unknown; reason?: unknown; pass?: unknown }

  // Accept a legacy boolean `pass` too (maps to 1.0 / 0.0).
  let score: number
  if (typeof parsed.score === 'number') {
    score = parsed.score
  } else if (typeof parsed.pass === 'boolean') {
    score = parsed.pass ? 1 : 0
  } else {
    throw new Error(`Judge JSON missing numeric score: ${match[0].slice(0, 120)}`)
  }
  score = Math.max(0, Math.min(1, score))

  return {
    score,
    pass: score >= threshold,
    reason: typeof parsed.reason === 'string' ? parsed.reason : 'No reason provided',
  }
}

// ── provider calls (raw fetch, no SDKs) ────────────────────────────────────

async function callAnthropic(prompt: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY as string,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.EVAL_JUDGE_MODEL || 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!res.ok) throw new Error(`Anthropic judge HTTP ${res.status}: ${await res.text()}`)
  const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> }
  return data.content?.find((c) => c.type === 'text')?.text ?? ''
}

async function callOpenAI(prompt: string): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.OPENAI_API_KEY as string}`,
    },
    body: JSON.stringify({
      model: process.env.EVAL_JUDGE_MODEL || 'gpt-4o-mini',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!res.ok) throw new Error(`OpenAI judge HTTP ${res.status}: ${await res.text()}`)
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
  return data.choices?.[0]?.message?.content ?? ''
}

async function callOllama(prompt: string): Promise<string> {
  const host = process.env.OLLAMA_HOST || 'http://localhost:11434'
  const res = await fetch(`${host}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: process.env.EVAL_JUDGE_MODEL || 'llama3.2',
      stream: false,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!res.ok) throw new Error(`Ollama judge HTTP ${res.status}: ${await res.text()}`)
  const data = (await res.json()) as { message?: { content?: string } }
  return data.message?.content ?? ''
}

/**
 * Grade `response` against `criteria` with the configured provider.
 * Throws if the provider is not configured — callers should gate on
 * `isJudgeConfigured()` first (the runner does).
 */
export async function judge(
  response: string,
  criteria: string,
  threshold: number = DEFAULT_JUDGE_THRESHOLD,
): Promise<JudgeResult> {
  if (!isJudgeConfigured()) {
    throw new Error(`Judge provider "${judgeProvider()}" is not configured (missing API key)`)
  }
  const prompt = rubricPrompt(response, criteria)
  const provider = judgeProvider()
  const raw =
    provider === 'anthropic' ? await callAnthropic(prompt)
    : provider === 'openai' ? await callOpenAI(prompt)
    : await callOllama(prompt)
  return parseJudgeResponse(raw, threshold)
}
