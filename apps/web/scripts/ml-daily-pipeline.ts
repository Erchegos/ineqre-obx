#!/usr/bin/env tsx

/**
 * ML Daily Pipeline - Master Orchestrator
 *
 * Runs all ML data pipeline steps in sequence:
 *   1. Calculate technical factors (factor_technical)
 *   2. Backfill beta/IVOL (fills NULL beta/ivol)
 *   3. Calculate NOK volume (factor_fundamentals.nokvol)
 *   4. Fetch Yahoo fundamentals (factor_fundamentals.bm/ep/dy/sp/sg/mktcap)
 *   5. Refresh materialized view (factor_combined_view)
 *   6. Regenerate ML predictions (ml_predictions)
 *
 * Usage:
 *   npx tsx scripts/ml-daily-pipeline.ts              # Run all steps
 *   npx tsx scripts/ml-daily-pipeline.ts --from=3     # Resume from step 3
 *   npx tsx scripts/ml-daily-pipeline.ts --dry-run    # Show steps without running
 *
 * Schedule: 01:00 UTC daily via GitHub Actions (weekdays only)
 * Environment: DATABASE_URL (required)
 */

import { execFile } from 'child_process';
import { resolve } from 'path';
import { config } from 'dotenv';

// Load local env if available (silently fails in CI)
config({ path: resolve(__dirname, '../.env.local') });

// Required for SSL connections in prediction + fundamentals steps
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

interface PipelineStep {
  name: string;
  script: string;
  timeoutMinutes: number;
  critical: boolean;
}

const SCRIPTS_DIR = resolve(__dirname);

const PIPELINE_STEPS: PipelineStep[] = [
  {
    name: 'Calculate Technical Factors',
    script: 'calculate-factors-batch.ts',
    timeoutMinutes: 15,
    critical: true,
  },
  {
    name: 'Backfill Beta/IVOL',
    script: 'backfill-beta-ivol.ts',
    timeoutMinutes: 5,
    critical: true,
  },
  {
    name: 'Calculate NOK Volume',
    script: 'calculate-nokvol.ts',
    timeoutMinutes: 5,
    critical: true,
  },
  {
    name: 'Fetch Yahoo Fundamentals',
    script: 'fetch-yahoo-fundamentals.ts',
    timeoutMinutes: 15,
    critical: false, // Yahoo API can be flaky; don't block predictions
  },
  {
    name: 'Refresh Materialized View',
    script: 'refresh-materialized-view.ts',
    timeoutMinutes: 2,
    critical: true,
  },
  {
    name: 'Regenerate ML Predictions',
    script: 'regenerate-predictions.ts',
    timeoutMinutes: 10,
    critical: true,
  },
];

