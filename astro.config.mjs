// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import mdx from '@astrojs/mdx';

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
    optimizeDeps: {
      // pdfjs-dist 走动态 import(),体积大,显式预构建避免 dev 启动后浏览器拉不到
      include: ['pdfjs-dist'],
    },
  },
});
