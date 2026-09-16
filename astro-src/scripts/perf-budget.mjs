#!/usr/bin/env node
// astro-src/scripts/perf-budget.mjs
//
// R7 I.1.4: perf budget check.
//
// 检查构建产物的性能预算:
//   - JS bundle 大小限制
// - 静态资源大小限制
// - 入口文件数量
//
// 使用: node astro-src/scripts/perf-budget.mjs
// CI:   node astro-src/scripts/perf-budget.mjs --ci (退出码 1 如果超限)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { parseArgs } from 'node:util';

const DEFAULT_BUDGETS = {
  maxJsBundleKB: 500,        // 单个 JS bundle 最大 500KB
  maxTotalJsKB: 2000,        // 总 JS 最大 2MB
  maxAssetKB: 1024,         // 单个静态资源(图片/font) 最大 1MB
  maxHtmlFiles: 100,        // HTML 页面最大数量
  maxPagesPerRoute: 10,     // 每条路由最多生成页面数
};

function findDistDir() {
  // 尝试多种可能的输出目录
  const candidates = [
    'dist',
    '.output',
    '.vercel/output',
  ];
  for (const c of candidates) {
    try {
      statSync(c);
      return c;
    } catch {
      // ignore
    }
  }
  return null;
}

function getJsFiles(dir) {
  const files: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const fullPath = join(dir, e.name);
      if (e.isDirectory() && !e.name.startsWith('.')) {
        files.push(...getJsFiles(fullPath));
      } else if (e.isFile() && (e.name.endsWith('.js') || e.name.endsWith('.mjs'))) {
        files.push(fullPath);
      }
    }
  } catch {
    // ignore
  }
  return files;
}

function getAssetFiles(dir) {
  const files: string[] = [];
  const assetExts = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.woff', '.woff2', '.ttf'];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const fullPath = join(dir, e.name);
      if (e.isDirectory() && !e.name.startsWith('.')) {
        files.push(...getAssetFiles(fullPath));
      } else if (e.isFile() && assetExts.includes(extname(e.name).toLowerCase())) {
        files.push(fullPath);
      }
    }
  } catch {
    // ignore
  }
  return files;
}

function getHtmlFiles(dir) {
  const files: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const fullPath = join(dir, e.name);
      if (e.isDirectory() && !e.name.startsWith('.')) {
        files.push(...getHtmlFiles(fullPath));
      } else if (e.isFile() && (e.name.endsWith('.html') || e.name.endsWith('.htm'))) {
        files.push(fullPath);
      }
    }
  } catch {
    // ignore
  }
  return files;
}

function formatKB(bytes) {
  return `${(bytes / 1024).toFixed(1)}KB`;
}

function checkBudget(budgets = DEFAULT_BUDGETS) {
  const issues: string[] = [];
  const distDir = findDistDir();

  if (!distDir) {
    issues.push('dist 目录未找到,请先运行 npm run build');
    return { passed: false, issues };
  }

  // JS bundles
  const jsFiles = getJsFiles(distDir);
  let totalJsSize = 0;
  for (const f of jsFiles) {
    const size = statSync(f).size;
    totalJsSize += size;
    if (size > budgets.maxJsBundleKB * 1024) {
      issues.push(`JS bundle 超限: ${f} = ${formatKB(size)} (max ${budgets.maxJsBundleKB}KB)`);
    }
  }
  if (totalJsSize > budgets.maxTotalJsKB * 1024) {
    issues.push(`总 JS 超限: ${formatKB(totalJsSize)} (max ${budgets.maxTotalJsKB}KB)`);
  }

  // 静态资源
  const assetFiles = getAssetFiles(distDir);
  for (const f of assetFiles) {
    const size = statSync(f).size;
    if (size > budgets.maxAssetKB * 1024) {
      issues.push(`静态资源超限: ${f} = ${formatKB(size)} (max ${budgets.maxAssetKB}KB)`);
    }
  }

  // HTML 页面
  const htmlFiles = getHtmlFiles(distDir);
  if (htmlFiles.length > budgets.maxHtmlFiles) {
    issues.push(`HTML 页面超限: ${htmlFiles.length} (max ${budgets.maxHtmlFiles})`);
  }

  return {
    passed: issues.length === 0,
    issues,
    stats: {
      jsFiles: jsFiles.length,
      totalJsKB: Math.round(totalJsSize / 1024),
      assetFiles: assetFiles.length,
      htmlFiles: htmlFiles.length,
    },
  };
}

function main() {
  const { values } = parseArgs({
    options: {
      ci: { type: 'boolean', default: false },
      'max-js-bundle': { type: 'string' },
      'max-total-js': { type: 'string' },
      'max-asset': { type: 'string' },
      'max-pages': { type: 'string' },
    },
  });

  const budgets = { ...DEFAULT_BUDGETS };
  if (values['max-js-bundle']) budgets.maxJsBundleKB = parseInt(values['max-js-bundle'], 10);
  if (values['max-total-js']) budgets.maxTotalJsKB = parseInt(values['max-total-js'], 10);
  if (values['max-asset']) budgets.maxAssetKB = parseInt(values['max-asset'], 10);
  if (values['max-pages']) budgets.maxHtmlFiles = parseInt(values['max-pages'], 10);

  const result = checkBudget(budgets);

  console.log('=== Performance Budget Check ===');
  console.log(`JS bundles: ${result.stats.jsFiles} files, ${result.stats.totalJsKB}KB total`);
  console.log(`Assets: ${result.stats.assetFiles} files`);
  console.log(`HTML pages: ${result.stats.htmlFiles}`);

  if (result.passed) {
    console.log('\n✅ All budgets passed');
    process.exit(0);
  } else {
    console.log('\n❌ Budget exceeded:');
    for (const issue of result.issues) {
      console.log(`  - ${issue}`);
    }
    process.exit(values.ci ? 1 : 0);
  }
}

main();
