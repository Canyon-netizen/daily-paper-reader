#!/usr/bin/env node
/**
 * test-runner.mjs - Run test files with filter and reporter options
 * Usage: node astro-src/scripts/test-runner.mjs [--filter <pattern>] [--reporter <spec|tap>]
 */

import { glob } from 'glob';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function parseArgs() {
  const args = process.argv.slice(2);
  const options = { filter: null, reporter: 'spec' };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--filter' && i + 1 < args.length) {
      options.filter = args[++i];
    } else if (args[i] === '--reporter' && i + 1 < args.length) {
      options.reporter = args[++i];
    }
  }

  return options;
}

async function findTestFiles(pattern = '*.test.mjs') {
  const testDir = join(__dirname, '..', 'scripts');
  const files = await glob(pattern, { cwd: testDir });
  return files.map(f => join(testDir, f));
}

function filterFiles(files, pattern) {
  if (!pattern) return files;
  const regex = new RegExp(pattern, 'i');
  return files.filter(f => regex.test(f));
}

async function runTest(file, reporter) {
  return new Promise((resolve) => {
    const args = ['--test', file];
    if (reporter !== 'spec') {
      args.push(`--test-reporter=${reporter}`);
    }

    const proc = spawn('node', args, { stdio: 'inherit' });
    proc.on('close', (code) => resolve(code));
  });
}

async function main() {
  const options = parseArgs();
  const allFiles = await findTestFiles();
  const files = filterFiles(allFiles, options.filter);

  if (files.length === 0) {
    console.log('No test files found matching the filter.');
    process.exit(0);
  }

  console.log(`Running ${files.length} test file(s)...`);
  if (options.filter) console.log(`Filter: ${options.filter}`);
  console.log(`Reporter: ${options.reporter}`);
  console.log('');

  let hasFailure = false;
  for (const file of files) {
    console.log(`\n=== Running ${file.split('/').pop()} ===`);
    const code = await runTest(file, options.reporter);
    if (code !== 0) {
      hasFailure = true;
    }
  }

  process.exit(hasFailure ? 1 : 0);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
