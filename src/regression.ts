#!/usr/bin/env -S npx tsx
/**
 * Regression gate — the real one.
 *
 * This is the check the source suite this was lifted from LACKED: it had a
 * report but no committed baseline and no exit code, so nothing could ever
 * fail on a regression.
 *
 * Here: a committed `baseline.json` records the expected pass/fail of every
 * case. The gate runs the current target, diffs it against the baseline, and
 * EXITS NON-ZERO the moment a case that used to pass now fails (or a
 * baseline-passing case vanished from the run). Improvements are reported but
 * never block. Run with --update to re-baseline after an intended change.
 *
 * CLI: tsx src/regression.ts --dataset <f.jsonl> --target <m> --baseline <b.json> [--update]
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { loadDataset, loadTarget, runEvals } from './runner.js'

export interface Baseline {
  generatedAt: string
  dataset?: string
  target?: string
  /** case id -> expected passed */
  tests: Record<string, boolean>
}

export interface BaselineDiff {
  regressions: string[] // was passing, now failing
  improvements: string[] // was failing, now passing
  missing: string[] // in baseline but absent from the current run
  added: string[] // in the current run but not in baseline
  ok: boolean // no regressions and no baseline-passing case went missing
}

const c = { reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', bold: '\x1b[1m', dim: '\x1b[2m' }

/**
 * Pure diff. `current` is a runner `perTest` map (id -> passed).
 * A regression is: baseline expected pass, current fails OR current absent.
 */
export function diffBaseline(baseline: Baseline, current: Record<string, boolean>): BaselineDiff {
  const regressions: string[] = []
  const improvements: string[] = []
  const missing: string[] = []

  for (const [id, wasPassing] of Object.entries(baseline.tests)) {
    if (!(id in current)) {
      missing.push(id)
      if (wasPassing) regressions.push(`${id} (missing from run)`)
      continue
    }
    const nowPassing = current[id]
    if (wasPassing && !nowPassing) regressions.push(id)
    if (!wasPassing && nowPassing) improvements.push(id)
  }

  const added = Object.keys(current).filter((id) => !(id in baseline.tests))

  return { regressions, improvements, missing, added, ok: regressions.length === 0 }
}

export function loadBaseline(baselinePath: string): Baseline {
  return JSON.parse(readFileSync(baselinePath, 'utf-8')) as Baseline
}

export function writeBaseline(baselinePath: string, perTest: Record<string, boolean>, meta: { dataset: string; target: string }): void {
  const baseline: Baseline = {
    generatedAt: new Date().toISOString(),
    dataset: meta.dataset,
    target: meta.target,
    tests: perTest,
  }
  writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + '\n')
}

// ── CLI ────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]) {
  const get = (flag: string) => {
    const hit = argv.find((a) => a === flag || a.startsWith(`${flag}=`))
    if (!hit) return undefined
    return hit.includes('=') ? hit.split('=').slice(1).join('=') : argv[argv.indexOf(hit) + 1]
  }
  return {
    dataset: get('--dataset'),
    target: get('--target'),
    baseline: get('--baseline'),
    update: argv.includes('--update'),
  }
}

export async function cli(argv = process.argv.slice(2)): Promise<number> {
  const args = parseArgs(argv)
  if (!args.dataset || !args.target || !args.baseline) {
    console.error('Usage: tsx src/regression.ts --dataset <f.jsonl> --target <m> --baseline <b.json> [--update]')
    return 2
  }

  const cases = loadDataset(args.dataset)
  const target = await loadTarget(args.target)
  const summary = await runEvals({ cases, target, quiet: true })

  if (args.update) {
    writeBaseline(args.baseline, summary.perTest, { dataset: args.dataset, target: args.target })
    console.log(`${c.green}✓ baseline written${c.reset} ${c.dim}${args.baseline}${c.reset} — ${summary.passed}/${summary.total} passing`)
    return 0
  }

  if (!existsSync(args.baseline)) {
    console.error(`${c.red}✗ no baseline at ${args.baseline}${c.reset} — create one with --update`)
    return 2
  }

  const baseline = loadBaseline(args.baseline)
  const diff = diffBaseline(baseline, summary.perTest)

  console.log(`${c.bold}Regression gate${c.reset} ${c.dim}vs ${args.baseline}${c.reset}`)
  console.log(`  current: ${summary.passed}/${summary.total} passing`)
  if (diff.improvements.length) console.log(`  ${c.green}improved:${c.reset} ${diff.improvements.join(', ')}`)
  if (diff.added.length) console.log(`  ${c.yellow}new (not in baseline):${c.reset} ${diff.added.join(', ')}`)
  if (diff.regressions.length) {
    console.log(`  ${c.red}REGRESSIONS:${c.reset} ${diff.regressions.join(', ')}`)
    console.log(`\n${c.red}✗ regression gate failed${c.reset} — re-baseline with --update only if this change is intended`)
    return 1
  }
  console.log(`\n${c.green}✓ no regressions${c.reset}`)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  cli().then((code) => process.exit(code)).catch((e) => { console.error(e); process.exit(1) })
}
