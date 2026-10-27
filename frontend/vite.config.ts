import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'

// vite.config.ts 由 tsconfig.node.json 覆盖，但项目未安装 @types/node，
// 直接使用 process 会触发「找不到名称 process」的 IDE 报错。
// 这里声明最小类型，避免全局引入 @types/node（会与 DOM lib 的 setTimeout 类型冲突）。
declare const process: {
  env: Record<string, string | undefined>
}

const version = process.env.VITE_VERSION || 'dev'

export default defineConfig({
  plugins: [
    vue(),
    // P3: Element Plus 按需引入
    // - Components: 自动扫描模板中的 <el-xxx> 标签，按需注册组件 + 引入对应样式
    // - AutoImport: 为未显式 import 的 Element Plus 全局 API（ElMessage 等）自动注入 import
    //   imports: []  → 不预设 vue/vue-router 全局 API，避免污染现有显式 import 风格
    //   dts: false   → 不生成 auto-imports.d.ts / components.d.ts，保持改动最小
    //   注意：ElMessage/ElMessageBox 等全局 API 的样式需在 main.ts 手动引入
    //   （它们是 JS API 调用，不在模板里用标签，resolver 无法从模板扫描引入样式）
    AutoImport({
      imports: [],
      resolvers: [ElementPlusResolver()],
      dts: false
    }),
    Components({
      resolvers: [ElementPlusResolver()],
      dts: false
    })
  ],
  define: {
    'import.meta.env.VITE_VERSION': JSON.stringify(version)
  },
  // esnext everywhere so the dev server's esbuild transform also accepts
  // top-level await (used by @novnc/novnc). `build.target` alone only affects
  // the production bundle; without this the `wails3 dev` Vite server crashes.
  build: {
    target: 'esnext'
  },
  esbuild: {
    target: 'esnext'
  },
  // NOTE: no optimizeDeps target needed on Vite 8 (rolldown pre-bundling does
  // no syntax downleveling, so TLA in deps passes through untouched; the old
  // optimizeDeps.esbuildOptions.target is deprecated and has no rolldown
  // equivalent).
  server: {
    host: '127.0.0.1',
    port: parseInt(process.env.VITE_PORT || '9245'),
    strictPort: true
  }
})
