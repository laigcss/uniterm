// Minimal Node.js module shims for test files that read backend Go sources.
// Only declares the APIs actually used by settings.schema.test.ts.
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: string): string
  export function readFileSync(path: string): Buffer
}
declare module 'node:path' {
  export function dirname(path: string): string
  export function resolve(...paths: string[]): string
  export function join(...paths: string[]): string
}
declare module 'node:url' {
  export function fileURLToPath(url: string): string
}