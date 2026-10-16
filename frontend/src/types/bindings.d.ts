// Wails v3 generates plain-JS bindings (no .d.ts). Declaring the modules as
// any keeps the generated layer out of type-check scope; the call sites
// annotate their own shapes.
declare module '*/bindings/github.com/laigcss/ai-ops-terminal/app';
declare module '*/bindings/github.com/laigcss/ai-ops-terminal/backend/store/models';
declare module '*/bindings/github.com/laigcss/ai-ops-terminal/backend/sync/models';
