import { describe, it, expect } from 'vitest'
import { diffBaseline, type Baseline } from '../src/regression.js'

const baseline: Baseline = {
  generatedAt: '2026-01-01T00:00:00.000Z',
  tests: { a: true, b: true, c: false },
}

describe('diffBaseline (the gate logic)', () => {
  it('passes when nothing regressed', () => {
    const diff = diffBaseline(baseline, { a: true, b: true, c: false })
    expect(diff.ok).toBe(true)
    expect(diff.regressions).toEqual([])
  })

  it('flags a case that went from passing to failing', () => {
    const diff = diffBaseline(baseline, { a: true, b: false, c: false })
    expect(diff.ok).toBe(false)
    expect(diff.regressions).toContain('b')
  })

  it('reports improvements without blocking', () => {
    const diff = diffBaseline(baseline, { a: true, b: true, c: true })
    expect(diff.ok).toBe(true)
    expect(diff.improvements).toContain('c')
  })

  it('a baseline-passing case that vanished is a regression', () => {
    const diff = diffBaseline(baseline, { a: true, c: false })
    expect(diff.ok).toBe(false)
    expect(diff.missing).toContain('b')
    expect(diff.regressions.some((r) => r.startsWith('b'))).toBe(true)
  })

  it('a new case not in the baseline is reported but does not block', () => {
    const diff = diffBaseline(baseline, { a: true, b: true, c: false, d: false })
    expect(diff.ok).toBe(true)
    expect(diff.added).toContain('d')
  })
})
