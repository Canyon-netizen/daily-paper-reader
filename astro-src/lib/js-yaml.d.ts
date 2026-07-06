// Local type declaration for js-yaml
// 避免依赖 @types/js-yaml(它会让 package-lock.json 跟 bun.lock 不一致,
// Cloudflare Pages 用 npm ci build 时会报 EUSAGE)

declare module 'js-yaml' {
  // 实际项目里只用到 load(),覆盖用到的最小子集
  export function load(input: string, options?: unknown): unknown;
  export function dump(input: unknown, options?: unknown): string;
  const _default: {
    load: typeof load;
    dump: typeof dump;
  };
  export default _default;
}
