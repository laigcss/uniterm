import web_webview from '@ohos.web.webview';
import { common, abilityAccessCtrl, Permissions } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { resourceManager } from '@kit.LocalizationKit';
import { NativeProcess } from '../utils/NativeProcess';

const DOMAIN: number = 0x9205;
const TAG: string = 'IndexPage';

/** Go 后端默认监听端口（与 main.go ServerOptions.Port 一致） */
const DEFAULT_PORT: number = 9245;

/** Go 二进制在 rawfile 中的文件名 */
const BINARY_NAME: string = 'ai-ops-terminal';

/** 健康检查轮询间隔（毫秒） */
const HEALTH_CHECK_INTERVAL_MS: number = 500;

/** 健康检查最大等待时间（毫秒） */
const HEALTH_CHECK_TIMEOUT_MS: number = 30000;

/**
 * 主页面：ArkWeb 组件加载 Go 后端提供的前端 UI。
 *
 * 生命周期流程：
 *   aboutToAppear → 释放 Go 二进制 → 启动子进程 → 等待健康检查 → 显示 ArkWeb
 *   aboutToDisappear → 终止 Go 子进程
 */
@Entry
@Component
struct Index {
  private controller: web_webview.WebviewController = new web_webview.WebviewController();
  @State serverReady: boolean = false;
  @State port: number = DEFAULT_PORT;
  @State errorMsg: string = '';
  @State retryCount: number = 0;

  private nativeProcess: NativeProcess = new NativeProcess();
  private context: common.UIAbilityContext = getContext(this) as common.UIAbilityContext;

  build() {
    Stack() {
      if (this.serverReady) {
        // Go 后端就绪，加载前端 UI
        Web({ src: `http://localhost:${this.port}`, controller: this.controller })
          .width('100%')
          .height('100%')
          .javaScriptAccess(true)
          .domStorageAccess(true)
          .fileAccess(true)
          .geolocationAccess(true)
          .mixedMode(MixedMode.All)
          .imageAccess(true)
          .onlineImageAccess(true)
          .onControllerAttached(() => {
            hilog.info(DOMAIN, TAG, 'ArkWeb 控制器已附加');
          })
          .onPageBegin((event) => {
            hilog.info(DOMAIN, TAG, `页面开始加载: ${event.url}`);
          })
          .onPageEnd(() => {
            hilog.info(DOMAIN, TAG, '页面加载完成');
          })
          .onErrorReceive((event) => {
            hilog.error(DOMAIN, TAG, `页面加载错误: ${event.error?.errorString ?? 'unknown'}`);
          })
      } else {
        // 启动等待页面
        Column() {
          if (this.errorMsg.length > 0) {
            // 错误状态
            Image($r('sys.media.ohos_ic_public_fail'))
              .width(48)
              .height(48)
              .fillColor('#FF4D4F')
            Text(this.errorMsg)
              .fontSize(14)
              .fontColor('#FF4D4F')
              .margin({ top: 16 })
              .textAlign(TextAlign.Center)
              .maxLines(3)
            Button('重试')
              .type(ButtonType.Capsule)
              .margin({ top: 24 })
              .onClick(() => {
                this.errorMsg = '';
                this.retryCount++;
                this.startBackend();
              })
          } else {
            // 加载中
            LoadingProgress()
              .width(60)
              .height(60)
              .color('#007DFF')
            Text('正在启动 ai-ops-terminal...')
              .fontSize(16)
              .margin({ top: 20 })
              .fontColor('#333333')
            Text(`端口: localhost:${this.port}`)
              .fontSize(12)
              .margin({ top: 8 })
              .fontColor('#999999')
          }
        }
        .width('100%')
        .height('100%')
        .justifyContent(FlexAlign.Center)
        .backgroundColor('#FFFFFF')
      }
    }
  }

  async aboutToAppear(): Promise<void> {
    hilog.info(DOMAIN, TAG, 'aboutToAppear: 页面初始化');
    await this.startBackend();
  }

  aboutToDisappear(): void {
    hilog.info(DOMAIN, TAG, 'aboutToDisappear: 停止 Go 子进程');
    this.stopBackend();
  }

