import { hilog } from '@kit.PerformanceAnalysisKit';

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
 * 原生层返回的进程信息原始结构（JSON 解析用）。
 */
interface ProcessInfoRaw {
  memoryKB: number;
  cpuPercent: number;
}

/**
 * NDK 子进程管理工具类。
 *
 * 通过 Node-API (NAPI) 调用 C 原生方法（libnative_process.so），
 * 使用 fork + execve 启动 Go 二进制作为子进程。
 *
 * 原生方法清单（对应 native_process.c 中的 NAPI 导出）：
 *   - native_start(binaryPath, port)          → 返回子进程 PID
 *   - native_stop(pid)                        → 终止子进程
 *   - native_is_running(pid)                  → 检查子进程是否存活
 *   - native_chmod(path, mode)                → 修改文件权限
 *   - native_is_executable(path)              → 检查文件是否可执行
 *   - native_wait_for_health(url, timeoutMs)  → 轮询健康检查端点
 *   - native_get_process_info(pid)            → 获取进程内存/CPU 使用情况（JSON 字符串）
 *
 * 注意：本文件为骨架/模板，实际 NAPI 绑定需要在 DevEco Studio 中
 * 配置 CMakeLists.txt 并编译 native_process.c 为 libnative_process.so。
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
   * 启动 Go 二进制子进程。
   *
   * 通过 NDK fork + execve 启动子进程，设置环境变量
   * AI_OPS_HOST=localhost 和 AI_OPS_PORT=<port>。
   *
   * @param binaryPath Go 二进制在可写目录中的完整路径
   * @param port Go 后端监听端口
   * @returns 子进程 PID
   * @throws 启动失败时抛出异常
   */
  async start(binaryPath: string, port: number): Promise<number> {
    hilog.info(DOMAIN, TAG, `start: binary=${binaryPath}, port=${port}`);

    // 保存启动参数用于后续 restart
    this.lastBinaryPath = binaryPath;
    this.lastPort = port;

    // 如果已有子进程在运行，先停止
    if (this.pid > 0) {
      hilog.warn(DOMAIN, TAG, `已有子进程运行 (PID=${this.pid})，先停止`);
      this.stop();
    }

    // 调用 NDK 原生方法启动子进程
    // native_start 返回子进程 PID（>0 成功，<0 失败）
    const result: number = nativeStart(binaryPath, port);
    if (result <= 0) {
      throw new Error(`NDK execve 失败，错误码: ${result}`);
    }

    this.pid = result;
    hilog.info(DOMAIN, TAG, `子进程启动成功, PID=${this.pid}`);
    return this.pid;
  }

  /**
   * 停止 Go 子进程。
   *
   * 发送 SIGTERM 优雅终止，等待 3 秒后若仍存活则发送 SIGKILL 强制终止。
   */
  stop(): void {
    if (this.pid <= 0) {
      hilog.info(DOMAIN, TAG, 'stop: 无子进程运行');
      return;
    }

    hilog.info(DOMAIN, TAG, `stop: 终止子进程 PID=${this.pid}`);
    try {
      nativeStop(this.pid);
    } catch (err) {
      hilog.error(DOMAIN, TAG, `停止子进程失败: ${JSON.stringify(err)}`);
    }
    this.pid = -1;
  }

  /**
   * 重启 Go 子进程。
   *
   * 停止当前子进程后，使用上次启动的参数重新启动。
   * 用于子进程崩溃后的自动恢复。
   *
   * @returns 新的子进程 PID
   * @throws 无可用重启参数或启动失败时抛出异常
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
   *
   * 当 checkAndNotifyExit() 检测到子进程已退出时，会触发此回调。
   * 调用方通常在回调中实现自动重启逻辑。
   *
   * @param callback 退出回调函数
   */
  onExit(callback: ProcessExitCallback): void {
    this.exitCallback = callback;
    hilog.info(DOMAIN, TAG, '子进程退出回调已注册');
  }

  /**
   * 检查子进程是否已退出，若退出则触发 onExit 回调。
   *
   * 由外部定时器周期调用（如 Index 页面的进程监控定时器）。
   * 检测到子进程不再运行时，重置 PID 并调用注册的退出回调。
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
   *
   * @returns true 表示子进程存活
   */
  isRunning(): boolean {
    if (this.pid <= 0) {
      return false;
    }
    try {
      return nativeIsRunning(this.pid);
    } catch (err) {
      hilog.error(DOMAIN, TAG, `检查进程状态失败: ${JSON.stringify(err)}`);
      return false;
    }
  }

  /**
   * 获取进程资源使用信息（内存/CPU）。
   *
   * 通过 NDK 读取 /proc/<pid>/status 和 /proc/<pid>/stat 获取
   * 内存占用和 CPU 使用率。
   *
   * @returns 进程信息对象
   */
  getProcessInfo(): ProcessInfo {
    const info: ProcessInfo = new ProcessInfo();
    info.pid = this.pid;
    info.isRunning = this.isRunning();
    if (this.pid > 0 && info.isRunning) {
      try {
        const raw: string = nativeGetProcessInfo(this.pid);
        // 解析原生返回的 JSON: {"memoryKB":1234,"cpuPercent":5.6}
        const obj: ProcessInfoRaw = JSON.parse(raw) as ProcessInfoRaw;
        info.memoryUsageKB = obj.memoryKB;
        info.cpuUsagePercent = obj.cpuPercent;
      } catch (err) {
        hilog.warn(DOMAIN, TAG, `获取进程信息失败: ${JSON.stringify(err)}`);
      }
    }
    return info;
  }

  /**
   * 修改文件权限（通过 NDK chmod 系统调用）。
   *
   * @param path 文件路径
   * @param mode 权限模式（如 0o755）
   */
  async chmod(path: string, mode: number): Promise<void> {
    hilog.info(DOMAIN, TAG, `chmod: path=${path}, mode=${mode.toString(8)}`);
    const result: number = nativeChmod(path, mode);
    if (result !== 0) {
      throw new Error(`chmod 失败，错误码: ${result}`);
    }
  }

  /**
   * 检查文件是否存在且可执行。
   *
   * @param path 文件路径
   * @returns true 表示文件存在且可执行
   */
  async isExecutable(path: string): Promise<boolean> {
    try {
      return nativeIsExecutable(path);
    } catch (err) {
      // NAPI 方法未绑定（骨架模式），返回 false
      return false;
    }
  }

  /**
   * 轮询健康检查端点，等待 HTTP 服务器就绪。
   *
   * 使用原生 HTTP 请求（避免 ArkTS http 模块的异步复杂性），
   * 尝试连接指定 URL，收到任意 HTTP 响应即认为服务器就绪。
   *
   * @param url 健康检查 URL（如 http://localhost:9245/）
   * @param timeoutMs 单次轮询超时时间（毫秒）
   * @returns true 表示服务器已就绪
   */
  async waitForHealth(url: string, timeoutMs: number): Promise<boolean> {
    try {
      return nativeWaitForHealth(url, timeoutMs);
    } catch (err) {
      hilog.warn(DOMAIN, TAG, `健康检查失败: ${JSON.stringify(err)}`);
      return false;
    }
  }

  /** 获取当前子进程 PID */
  getPid(): number {
    return this.pid;
  }
}

// ============================================================================
// NAPI 原生方法声明
//
// 这些方法由 libnative_process.so（native_process.c 编译产物）通过
// Node-API 导出。在 DevEco Studio 中配置 CMakeLists.txt 后自动绑定。
//
// 骨架模式下这些声明仅为接口定义，实际编译时需要：
//   1. 在 entry/src/main/cpp/ 下创建 CMakeLists.txt
//   2. 将 native_process.c 复制到 entry/src/main/cpp/
//   3. 配置 build-profile.json5 的 externalNativeOptions
// ============================================================================

declare function nativeStart(binaryPath: string, port: number): number;
declare function nativeStop(pid: number): void;
declare function nativeIsRunning(pid: number): boolean;
declare function nativeChmod(path: string, mode: number): number;
declare function nativeIsExecutable(path: string): boolean;
declare function nativeWaitForHealth(url: string, timeoutMs: number): boolean;
declare function nativeGetProcessInfo(pid: number): string;