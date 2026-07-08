// Run smoke test in a context with localStorage shimmed
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { execSync } from 'node:child_process';

// 1) shim localStorage
const memStore = new Map();
globalThis.localStorage = {
  getItem: (k) => (memStore.has(k) ? memStore.get(k) : null),
  setItem: (k, v) => memStore.set(k, String(v)),
  removeItem: (k) => memStore.delete(k),
  clear: () => memStore.clear(),
  key: (i) => Array.from(memStore.keys())[i] ?? null,
  get length() { return memStore.size; },
};

// 2) Run the smoke test
await import(pathToFileURL('./scripts/smoke-test-paper-library.mjs'));
