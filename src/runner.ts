#!/usr/bin/env -S npx tsx
/**
 * Eval runner.
 *
 * Runs a JSONL dataset of eval cases against a TARGET ADAPTER — any function
 * `(input) => { text, sources? }`. Deterministic assertions run offline;
 * `llm_judge` assertions route to the pluggable judge (../src/judge.ts) and
 * are SKIPPED when no judge provider is configured.
 *
 * The pass threshold is configurable (default 1.0 = every case must pass);
 * the CLI exits non-zero when the pass rate is below it.
 *
 * CLI:  tsx src/runner.ts --dataset <file.jsonl> --target <module> [--threshold 0.9] [--quiet]
 * Lib:  import { runEvals, loadDataset, loadTarget } from './runner'
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runAssertion, type Assertion, type AssertionResult, type EvalResult } from './assertions.js'
import { judge, isJudgeConfigured } from './judge.js'

export interface EvalCase {
  id: string
  input: string
  lang?: 'en' | 'es'
  expected_assertions: Assertion[]
}

/** A target adapter: given an input, produce a result to assert against. */
export type TargetAdapter = (input: string, testCase: EvalCase) => Promise<EvalResult> | EvalResult

export interface CaseResult {
  id: string
  input: string
  response: string
  assertionResults: AssertionResult[]
  passed: boolean
}

export interface EvalSummary {
  total: number
  passed: number
  failed: number
  passRate: number
  results: CaseResult[]
  /** id -> passed. The regression gate diffs this against a baseline. */
  perTest: Record<string, boolean>
}

const c = {
  reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m',
  yellow: '\x1b[33m', cyan: '\x1b[36m', dim: '\x1b[2m', bold: '\x1b[1m',
}

/** Parse a JSONL dataset file into eval cases. Accepts `expected_assertions` or `assertions`. */
export function loadDataset(datasetPath: string): EvalCase[] {
  const raw = readFileSync(datasetPath, 'utf-8')
  const cases: EvalCase[] = []
  raw.split('\n').forEach((line, i) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('//')) return
    const obj = JSON.parse(trimmed) as Partial<EvalCase> & { assertions?: Assertion[] }
    const assertions = obj.expected_assertions ?? obj.assertions
    if (!obj.input || !assertions) {
      throw new Error(`Dataset line ${i + 1}: needs "input" and "expected_assertions"`)
    }
    cases.push({
      id: obj.id ?? `case-${i + 1}`,
      input: obj.input,
      lang: obj.lang,
      expected_assertions: assertions,
    })
  })
  return cases
}

/** Dynamically import a target module. Its default export must be the adapter fn. */
export async function loadTarget(targetPath: string): Promise<TargetAdapter> {
  const mod = (await import(pathToFileURL(resolve(targetPath)).href)) as { default?: unknown }
  if (typeof mod.default !== 'function') {
    throw new Error(`Target "${targetPath}" must default-export a function (input) => { text, sources? }`)
  }
  return mod.default as TargetAdapter
}

/** Run every assertion for one case (deterministic inline, llm_judge via judge). */
async function runCaseAssertions(
  result: EvalResult,
  assertions: Assertion[],
  judgeEnabled: boolean,
): Promise<AssertionResult[]> {
  const out: AssertionResult[] = []
  for (const a of assertions) {
    if (a.type === 'llm_judge') {
      if (!judgeEnabled) {
        out.push({ passed: true, skipped: true, assertion: a, reason: 'llm_judge skipped (no judge provider configured)' })
        continue
      }
      try {
        const r = await judge(result.text, a.criteria as string, a.threshold)
        out.push({ passed: r.pass, assertion: a, reason: `judge score ${r.score.toFixed(2)} — ${r.reason}` })
      } catch (e) {
        out.push({ passed: false, assertion: a, reason: `judge error: ${e instanceof Error ? e.message : String(e)}` })
      }
    } else {
      out.push(runAssertion(result, a))
    }
  }
  return out
}

