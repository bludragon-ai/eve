import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { loadDataset, loadTarget, runEvals, type EvalCase } from '../src/runner.js'

const datasetPath = fileURLToPath(new URL('../examples/dataset.jsonl', import.meta.url))
const targetPath = fileURLToPath(new URL('../examples/target.ts', import.meta.url))

describe('loadDataset', () => {
  it('parses the example JSONL and normalizes ids', () => {
    const cases = loadDataset(datasetPath)
    expect(cases.length).toBe(6)
    expect(cases.map((c) => c.id)).toContain('about-jordan')
    expect(cases[0]!.expected_assertions.length).toBeGreaterThan(0)
  })
})

describe('runEvals against the example fixture (judge disabled)', () => {
  it('all example cases pass offline', async () => {
    const cases = loadDataset(datasetPath)
    const target = await loadTarget(targetPath)
    const summary = await runEvals({ cases, target, judgeEnabled: false, quiet: true })
    expect(summary.passed).toBe(summary.total)
    expect(summary.passRate).toBe(1)
    // the tone-judge case has a skipped llm_judge but still passes on its deterministic assertion
    expect(summary.perTest['tone-judge']).toBe(true)
  })

  it('a broken expectation makes exactly that case fail', async () => {
    const target = await loadTarget(targetPath)
    const cases: EvalCase[] = [
      { id: 'good', input: 'Who is Jordan?', expected_assertions: [{ type: 'contains', value: 'Jordan' }] },
      { id: 'bad', input: 'Who is Jordan?', expected_assertions: [{ type: 'contains', value: 'this-will-not-appear' }] },
    ]
    const summary = await runEvals({ cases, target, judgeEnabled: false, quiet: true })
    expect(summary.perTest).toEqual({ good: true, bad: false })
    expect(summary.passed).toBe(1)
    expect(summary.failed).toBe(1)
  })

  it('a target that throws fails the case instead of crashing the run', async () => {
    const cases: EvalCase[] = [{ id: 'boom', input: 'x', expected_assertions: [{ type: 'contains', value: 'x' }] }]
    const summary = await runEvals({
      cases,
      quiet: true,
      judgeEnabled: false,
      target: () => { throw new Error('adapter down') },
    })
    expect(summary.perTest['boom']).toBe(false)
    expect(summary.results[0]!.assertionResults[0]!.reason).toMatch(/adapter down/)
  })
})
