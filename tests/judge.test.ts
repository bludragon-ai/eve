import { describe, it, expect, afterEach } from 'vitest'
import { parseJudgeResponse, isJudgeConfigured, judgeProvider } from '../src/judge.js'

describe('parseJudgeResponse', () => {
  it('parses a plain JSON rubric score', () => {
    const r = parseJudgeResponse('{"score": 0.8, "reason": "clear"}', 0.7)
    expect(r.score).toBe(0.8)
    expect(r.pass).toBe(true)
    expect(r.reason).toBe('clear')
  })

  it('applies the threshold', () => {
    expect(parseJudgeResponse('{"score": 0.6, "reason": "meh"}', 0.7).pass).toBe(false)
    expect(parseJudgeResponse('{"score": 0.7, "reason": "ok"}', 0.7).pass).toBe(true)
  })

  it('tolerates ```json fences and surrounding prose', () => {
    const raw = 'Here is my grade:\n```json\n{"score": 1, "reason": "great"}\n```'
    expect(parseJudgeResponse(raw, 0.7).score).toBe(1)
  })

  it('accepts a legacy boolean pass (maps to 1/0)', () => {
    expect(parseJudgeResponse('{"pass": true, "reason": "y"}', 0.7).score).toBe(1)
    expect(parseJudgeResponse('{"pass": false, "reason": "n"}', 0.7).score).toBe(0)
  })

  it('clamps out-of-range scores', () => {
    expect(parseJudgeResponse('{"score": 5, "reason": "x"}', 0.7).score).toBe(1)
    expect(parseJudgeResponse('{"score": -2, "reason": "x"}', 0.7).score).toBe(0)
  })

  it('throws on non-JSON', () => {
    expect(() => parseJudgeResponse('totally not json', 0.7)).toThrow()
  })
})

describe('provider config (env-driven)', () => {
  const saved = { ...process.env }
  afterEach(() => {
    process.env = { ...saved }
  })

  it('defaults to anthropic and is unconfigured without a key', () => {
    delete process.env.EVAL_JUDGE_PROVIDER
    delete process.env.ANTHROPIC_API_KEY
    expect(judgeProvider()).toBe('anthropic')
    expect(isJudgeConfigured()).toBe(false)
  })

  it('anthropic is configured with a key present', () => {
    process.env.EVAL_JUDGE_PROVIDER = 'anthropic'
    process.env.ANTHROPIC_API_KEY = 'sk-test'
    expect(isJudgeConfigured()).toBe(true)
  })

  it('ollama needs no key', () => {
    process.env.EVAL_JUDGE_PROVIDER = 'ollama'
    expect(isJudgeConfigured()).toBe(true)
  })

  it('rejects an unknown provider', () => {
    process.env.EVAL_JUDGE_PROVIDER = 'gemini'
    expect(() => judgeProvider()).toThrow()
  })
})
