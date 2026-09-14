// tools/build-agent-shims.mjs — 用 esbuild API 把 designer/feedback/modifier/gate.ts 编译为 .mjs
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const agentsDir = 'E:/study/daily-paper-reader/astro-src/lib/agents';
const targets = ['designer', 'feedback', 'modifier', 'gate'];

for (const name of targets) {
  const tsPath = join(agentsDir, `${name}.ts`);
  const mjsPath = join(agentsDir, `${name}.mjs`);
  try {
    const r = await build({
      entryPoints: [tsPath],
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node20',
      write: false,
      logLevel: 'silent',
    });
    const out = r.outputFiles[0].text;
    writeFileSync(mjsPath, out);
    console.log(`✓ ${name}.mjs  (${out.length} bytes)`);
  } catch (e) {
    console.error(`✗ ${name}: ${e.message}`);
  }
}
