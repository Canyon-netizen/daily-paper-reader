// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import mdx from '@astrojs/mdx';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Dev 时从 .env 把 token=... 映射到 process.env.GH_TOKEN,让 SSR
// frontmatter 能拿到 GitHub PAT,无需 dotenv 依赖。生产环境 (Vercel /
// Cloudflare Pages / GitHub Actions) 应通过部署平台的环境变量配置
// GH_TOKEN,不要从这里读 —— .env 里的 token 实际是 Python pipeline
// 用的 GitHub PAT,与 Astro 无关;这条桥接只服务本地 dev。
if (process.env.NODE_ENV !== 'production' && !process.env.GH_TOKEN) {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const envPath = join(here, '.env');
    const txt = readFileSync(envPath, 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      const [, k, v] = m;
      // 只把 token 行转成 GH_TOKEN,其它(env 里其它脚本用的字段)按原样。
      // 大小写不敏感:某些部署平台 (Cloudflare Pages UI) 自动把环境变量
      // 转成小写,这里同时认 'GH_TOKEN' / 'Gh_Token' / 'gh_token' 等。
      if (k.toUpperCase() === 'GH_TOKEN' && !process.env.GH_TOKEN) process.env.GH_TOKEN = v;
    }
  } catch {
    // .env 不存在或读不到时静默忽略,SSR fallback 到"最新论文 date"
  }
}

/**
 * paper-disk.mjs / taxonomies-disk.mjs 的处理:
 *
 *  - 这些文件顶层 import node:fs / node:path,如果进 client bundle,Vite 的
 *    __vite-browser-external stub 不导出 readFile / join,客户端 import() 调用
 *    时就会 crash。所以 client 端必须 externalize(不让它们进 client chunk)。
 *
 *  - SSR 端反过来:必须 bundle 进 chunk,否则:
 *      (a) `external` 让 Rollup 把绝对路径写成相对路径(用 `../` 跳出 chunk 目录),
 *          Node 运行时拼出 `dist/<原绝对路径>` 这种鬼路径,文件不存在;
 *      (b) `ssr.noExternal` 在 Astro/Vite 6 这里没 override `build.rollupOptions.external`,
 *          所以单纯依赖 `noExternal` 不够。
 *
 *  - 解决:写一个 build 阶段 plugin,只在 client build 把 disk.mjs 标 external,
 *    SSR build 时不设 external,Vite 自然把 disk.mjs 编进 SSR chunk,
 *    node:* 内置模块按 SSR 默认走 external(运行时 Node 解析,正常)。
 */
function diskExternalForClientOnly() {
  const matcher = (id) =>
    /paper-disk\.mjs$/.test(id) || /taxonomies-disk\.mjs$/.test(id);
  return {
    name: 'disk-external-client-only',
    config(config, { isSsrBuild }) {
      if (isSsrBuild) return;
      const build = (config.build ??= {});
      const rollup = (build.rollupOptions ??= {});
      const prev = rollup.external;
      rollup.external = (id, ...rest) => {
        if (matcher(id)) return true;
        if (typeof prev === 'function') return prev(id, ...rest);
        if (Array.isArray(prev)) return prev.includes(id);
        return false;
      };
    },
  };
}

// 部署目标:
//   - Vercel (根域名):  https://daily-paper-reader.vercel.app/
//   - EdgeOne Pages:   https://<project>.edgeone.app/  (国内 CDN,根域名)
//   - GitHub Pages:    https://canyon-netizen.github.io/daily-paper-reader/  (子路径)
//
// 默认 base 是 '/',适配 Vercel / EdgeOne / 自定义根域名。
// 只有部署到 GitHub Pages 子路径时,需要在构建环境里显式设
// DEPLOY_BASE=/daily-paper-reader (例如在 GitHub Actions 里 export 后再 astro build)。
//
// 重要:本项目 Python pipeline 占用 ./src/ 目录,所以 Astro 源码放 ./astro-src/
const deployBase = (process.env.DEPLOY_BASE || '/').replace(/\/+$/, '') || '/';
const siteUrl = process.env.DEPLOY_SITE || 'https://daily-paper-reader.vercel.app';

export default defineConfig({
  site: siteUrl,
  base: deployBase,
  output: 'static',
  trailingSlash: 'always',  // 路由统一尾斜杠
  srcDir: './astro-src',    // 避开 Python src/
  publicDir: './public',
  server: {
    // Windows 上默认只绑 ::1(IPv6 localhost),浏览器 127.0.0.1 连不上。
    // 显式监听所有接口,本机和局域网都能访问
    host: true,
  },
  build: {
    format: 'directory',    // 默认 directory 模式,跟 trailingSlash 配合
    assets: 'assets',       // 静态资源输出目录
    inlineStylesheets: 'auto',  // 小 CSS 内联,减小请求
  },
  integrations: [
    sitemap(),
    mdx(),
  ],
  markdown: {
    shikiConfig: {
      // 不引外部语法高亮主题,自研
      theme: 'css-variables',
    },
  },
  vite: {
    server: {
      // 开发时允许跨域,方便调试
      cors: true,
    },
    // GH_TOKEN 是 GitHub PAT,绝不能进客户端 bundle。
    // Astro 默认会把 process.env.* 同步到 import.meta.env(包括客户端),
    // 这里用 envPrefix 收紧:只允许 PUBLIC_ 前缀注入 import.meta.env,
    // 其它(GH_TOKEN / API key 等)只活在 process.env 里,前端脚本读不到。
    envPrefix: ['PUBLIC_'],
    optimizeDeps: {
      // pdfjs-dist / katex 走动态 import(),体积大,显式预构建避免 dev 启动后浏览器拉不到
      include: ['pdfjs-dist', 'katex'],
    },
    // 见顶部 diskExternalForClientOnly 的注释:client 端靠它 externalize,
    // SSR 端靠 Vite 默认行为把 disk.mjs 编进 chunk + ssr.noExternal 兜底。
    ssr: {
      noExternal: [/.*-disk\.mjs$/],
    },
    plugins: [diskExternalForClientOnly()],
  },
});