export interface RunOptions {
  cases: EvalCase[]
  target: TargetAdapter
  /** override judge availability (defaults to isJudgeConfigured()) */
  judgeEnabled?: boolean
  quiet?: boolean
}

/**
 * Core eval loop. Pure of process.exit — returns a summary the CLI/gate acts on.
 * A case passes when every NON-skipped assertion passes.
 */
export async function runEvals(opts: RunOptions): Promise<EvalSummary> {
  const judgeEnabled = opts.judgeEnabled ?? isJudgeConfigured()
  const results: CaseResult[] = []

  for (const testCase of opts.cases) {
    let result: EvalResult
    let assertionResults: AssertionResult[]
    try {
      result = await opts.target(testCase.input, testCase)
      assertionResults = await runCaseAssertions(result, testCase.expected_assertions, judgeEnabled)
    } catch (e) {
      assertionResults = [{ passed: false, assertion: { type: 'contains' }, reason: `target error: ${e instanceof Error ? e.message : String(e)}` }]
      result = { text: '' }
    }
    const passed = assertionResults.every((r) => r.passed)
    results.push({ id: testCase.id, input: testCase.input, response: result.text, assertionResults, passed })

    if (!opts.quiet) {
      const mark = passed ? `${c.green}✓${c.reset}` : `${c.red}✗${c.reset}`
      console.log(`  ${mark} ${testCase.id}`)
      for (const ar of assertionResults.filter((r) => !r.passed || r.skipped)) {
        const tag = ar.skipped ? `${c.yellow}skip${c.reset}` : `${c.red}fail${c.reset}`
        console.log(`      ${c.dim}${tag}: ${ar.reason}${c.reset}`)
      }
    }
  }

  const passed = results.filter((r) => r.passed).length
  const total = results.length
  const perTest: Record<string, boolean> = {}
  for (const r of results) perTest[r.id] = r.passed

  return {
    total,
    passed,
    failed: total - passed,
    passRate: total === 0 ? 1 : passed / total,
    results,
    perTest,
  }
}

// ── CLI ────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]) {
  const get = (flag: string) => {
    const hit = argv.find((a) => a === flag || a.startsWith(`${flag}=`))
    if (!hit) return undefined
    if (hit.includes('=')) return hit.split('=').slice(1).join('=')
    return argv[argv.indexOf(hit) + 1]
  }
  return {
    dataset: get('--dataset'),
    target: get('--target'),
    threshold: get('--threshold'),
    quiet: argv.includes('--quiet'),
  }
}

export async function cli(argv = process.argv.slice(2)): Promise<number> {
  const args = parseArgs(argv)
  if (!args.dataset || !args.target) {
    console.error('Usage: tsx src/runner.ts --dataset <file.jsonl> --target <module> [--threshold 0.9]')
    return 2
  }
  const threshold = args.threshold ? Number(args.threshold) : 1.0
  if (Number.isNaN(threshold) || threshold < 0 || threshold > 1) {
    console.error(`--threshold must be between 0 and 1 (got "${args.threshold}")`)
    return 2
  }

  const cases = loadDataset(args.dataset)
  const target = await loadTarget(args.target)

  console.log(`${c.bold}Eval Harness${c.reset} ${c.dim}— ${cases.length} cases · judge ${isJudgeConfigured() ? 'ON' : 'off (llm_judge skipped)'}${c.reset}\n`)
  const summary = await runEvals({ cases, target, quiet: args.quiet })

  const pct = Math.round(summary.passRate * 100)
  const ok = summary.passRate >= threshold
  const color = ok ? c.green : c.red
  console.log(`\n${color}${ok ? '✓' : '✗'} ${summary.passed}/${summary.total} passed (${pct}%) · threshold ${Math.round(threshold * 100)}%${c.reset}`)
  return ok ? 0 : 1
}

// Run as CLI only when invoked directly (not when imported).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  cli().then((code) => process.exit(code)).catch((e) => { console.error(e); process.exit(1) })
}
