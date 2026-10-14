import hilog from "@ohos:hilog";
import { native_start, native_start_server, native_start_http_server, native_stop_http_server, native_stop, native_is_running, native_chmod, native_save_executable, native_is_executable, native_wait_for_health, native_init_signals, } from "@normalized:Y&&&libaiops_native.so&";
const DOMAIN: number = 0x9206;
const TAG: string = 'NativeProcess';
/**
 * 子进程退出回调类型。
 *
 * @param pid 退出的子进程 PID
 * @param exitCode 退出码（-1 表示异常退出/被信号终止）
 */
type ProcessExitCallback = (pid: number, exitCode: number) => void;
/**
 * 进程资源使用信息。
 */
class ProcessInfo {
    /** 子进程 PID */
    pid: number = -1;
    /** 是否正在运行 */
    isRunning: boolean = false;
    /** 内存占用（KB） */
    memoryUsageKB: number = 0;
    /** CPU 占用百分比 */
    cpuUsagePercent: number = 0;
}
/**
 * NDK 子进程管理工具类。
 *
 * 通过 Node-API (NAPI) 调用 C 原生方法（libnative_process.so），
 * 使用 fork + execve 启动 Go 二进制作为子进程。
 */
export class NativeProcess {
    /** 当前子进程 PID，-1 表示未启动 */
    private pid: number = -1;
    /** 上次启动使用的二进制路径（用于 restart） */
    private lastBinaryPath: string = '';
    /** 上次启动使用的端口（用于 restart） */
    private lastPort: number = 0;
    /** 子进程退出回调 */
    private exitCallback: ProcessExitCallback | null = null;
    /**
     * 初始化信号处理（SIGCHLD 回收僵尸进程 + 记录退出码，SIGPIPE 忽略）。
     *
     * 必须在 start() 之前调用，否则子进程崩溃时无法捕获退出码/信号。
     */
    initSignals(): void {
        try {
            native_init_signals();
            hilog.info(DOMAIN, TAG, '信号处理器已安装 (SIGCHLD + SIGPIPE)');
        }
        catch (err) {
            hilog.error(DOMAIN, TAG, `安装信号处理器失败: ${JSON.stringify(err)}`);
        }
    }
    /**
     * 通过 dlopen 加载 Go c-shared 共享库，启动 HTTP 服务器。
     *
     * 在独立线程中调用 dlopen，触发 Go runtime 初始化并启动 HTTP 服务器。
     * 不创建子进程，Go 代码在当前进程中运行。
     *
     * @param soPath Go c-shared 共享库（.so）在可写目录中的完整路径
     * @param port Go 后端监听端口
     * @returns 0 表示线程已启动，-1 表示失败
     * @throws 启动失败时抛出异常
     */
    async startServer(soPath: string, port: number): Promise<number> {
        hilog.info(DOMAIN, TAG, `startServer: so=${soPath}, port=${port}`);
        const result: number = native_start_server(soPath, port);
        if (result !== 0) {
            throw new Error(`dlopen 启动失败，错误码: ${result}`);
        }
        hilog.info(DOMAIN, TAG, 'dlopen 线程已启动');
        return result;
    }
    /**
     * 启动 Go 二进制子进程。
     *
     * @param binaryPath Go 二进制在可写目录中的完整路径
     * @param port Go 后端监听端口
     * @returns 子进程 PID
     * @throws 启动失败时抛出异常
     */
    async start(binaryPath: string, port: number): Promise<number> {
        hilog.info(DOMAIN, TAG, `start: binary=${binaryPath}, port=${port}`);
        this.lastBinaryPath = binaryPath;
        this.lastPort = port;
        if (this.pid > 0) {
            hilog.warn(DOMAIN, TAG, `已有子进程运行 (PID=${this.pid})，先停止`);
            this.stop();
        }
        const result: number = native_start(binaryPath, port);
        if (result <= 0) {
            throw new Error(`NDK execve 失败，错误码: ${result}`);
        }
        this.pid = result;
        hilog.info(DOMAIN, TAG, `子进程启动成功, PID=${this.pid}`);
        return this.pid;
    }
    /**
     * 停止 Go 子进程。
     */
    stop(): void {
        if (this.pid <= 0) {
            hilog.info(DOMAIN, TAG, 'stop: 无子进程运行');
            return;
        }
        hilog.info(DOMAIN, TAG, `stop: 终止子进程 PID=${this.pid}`);
        try {
            native_stop(this.pid);
        }
        catch (err) {
            hilog.error(DOMAIN, TAG, `停止子进程失败: ${JSON.stringify(err)}`);
        }
        this.pid = -1;
    }
    /**
     * 重启 Go 子进程。
     */
    async restart(): Promise<number> {
        hilog.info(DOMAIN, TAG, 'restart: 重启子进程');
        if (this.lastBinaryPath.length === 0 || this.lastPort <= 0) {
            throw new Error('无可用的重启参数，请先调用 start');
        }
        this.stop();
        return await this.start(this.lastBinaryPath, this.lastPort);
    }
    /**
     * 注册子进程退出回调。
     */
    onExit(callback: ProcessExitCallback): void {
        this.exitCallback = callback;
        hilog.info(DOMAIN, TAG, '子进程退出回调已注册');
    }
    /**
     * 检查子进程是否已退出，若退出则触发 onExit 回调。
     */
    checkAndNotifyExit(): void {
        if (this.pid > 0 && !this.isRunning()) {
            const exitedPid: number = this.pid;
            this.pid = -1;
            hilog.warn(DOMAIN, TAG, `检测到子进程已退出: PID=${exitedPid}`);
            if (this.exitCallback !== null) {
                this.exitCallback(exitedPid, -1);
            }
        }
    }
    /**
     * 检查子进程是否仍在运行。
     */
    isRunning(): boolean {
        if (this.pid <= 0) {
            return false;
        }
        try {
            return native_is_running(this.pid);
        }
        catch (err) {
            hilog.error(DOMAIN, TAG, `检查进程状态失败: ${JSON.stringify(err)}`);
            return false;
        }
    }
    /**
     * 修改文件权限（通过 NDK chmod 系统调用）。
     */
    async chmod(path: string, mode: number): Promise<void> {
        hilog.info(DOMAIN, TAG, `chmod: path=${path}, mode=${mode.toString(8)}`);
        const result: number = native_chmod(path, mode);
        if (result !== 0) {
            throw new Error(`chmod 失败，错误码: ${result}`);
        }
    }
    /**
     * 将二进制数据写入文件并赋予执行权限（0755）。
     *
     * 在 C 代码中用 open(O_CREAT|O_WRONLY|O_TRUNC, 0755) + fchmod(0755) 创建文件，
     * 避免 chmod() 被 SELinux 阻止的问题。
     *
     * @param path 目标文件路径
     * @param data 二进制数据
     */
    async saveExecutable(path: string, data: Uint8Array): Promise<void> {
        hilog.info(DOMAIN, TAG, `saveExecutable: path=${path}, size=${data.byteLength}`);
        // 调试：打印 nativeModule 信息
        hilog.info(DOMAIN, TAG, `typeof native_save_executable: ${typeof native_save_executable}`);
        const result: number = native_save_executable(path, data);
        if (result !== 0) {
            throw new Error(`saveExecutable 失败，错误码: ${result}`);
        }
        hilog.info(DOMAIN, TAG, `saveExecutable 成功`);
    }
    /**
     * 检查文件是否存在且可执行。
     */
    async isExecutable(path: string): Promise<boolean> {
        try {
            return native_is_executable(path);
        }
        catch (err) {
            hilog.warn(DOMAIN, TAG, `isExecutable 失败: ${JSON.stringify(err)}`);
            return false;
        }
    }
    /**
     * 轮询健康检查端点，等待 HTTP 服务器就绪。
     *
     * @param url 健康检查 URL（如 http://localhost:9245/）
     * @param timeoutMs 单次轮询超时时间（毫秒）
     * @returns true 表示服务器已就绪
     */
    async waitForHealth(url: string, timeoutMs: number): Promise<boolean> {
        try {
            return native_wait_for_health(url, timeoutMs);
        }
        catch (err) {
            hilog.warn(DOMAIN, TAG, `健康检查失败: ${JSON.stringify(err)}`);
            return false;
        }
    }
    /** 获取当前子进程 PID */
    getPid(): number {
        return this.pid;
    }
    /**
     * 启动内嵌 C HTTP 服务器。
     *
     * 在 NAPI 模块内运行，无需 execve/dlopen。
     * 服务前端静态文件 + 健康检查端点。
     *
     * @param docRoot 文档根目录（前端文件所在目录）
     * @param port 监听端口
     * @returns 0 成功，-1 失败，-2 已在运行
     */
    startHttpServer(docRoot: string, port: number): number {
        hilog.info(DOMAIN, TAG, `startHttpServer: docRoot=${docRoot}, port=${port}`);
        const result: number = native_start_http_server(docRoot, port);
        if (result !== 0) {
            hilog.error(DOMAIN, TAG, `startHttpServer 失败，错误码: ${result}`);
        }
        else {
            hilog.info(DOMAIN, TAG, 'HTTP 服务器已启动');
        }
        return result;
    }
    /**
     * 停止内嵌 C HTTP 服务器。
     */
    stopHttpServer(): void {
        hilog.info(DOMAIN, TAG, 'stopHttpServer');
        try {
            native_stop_http_server();
        }
        catch (err) {
            hilog.error(DOMAIN, TAG, `stopHttpServer 失败: ${JSON.stringify(err)}`);
        }
    }
}
