/**
 * Chrome 扩展构建脚本：使用 Vite 分别打包 content、inject、background、popup 四个入口，输出到 dist 目录，并复制 manifest、popup HTML 及 public 静态资源。
 */
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { cpSync, existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// 在 ESM 中获取 __dirname 等价物，用于解析相对路径
const __dirname = dirname(fileURLToPath(import.meta.url));
// 根据 NODE_ENV 决定是否压缩输出，production 时启用 minify
const isProd = process.env.NODE_ENV === 'production';

// 从 config.ts 中提取 apiPath，构建时注入 inject.ts 消除双重硬编码
const configSource = readFileSync(resolve(__dirname, 'src/config.ts'), 'utf-8');
const apiPathMatch = configSource.match(/apiPath:\s*'([^']+)'/);
const API_PATH = apiPathMatch ? apiPathMatch[1] : '/projex/api/workitem/workitem/list';

async function buildExtension() {
  // 第一步：构建 content script，使用 React 插件，输出为 IIFE 格式的 content.js
  console.log('Building content script...');
  await build({
    configFile: false,
    plugins: [react()],
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      rollupOptions: {
        input: resolve(__dirname, 'src/content/index.tsx'),
        output: {
          format: 'iife',
          entryFileNames: 'content.js',
          assetFileNames: 'assets/[name].[ext]',
          inlineDynamicImports: true,
        },
      },
      minify: isProd,
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(isProd ? 'production' : 'development'),
    },
  });

  // 第二步：构建 inject 脚本，注入到页面主世界用于拦截 API，输出为 inject.js
  // 通过 define 注入 API_PATH，使 inject.ts 和 config.ts 共享同一配置源
  console.log('Building inject script...');
  await build({
    configFile: false,
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      rollupOptions: {
        input: resolve(__dirname, 'src/inject/index.ts'),
        output: {
          format: 'iife',
          entryFileNames: 'inject.js',
          inlineDynamicImports: true,
        },
      },
      minify: isProd,
    },
    define: {
      __INJECT_API_PATH__: JSON.stringify(API_PATH),
    },
  });

  // 第三步：构建 background service worker，使用 ES 格式以支持 Chrome MV3，输出为 background.js
  console.log('Building background service worker...');
  await build({
    configFile: false,
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      rollupOptions: {
        input: resolve(__dirname, 'src/background/index.ts'),
        output: {
          format: 'es',
          entryFileNames: 'background.js',
          inlineDynamicImports: true,
        },
      },
      minify: isProd,
    },
  });

  // 第四步：构建 popup 脚本，弹窗 UI 逻辑，输出为 popup.js
  console.log('Building popup...');
  await build({
    configFile: false,
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      rollupOptions: {
        input: resolve(__dirname, 'src/popup/index.ts'),
        output: {
          format: 'iife',
          entryFileNames: 'popup.js',
          inlineDynamicImports: true,
        },
      },
      minify: isProd,
    },
  });

  // 将 manifest.json 和 popup 的 HTML 复制到 dist 目录
  cpSync('manifest.json', 'dist/manifest.json');
  cpSync('src/popup/index.html', 'dist/popup.html');

  // 若存在 public 目录，则递归复制其内容到 dist，用于静态资源
  if (existsSync('public')) {
    cpSync('public', 'dist', { recursive: true });
  }

  console.log('Build complete! Output in dist/');
}

// 执行构建，失败时打印错误并退出进程
buildExtension().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
