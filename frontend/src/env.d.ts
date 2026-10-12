/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_VERSION: string
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

// Wails bindings (Go -> JS) 仅生成 .js，无 .d.ts；统一声明为 any 以通过 vue-tsc。
// 覆盖 ../../bindings/github.com/laigcss/ai-ops-terminal/app、.../backend/store/models 等所有子路径。
declare module '../../bindings/github.com/laigcss/ai-ops-terminal/*'
declare module '../../../bindings/github.com/laigcss/ai-ops-terminal/*'
declare module '../bindings/github.com/laigcss/ai-ops-terminal/*'
declare module 'bindings/github.com/laigcss/ai-ops-terminal/*'

// 第三方无类型声明的模块
declare module '@novnc/novnc'
// P1: vue-virtual-scroller 仅 ship UMD/CJS，无类型声明；用 any 通过 vue-tsc。
declare module 'vue-virtual-scroller' {
  import type { DefineComponent } from 'vue'
  export const RecycleScroller: DefineComponent<any, any, any>
  export const DynamicScroller: DefineComponent<any, any, any>
  export const DynamicScrollerItem: DefineComponent<any, any, any>
}

