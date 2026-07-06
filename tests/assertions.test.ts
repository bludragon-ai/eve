import { describe, it, expect } from 'vitest'
import { runAssertion, type EvalResult } from '../src/assertions.js'

const t = (text: string, sources?: EvalResult['sources']): EvalResult => ({ text, sources })

describe('deterministic assertions', () => {
  it('contains (case-insensitive)', () => {
    expect(runAssertion(t('Hello Jordan'), { type: 'contains', value: 'jordan' }).passed).toBe(true)
    expect(runAssertion(t('Hello'), { type: 'contains', value: 'jordan' }).passed).toBe(false)
  })

  it('contains_any', () => {
    expect(runAssertion(t('I can help'), { type: 'contains_any', values: ['assist', 'help'] }).passed).toBe(true)
    expect(runAssertion(t('nope'), { type: 'contains_any', values: ['assist', 'help'] }).passed).toBe(false)
  })

  it('not_contains', () => {
    expect(runAssertion(t('safe answer'), { type: 'not_contains', value: 'ssn' }).passed).toBe(true)
    expect(runAssertion(t('your ssn is'), { type: 'not_contains', value: 'ssn' }).passed).toBe(false)
  })

  it('max_words / min_words', () => {
    expect(runAssertion(t('one two three'), { type: 'max_words', value: 3 }).passed).toBe(true)
    expect(runAssertion(t('one two three four'), { type: 'max_words', value: 3 }).passed).toBe(false)
    expect(runAssertion(t('one two three'), { type: 'min_words', value: 3 }).passed).toBe(true)
    expect(runAssertion(t('one two'), { type: 'min_words', value: 3 }).passed).toBe(false)
  })

  it('regex (valid + invalid pattern)', () => {
    expect(runAssertion(t('a@b.com'), { type: 'regex', pattern: '\\S+@\\S+\\.\\S+' }).passed).toBe(true)
    expect(runAssertion(t('no email'), { type: 'regex', pattern: '\\S+@\\S+\\.\\S+' }).passed).toBe(false)
    // invalid regex fails rather than throwing
    expect(runAssertion(t('x'), { type: 'regex', pattern: '(' }).passed).toBe(false)
  })

  it('language heuristic', () => {
    expect(runAssertion(t('the app is for you and me'), { type: 'language', expected: 'en' }).passed).toBe(true)
    expect(runAssertion(t('el sistema es para el usuario y la empresa'), { type: 'language', expected: 'es' }).passed).toBe(true)
  })
})

describe('optional RAG capability', () => {
  it('rag_used / rag_not_used honor presence of sources', () => {
    expect(runAssertion(t('x', [{ article_id: 'a' }]), { type: 'rag_used' }).passed).toBe(true)
    expect(runAssertion(t('x', []), { type: 'rag_used' }).passed).toBe(false)
    expect(runAssertion(t('x', []), { type: 'rag_not_used' }).passed).toBe(true)
  })

  it('source_includes / source_not_includes', () => {
    const r = t('x', [{ article_id: 'about' }, { article_id: 'skills' }])
    expect(runAssertion(r, { type: 'source_includes', value: 'about' }).passed).toBe(true)
    expect(runAssertion(r, { type: 'source_includes', value: 'missing' }).passed).toBe(false)
    expect(runAssertion(r, { type: 'source_not_includes', value: 'missing' }).passed).toBe(true)
  })

  it('RAG assertions are SKIPPED (not failed) when target returns no sources', () => {
    const res = runAssertion(t('no sources field'), { type: 'rag_used' })
    expect(res.skipped).toBe(true)
    expect(res.passed).toBe(false)
  })
})

describe('routing / unknown', () => {
  it('llm_judge is marked skipped here (routed by the runner)', () => {
    expect(runAssertion(t('x'), { type: 'llm_judge', criteria: 'nice' }).skipped).toBe(true)
  })

  it('unknown type fails with a clear reason', () => {
    // @ts-expect-error intentionally invalid type
    const res = runAssertion(t('x'), { type: 'bogus' })
    expect(res.passed).toBe(false)
    expect(res.reason).toMatch(/unknown assertion type/i)
  })
})
