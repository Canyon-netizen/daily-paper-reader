# Test Convention

This directory contains tests for the DPR (Daily Paper Reader) agent system.

## Running Tests

```bash
npm test
# or
node --test astro-src/scripts/*.test.mjs
```

## Test File Naming

- Test files: `*.test.mjs`
- Location: `astro-src/scripts/`

## Test Pattern

Tests use Node.js's built-in `node:test` module with the following structure:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import esbuild from 'esbuild';

async function loadTs(relPath) {
  const result = await esbuild.build({
    entryPoints: [relPath],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    target: 'es2022',
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

test('test name', async () => {
  const { exportedFn } = await loadTs('lib/path/to/module.ts');
  // assertions...
});
```

## Snapshot Tests

Snapshot tests are stored in `astro-src/scripts/__snapshots__/*.json`.