function runStep(step: PipelineStep): Promise<{ exitCode: number; duration: number }> {
  return new Promise((resolveFn) => {
    const startTime = Date.now();
    const scriptPath = resolve(SCRIPTS_DIR, step.script);
    const timeout = step.timeoutMinutes * 60 * 1000;

    const child = execFile(
      'tsx',
      [scriptPath],
      {
        cwd: resolve(SCRIPTS_DIR, '..'),
        timeout,
        env: {
          ...process.env,
          NODE_TLS_REJECT_UNAUTHORIZED: '0',
        },
        maxBuffer: 10 * 1024 * 1024, // 10MB output buffer
      },
      (error, stdout, stderr) => {
        const duration = (Date.now() - startTime) / 1000;

        if (stdout) {
          stdout.split('\n').forEach((line) => {
            if (line.trim()) console.log(`  ${line}`);
          });
        }
        if (stderr) {
          stderr.split('\n').forEach((line) => {
            if (line.trim()) console.error(`  [STDERR] ${line}`);
          });
        }

        const exitCode = error ? (error as any).code ?? 1 : 0;
        resolveFn({ exitCode, duration });
      }
    );
  });
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const fromArg = args.find((a) => a.startsWith('--from='));
  const fromStep = fromArg ? parseInt(fromArg.split('=')[1], 10) : 1;

  const startTime = Date.now();

  console.log('='.repeat(80));
  console.log('ML DAILY PIPELINE');
  console.log('='.repeat(80));
  console.log(`Started at: ${new Date().toISOString()}`);
  console.log(`Database: ${process.env.DATABASE_URL ? 'configured' : 'MISSING!'}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  if (fromStep > 1) console.log(`Resuming from step ${fromStep}`);
  console.log('');

  if (!process.env.DATABASE_URL) {
    console.error('FATAL: DATABASE_URL environment variable is not set');
    process.exit(1);
  }

  // Show pipeline overview
  console.log('Pipeline steps:');
  PIPELINE_STEPS.forEach((step, i) => {
    const num = i + 1;
    const skip = num < fromStep ? ' [SKIP]' : '';
    const critical = step.critical ? '' : ' (non-critical)';
    console.log(`  ${num}. ${step.name}${critical}${skip}`);
  });
  console.log('');

  if (dryRun) {
    console.log('Dry run complete. No scripts executed.');
    process.exit(0);
  }

  const results: Array<{
    step: string;
    status: 'success' | 'failed' | 'skipped';
    duration: number;
    exitCode: number;
  }> = [];

  let pipelineFailed = false;

  for (let i = 0; i < PIPELINE_STEPS.length; i++) {
    const stepNum = i + 1;
    const step = PIPELINE_STEPS[i];

    if (stepNum < fromStep) {
      results.push({ step: step.name, status: 'skipped', duration: 0, exitCode: 0 });
      continue;
    }

    console.log('-'.repeat(80));
    console.log(`STEP ${stepNum}/${PIPELINE_STEPS.length}: ${step.name}`);
    console.log(`Script: ${step.script} | Timeout: ${step.timeoutMinutes}m | Critical: ${step.critical}`);
    console.log('-'.repeat(80));

    const { exitCode, duration } = await runStep(step);

    if (exitCode === 0) {
      console.log(`\n  [OK] ${step.name} completed in ${duration.toFixed(1)}s\n`);
      results.push({ step: step.name, status: 'success', duration, exitCode });
    } else {
      console.error(`\n  [FAIL] ${step.name} failed with exit code ${exitCode} after ${duration.toFixed(1)}s\n`);
      results.push({ step: step.name, status: 'failed', duration, exitCode });

      if (step.critical) {
        console.error('  CRITICAL step failed. Aborting pipeline.');
        pipelineFailed = true;
        for (let j = i + 1; j < PIPELINE_STEPS.length; j++) {
          results.push({ step: PIPELINE_STEPS[j].name, status: 'skipped', duration: 0, exitCode: -1 });
        }
        break;
      } else {
        console.warn('  Non-critical step failed. Continuing pipeline.');
      }
    }
  }

  // Summary
  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
  const succeeded = results.filter((r) => r.status === 'success').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;

  console.log('\n' + '='.repeat(80));
  console.log('PIPELINE SUMMARY');
  console.log('='.repeat(80));
  console.log(`Status: ${pipelineFailed ? 'FAILED' : 'SUCCESS'}`);
  console.log(`Duration: ${totalDuration}s`);
  console.log(`Steps: ${succeeded} succeeded, ${failed} failed, ${skipped} skipped`);
  console.log('');

  results.forEach((r, i) => {
    const icon = r.status === 'success' ? 'OK' : r.status === 'failed' ? 'FAIL' : 'SKIP';
    const dur = r.duration > 0 ? ` (${r.duration.toFixed(1)}s)` : '';
    console.log(`  ${i + 1}. [${icon}] ${r.step}${dur}`);
  });

  console.log('\n' + '='.repeat(80));
  console.log(`Completed at: ${new Date().toISOString()}`);
  console.log('='.repeat(80));

  process.exit(pipelineFailed ? 1 : 0);
}

main();
