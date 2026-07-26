// /lib/llm.ts — 兼容 shim。真实实现已拆到 ./llm/{chat,route,types}.ts,
// 本文件仅作为对外老入口 `./lib/llm` 的 barrel,所有符号 re-export 自 ./llm/index.ts。
// 新代码请直接 import `'./llm'`(目录,自动解析 index.ts);此文件保留是为了不破
// 现有 `from '../lib/llm'` / `from '@lib/llm'` 调用点的运行时分发。

export * from './llm/index';