  /**
   * 启动后端：释放 Go 二进制 → 启动子进程 → 等待健康检查。
   */
  private async startBackend(): Promise<void> {
    try {
      // 步骤 1：从 rawfile 释放 Go 二进制到可写目录
      hilog.info(DOMAIN, TAG, '步骤 1: 释放 Go 二进制到可写目录');
      const binaryPath: string = await this.extractBinary();

      // 步骤 2：通过 NDK execve 启动 Go 子进程
      hilog.info(DOMAIN, TAG, `步骤 2: 启动 Go 子进程: ${binaryPath}`);
      const pid: number = await this.nativeProcess.start(binaryPath, this.port);
      hilog.info(DOMAIN, TAG, `Go 子进程已启动, PID: ${pid}`);

      // 步骤 3：等待 HTTP 服务器就绪
      hilog.info(DOMAIN, TAG, '步骤 3: 等待健康检查通过');
      const healthy: boolean = await this.waitForHealth();
      if (healthy) {
        hilog.info(DOMAIN, TAG, '健康检查通过，服务器就绪');
        this.serverReady = true;
      } else {
        hilog.error(DOMAIN, TAG, '健康检查超时，服务器未就绪');
        this.errorMsg = '后端启动超时，请检查 Go 二进制是否正确';
      }
    } catch (err) {
      hilog.error(DOMAIN, TAG, `启动后端失败: ${JSON.stringify(err)}`);
      this.errorMsg = `启动失败: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  /**
   * 停止后端：终止 Go 子进程。
   */
  private stopBackend(): void {
    try {
      this.nativeProcess.stop();
      hilog.info(DOMAIN, TAG, 'Go 子进程已停止');
    } catch (err) {
      hilog.error(DOMAIN, TAG, `停止子进程失败: ${JSON.stringify(err)}`);
    }
  }

  /**
   * 从 rawfile 释放 Go 二进制到应用沙箱可写目录。
   *
   * rawfile 目录是只读的，无法直接执行其中的二进制。
   * 需要复制到 filesDir 并赋予执行权限。
   *
   * @returns Go 二进制在可写目录中的完整路径
   */
  private async extractBinary(): Promise<string> {
    const filesDir: string = this.context.filesDir;
    const targetPath: string = `${filesDir}/${BINARY_NAME}`;

    // 检查是否已存在且可执行（避免每次启动都复制）
    if (await this.nativeProcess.isExecutable(targetPath)) {
      hilog.info(DOMAIN, TAG, `Go 二进制已存在且可执行: ${targetPath}`);
      return targetPath;
    }

    // 从 rawfile 读取 Go 二进制数据
    const resourceMgr: resourceManager.ResourceManager = this.context.resourceManager;
    const binaryData: Uint8Array = await resourceMgr.getRawFileContent(BINARY_NAME);
    hilog.info(DOMAIN, TAG, `从 rawfile 读取二进制: ${binaryData.byteLength} 字节`);

    // 写入可写目录
    const file = fs.openSync(targetPath, fs.OpenMode.CREATE | fs.OpenMode.WRITE_ONLY | fs.OpenMode.TRUNC);
    fs.writeSync(file.fd, binaryData.buffer);
    fs.closeSync(file);
    hilog.info(DOMAIN, TAG, `二进制已写入: ${targetPath}`);

    // 通过 NDK chmod 赋予执行权限
    await this.nativeProcess.chmod(targetPath, 0o755);
    hilog.info(DOMAIN, TAG, '已赋予执行权限');

    return targetPath;
  }

  /**
   * 轮询健康检查端点，等待 Go HTTP 服务器就绪。
   *
   * @returns true 表示服务器就绪，false 表示超时
   */
  private async waitForHealth(): Promise<boolean> {
    const url: string = `http://localhost:${this.port}/`;
    const maxAttempts: number = HEALTH_CHECK_TIMEOUT_MS / HEALTH_CHECK_INTERVAL_MS;

    for (let i: number = 0; i < maxAttempts; i++) {
      try {
        const ready: boolean = await this.nativeProcess.waitForHealth(url, HEALTH_CHECK_INTERVAL_MS);
        if (ready) {
          return true;
        }
      } catch (err) {
        // 忽略轮询期间的连接错误（服务器尚未启动）
      }
    }
    return false;
  }
}

// 导入文件系统模块（放在文件底部避免循环依赖）
import { fs } from '@kit.ArkUI';