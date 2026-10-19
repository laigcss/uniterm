/**
 * libnative_process.so NAPI 模块类型声明
 *
 * 声明 native_process.c 通过 Node-API 导出的所有方法。
 * 供 ArkTS 通过 import nativeModule from 'libnative_process.so' 调用。
 */

export const native_start: (binaryPath: string, port: number) => number;
export const native_stop: (pid: number) => void;
export const native_is_running: (pid: number) => boolean;
export const native_chmod: (path: string, mode: number) => number;
export const native_save_executable: (path: string, data: Uint8Array) => number;
export const native_is_executable: (path: string) => boolean;
export const native_wait_for_health: (url: string, timeoutMs: number) => boolean;
export const native_get_process_info: (pid: number) => Record<string, number | boolean>;
export const native_watch_process: (pid: number, binaryPath: string, port: number) => number;
export const native_stop_watch: () => void;
export const native_init_signals: () => void;export const native_start_server: (soPath: string, port: number) => number;export const native_start_http_server: (docRoot: string, port: number) => number;
export const native_stop_http_server: () => void;export const native_set_data_dir_root: (path: string) => void;