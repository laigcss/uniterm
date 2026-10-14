if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface Index_Params {
    controller?: web_webview.WebviewController;
    serverReady?: boolean;
    port?: number;
    errorMsg?: string;
    retryCount?: number;
    backendStatus?: string;
    nativeProcess?: NativeProcess;
    context?: common.UIAbilityContext;
    jsBridge?: JsBridge | null;
    monitorTimerId?: number;
    autoRestartCount?: number;
    binaryPath?: string;
}
import web_webview from "@ohos:web.webview";
import type common from "@ohos:app.ability.common";
import abilityAccessCtrl from "@ohos:abilityAccessCtrl";
import type { Permissions } from "@ohos:abilityAccessCtrl";
import hilog from "@ohos:hilog";
import type resourceManager from "@ohos:resourceManager";
import fs from "@ohos:file.fs";
import { NativeProcess } from "@normalized:N&&&entry/src/main/ets/utils/NativeProcess&";
const DOMAIN: number = 0x9205;
const TAG: string = 'IndexPage';
/** Go 后端默认监听端口（与 main.go ServerOptions.Port 一致） */
const DEFAULT_PORT: number = 9245;
/** Go c-shared 共享库在 rawfile 中的文件名 */
const BINARY_NAME: string = 'libaiops.so';
/** 健康检查轮询间隔（毫秒） */
const HEALTH_CHECK_INTERVAL_MS: number = 500;
/** 健康检查最大等待时间（毫秒） */
const HEALTH_CHECK_TIMEOUT_MS: number = 30000;
/** 进程存活监控间隔（毫秒），每 5 秒检查一次 */
const PROCESS_MONITOR_INTERVAL_MS: number = 5000;
/** 进程崩溃后最大自动重启次数 */
const MAX_AUTO_RESTART_COUNT: number = 3;
/** JSBridge 在前端 window 上注册的对象名 */
const JS_BRIDGE_NAME: string = 'harmonyBridge';
/** 应用版本号（供前端查询） */
const APP_VERSION: string = '1.0.0';
/**
 * JSBridge 通信对象。
 *
 * 通过 controller.registerJavaScriptProxy() 注册到前端 window 上，
 * 前端可通过 window.harmonyBridge.xxx() 调用 ArkTS 方法，
 * 实现原生与前端的双向通信。
 */
class JsBridge {
    private port: number;
    private version: string;
    private onRestartCallback: () => void;
    private onExitCallback: () => void;
    constructor(port: number, version: string, onRestart: () => void, onExit: () => void) {
        this.port = port;
        this.version = version;
        this.onRestartCallback = onRestart;
        this.onExitCallback = onExit;
    }
    /** 获取应用版本号 */
    getAppVersion(): string {
        return this.version;
    }
    /** 获取后端服务端口 */
    getBackendPort(): number {
        return this.port;
    }
    /** 获取后端基础 URL */
    getBackendUrl(): string {
        return `http://localhost:${this.port}`;
    }
    /** 前端日志转发到 hilog，便于调试 */
    log(message: string): void {
        hilog.info(DOMAIN, 'JsBridge', message);
    }
    /** 重启 Go 后端子进程 */
    restartBackend(): void {
        hilog.info(DOMAIN, 'JsBridge', '前端请求重启后端');
        this.onRestartCallback();
    }
    /** 退出应用 */
    exitApp(): void {
        hilog.info(DOMAIN, 'JsBridge', '前端请求退出应用');
        this.onExitCallback();
    }
}
class Index extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.controller = new web_webview.WebviewController();
        this.__serverReady = new ObservedPropertySimplePU(false, this, "serverReady");
        this.__port = new ObservedPropertySimplePU(DEFAULT_PORT, this, "port");
        this.__errorMsg = new ObservedPropertySimplePU('', this, "errorMsg");
        this.__retryCount = new ObservedPropertySimplePU(0, this, "retryCount");
        this.__backendStatus = new ObservedPropertySimplePU('正在启动...', this, "backendStatus");
        this.nativeProcess = new NativeProcess();
        this.context = getContext(this) as common.UIAbilityContext;
        this.jsBridge = null;
        this.monitorTimerId = -1;
        this.autoRestartCount = 0;
        this.binaryPath = '';
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: Index_Params) {
        if (params.controller !== undefined) {
            this.controller = params.controller;
        }
        if (params.serverReady !== undefined) {
            this.serverReady = params.serverReady;
        }
        if (params.port !== undefined) {
            this.port = params.port;
        }
        if (params.errorMsg !== undefined) {
            this.errorMsg = params.errorMsg;
        }
        if (params.retryCount !== undefined) {
            this.retryCount = params.retryCount;
        }
        if (params.backendStatus !== undefined) {
            this.backendStatus = params.backendStatus;
        }
        if (params.nativeProcess !== undefined) {
            this.nativeProcess = params.nativeProcess;
        }
        if (params.context !== undefined) {
            this.context = params.context;
        }
        if (params.jsBridge !== undefined) {
            this.jsBridge = params.jsBridge;
        }
        if (params.monitorTimerId !== undefined) {
            this.monitorTimerId = params.monitorTimerId;
        }
        if (params.autoRestartCount !== undefined) {
            this.autoRestartCount = params.autoRestartCount;
        }
        if (params.binaryPath !== undefined) {
            this.binaryPath = params.binaryPath;
        }
    }
    updateStateVars(params: Index_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__serverReady.purgeDependencyOnElmtId(rmElmtId);
        this.__port.purgeDependencyOnElmtId(rmElmtId);
        this.__errorMsg.purgeDependencyOnElmtId(rmElmtId);
        this.__retryCount.purgeDependencyOnElmtId(rmElmtId);
        this.__backendStatus.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__serverReady.aboutToBeDeleted();
        this.__port.aboutToBeDeleted();
        this.__errorMsg.aboutToBeDeleted();
        this.__retryCount.aboutToBeDeleted();
        this.__backendStatus.aboutToBeDeleted();
        SubscriberManager.Get().delete(this.id__());
        this.aboutToBeDeletedInternal();
    }
    private controller: web_webview.WebviewController;
    private __serverReady: ObservedPropertySimplePU<boolean>;
    get serverReady() {
        return this.__serverReady.get();
    }
    set serverReady(newValue: boolean) {
        this.__serverReady.set(newValue);
    }
    private __port: ObservedPropertySimplePU<number>;
    get port() {
        return this.__port.get();
    }
    set port(newValue: number) {
        this.__port.set(newValue);
    }
    private __errorMsg: ObservedPropertySimplePU<string>;
    get errorMsg() {
        return this.__errorMsg.get();
    }
    set errorMsg(newValue: string) {
        this.__errorMsg.set(newValue);
    }
    private __retryCount: ObservedPropertySimplePU<number>;
    get retryCount() {
        return this.__retryCount.get();
    }
    set retryCount(newValue: number) {
        this.__retryCount.set(newValue);
    }
    private __backendStatus: ObservedPropertySimplePU<string>;
    get backendStatus() {
        return this.__backendStatus.get();
    }
    set backendStatus(newValue: string) {
        this.__backendStatus.set(newValue);
    }
    private nativeProcess: NativeProcess;
    private context: common.UIAbilityContext;
    private jsBridge: JsBridge | null;
    private monitorTimerId: number;
    private autoRestartCount: number;
    private binaryPath: string;
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Stack.create();
        }, Stack);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            if (this.serverReady) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        // Go 后端就绪，加载前端 UI
                        Web.create({ src: `http://127.0.0.1:${this.port}`, controller: this.controller });
                        // Go 后端就绪，加载前端 UI
                        Web.width('100%');
                        // Go 后端就绪，加载前端 UI
                        Web.height('100%');
                        // Go 后端就绪，加载前端 UI
                        Web.javaScriptAccess(true);
                        // Go 后端就绪，加载前端 UI
                        Web.domStorageAccess(true);
                        // Go 后端就绪，加载前端 UI
                        Web.fileAccess(true);
                        // Go 后端就绪，加载前端 UI
                        Web.geolocationAccess(true);
                        // Go 后端就绪，加载前端 UI
                        Web.mixedMode(MixedMode.All);
                        // Go 后端就绪，加载前端 UI
                        Web.imageAccess(true);
                        // Go 后端就绪，加载前端 UI
                        Web.onlineImageAccess(true);
                        // Go 后端就绪，加载前端 UI
                        Web.onControllerAttached(() => {
                            hilog.info(DOMAIN, TAG, 'ArkWeb 控制器已附加');
                            this.registerJsBridge();
                        });
                        // Go 后端就绪，加载前端 UI
                        Web.onPageBegin((event) => {
                            hilog.info(DOMAIN, TAG, `页面开始加载: ${event.url}`);
                        });
                        // Go 后端就绪，加载前端 UI
                        Web.onPageEnd(() => {
                            hilog.info(DOMAIN, TAG, '页面加载完成');
                        });
                        // Go 后端就绪，加载前端 UI
                        Web.onErrorReceive((event) => {
                            const errCode: number = event.error?.getErrorCode() ?? -1;
                            const errStr: string = event.error?.getErrorInfo() ?? 'unknown';
                            hilog.error(DOMAIN, TAG, `页面加载错误: code=${errCode}, msg=${errStr}`);
                            this.handleWebError(errCode, errStr);
                        });
                        // Go 后端就绪，加载前端 UI
                        Web.onConsole((event: OnConsoleEvent) => {
                            const consoleMsg: ConsoleMessage = event.message;
                            const level: MessageLevel = consoleMsg.getMessageLevel();
                            const msg: string = consoleMsg.getMessage();
                            const source: string = consoleMsg.getSourceId();
                            const line: number = consoleMsg.getLineNumber();
                            const tag: string = `WebConsole[${source}:${line}]`;
                            if (level === MessageLevel.Error) {
                                hilog.error(DOMAIN, tag, msg);
                            }
                            else if (level === MessageLevel.Warn) {
                                hilog.warn(DOMAIN, tag, msg);
                            }
                            else {
                                hilog.info(DOMAIN, tag, msg);
                            }
                            return false;
                        });
                    }, Web);
                });
            }
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        // 启动等待页面
                        Column.create();
                        // 启动等待页面
                        Column.width('100%');
                        // 启动等待页面
                        Column.height('100%');
                        // 启动等待页面
                        Column.justifyContent(FlexAlign.Center);
                        // 启动等待页面
                        Column.backgroundColor('#FFFFFF');
                    }, Column);
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        If.create();
                        if (this.errorMsg.length > 0) {
                            this.ifElseBranchUpdateFunction(0, () => {
                                this.observeComponentCreation2((elmtId, isInitialRender) => {
                                    // 错误状态
                                    Image.create({ "id": 125830842, "type": 20000, params: [], "bundleName": "com.aiops.terminal", "moduleName": "entry" });
                                    // 错误状态
                                    Image.width(48);
                                    // 错误状态
                                    Image.height(48);
                                    // 错误状态
                                    Image.fillColor('#FF4D4F');
                                }, Image);
                                this.observeComponentCreation2((elmtId, isInitialRender) => {
                                    Text.create(this.errorMsg);
                                    Text.fontSize(14);
                                    Text.fontColor('#FF4D4F');
                                    Text.margin({ top: 16 });
                                    Text.textAlign(TextAlign.Center);
                                    Text.maxLines(3);
                                }, Text);
                                Text.pop();
                                this.observeComponentCreation2((elmtId, isInitialRender) => {
                                    Button.createWithLabel('重试');
                                    Button.type(ButtonType.Capsule);
                                    Button.margin({ top: 24 });
                                    Button.onClick(() => {
                                        this.errorMsg = '';
                                        this.retryCount++;
                                        this.startBackend();
                                    });
                                }, Button);
                                Button.pop();
                            });
                        }
                        else {
                            this.ifElseBranchUpdateFunction(1, () => {
                                this.observeComponentCreation2((elmtId, isInitialRender) => {
                                    // 加载中
                                    LoadingProgress.create();
                                    // 加载中
                                    LoadingProgress.width(60);
                                    // 加载中
                                    LoadingProgress.height(60);
                                    // 加载中
                                    LoadingProgress.color('#007DFF');
                                }, LoadingProgress);
                                this.observeComponentCreation2((elmtId, isInitialRender) => {
                                    Text.create(this.backendStatus);
                                    Text.fontSize(16);
                                    Text.margin({ top: 20 });
                                    Text.fontColor('#333333');
                                }, Text);
                                Text.pop();
                                this.observeComponentCreation2((elmtId, isInitialRender) => {
                                    Text.create(`端口: localhost:${this.port}`);
                                    Text.fontSize(12);
                                    Text.margin({ top: 8 });
                                    Text.fontColor('#999999');
                                }, Text);
                                Text.pop();
                            });
                        }
                    }, If);
                    If.pop();
                    // 启动等待页面
                    Column.pop();
                });
            }
        }, If);
        If.pop();
        Stack.pop();
    }
    async aboutToAppear(): Promise<void> {
        hilog.info(DOMAIN, TAG, 'aboutToAppear: 页面初始化');
        // 注册子进程退出回调
        this.nativeProcess.onExit((pid: number, exitCode: number) => {
            this.handleProcessExit(pid, exitCode);
        });
        // 安装信号处理器（SIGCHLD 捕获子进程退出码/信号，SIGPIPE 忽略）
        this.nativeProcess.initSignals();
        // 请求所需权限
        await this.requestPermissions();
        // 启动后端
        await this.startBackend();
    }
    aboutToDisappear(): void {
        hilog.info(DOMAIN, TAG, 'aboutToDisappear: 停止 Go 子进程');
        this.stopProcessMonitor();
        this.stopBackend();
    }
    /**
     * 请求应用所需权限（网络访问等）。
     */
    private async requestPermissions(): Promise<void> {
        try {
            const atManager: abilityAccessCtrl.AtManager = abilityAccessCtrl.createAtManager();
            const permissions: Array<Permissions> = [
                'ohos.permission.INTERNET',
                'ohos.permission.GET_NETWORK_INFO'
            ];
            await atManager.requestPermissionsFromUser(this.context, permissions);
            hilog.info(DOMAIN, TAG, '权限请求完成');
        }
        catch (err) {
            hilog.error(DOMAIN, TAG, `权限请求失败: ${JSON.stringify(err)}`);
        }
    }
    /**
     * 启动后端：提取前端文件 → 启动内嵌 C HTTP 服务器 → 等待健康检查。
     *
     * 在 NAPI 模块内运行 C HTTP 服务器，无需 execve/dlopen，
     * 绕过 SELinux 对 execve 的限制和 Go TLS 模型对 dlopen 的限制。
     */
    private async startBackend(): Promise<void> {
        try {
            this.backendStatus = '正在提取前端文件...';
            const filesDir: string = this.context.filesDir;
            const docRoot: string = `${filesDir}/frontend`;
            // 步骤 1：从 rawfile 提取前端文件到 filesDir/frontend/
            await this.extractFrontend(docRoot);
            hilog.info(DOMAIN, TAG, `前端文件已提取到 ${docRoot}`);
            // 步骤 2：启动内嵌 C HTTP 服务器
            this.backendStatus = '正在启动 HTTP 服务器...';
            hilog.info(DOMAIN, TAG, `启动 C HTTP 服务器: ${docRoot}:${this.port}`);
            const ret: number = this.nativeProcess.startHttpServer(docRoot, this.port);
            if (ret !== 0) {
                throw new Error(`HTTP 服务器启动失败，错误码: ${ret}`);
            }
            hilog.info(DOMAIN, TAG, 'C HTTP 服务器已启动');
            // 步骤 3：等待 HTTP 服务器就绪
            this.backendStatus = '等待服务器就绪...';
            hilog.info(DOMAIN, TAG, '等待健康检查通过');
            const healthy: boolean = await this.waitForHealth();
            if (healthy) {
                hilog.info(DOMAIN, TAG, '健康检查通过，服务器就绪');
                this.serverReady = true;
                this.autoRestartCount = 0;
            }
            else {
                hilog.error(DOMAIN, TAG, '健康检查超时，服务器未就绪');
                this.errorMsg = '后端启动超时，HTTP 服务器未就绪';
            }
        }
        catch (err) {
            const errMsg: string = err instanceof Error ? err.message : JSON.stringify(err);
            hilog.error(DOMAIN, TAG, `启动后端失败: ${errMsg}`);
            this.errorMsg = `启动失败: ${errMsg}`;
        }
    }
    /**
     * 停止后端：停止内嵌 C HTTP 服务器。
     */
    private stopBackend(): void {
        try {
            this.nativeProcess.stopHttpServer();
            hilog.info(DOMAIN, TAG, 'HTTP 服务器已停止');
        }
        catch (err) {
            hilog.error(DOMAIN, TAG, `停止 HTTP 服务器失败: ${JSON.stringify(err)}`);
        }
    }
    /**
     * 重启后端：停止当前子进程后重新启动。
     */
    private async restartBackend(): Promise<void> {
        hilog.info(DOMAIN, TAG, '重启后端');
        this.stopProcessMonitor();
        this.stopBackend();
        this.serverReady = false;
        this.backendStatus = '正在重启...';
        await this.startBackend();
    }
    /**
     * 退出应用：停止后端并终止自身。
     */
    private exitApp(): void {
        hilog.info(DOMAIN, TAG, '退出应用');
        this.stopProcessMonitor();
        this.stopBackend();
        this.context.terminateSelf();
    }
    /**
     * 注册 JSBridge 到前端 window 对象。
     *
     * 在 ArkWeb 控制器附加后调用，通过 registerJavaScriptProxy 将
     * ArkTS 对象注入前端，前端可通过 window.harmonyBridge 访问。
     */
    private registerJsBridge(): void {
        try {
            this.jsBridge = new JsBridge(this.port, APP_VERSION, (): void => { this.restartBackend(); }, (): void => { this.exitApp(); });
            this.controller.registerJavaScriptProxy(this.jsBridge, JS_BRIDGE_NAME, ['getAppVersion', 'getBackendPort', 'getBackendUrl', 'log', 'restartBackend', 'exitApp'], []);
            // 刷新页面使 JavaScript 代理生效
            this.controller.refresh();
            hilog.info(DOMAIN, TAG, `JSBridge 已注册为 window.${JS_BRIDGE_NAME}`);
        }
        catch (err) {
            hilog.error(DOMAIN, TAG, `注册 JSBridge 失败: ${JSON.stringify(err)}`);
        }
    }
    /**
     * 启动进程存活监控定时器。
     *
     * 每 5 秒检查 Go 子进程是否存活，若崩溃则尝试自动重启。
     */
    private startProcessMonitor(): void {
        if (this.monitorTimerId !== -1) {
            clearInterval(this.monitorTimerId);
        }
        this.monitorTimerId = setInterval((): void => {
            this.checkProcessAlive();
        }, PROCESS_MONITOR_INTERVAL_MS);
        hilog.info(DOMAIN, TAG, '进程监控定时器已启动');
    }
    /**
     * 停止进程存活监控定时器。
     */
    private stopProcessMonitor(): void {
        if (this.monitorTimerId !== -1) {
            clearInterval(this.monitorTimerId);
            this.monitorTimerId = -1;
            hilog.info(DOMAIN, TAG, '进程监控定时器已停止');
        }
    }
    /**
     * 检查 Go 子进程是否存活，崩溃时触发自动重启。
     */
    private checkProcessAlive(): void {
        // 通过 NativeProcess 检测退出并触发 onExit 回调
        this.nativeProcess.checkAndNotifyExit();
    }
    /**
     * 处理子进程退出事件。
     *
     * @param exitedPid 退出的子进程 PID
     * @param exitCode 退出码（-1 表示异常退出）
     */
    private handleProcessExit(exitedPid: number, exitCode: number): void {
        hilog.error(DOMAIN, TAG, `Go 子进程退出: PID=${exitedPid}, exitCode=${exitCode}`);
        if (this.autoRestartCount < MAX_AUTO_RESTART_COUNT) {
            this.autoRestartCount++;
            hilog.info(DOMAIN, TAG, `尝试自动重启 (${this.autoRestartCount}/${MAX_AUTO_RESTART_COUNT})`);
            this.restartBackend();
        }
        else {
            hilog.error(DOMAIN, TAG, '已达到最大自动重启次数，停止重启');
            this.stopProcessMonitor();
            this.serverReady = false;
            this.errorMsg = '后端进程多次崩溃，已停止自动重启';
        }
    }
    /**
     * 处理 ArkWeb 页面加载错误，区分错误类型给出友好提示。
     *
     * @param errCode 错误码
     * @param errStr 错误描述
     */
    private handleWebError(errCode: number, errStr: string): void {
        const lowerMsg: string = errStr.toLowerCase();
        if (lowerMsg.includes('refused') || lowerMsg.includes('connection refused')) {
            // 连接被拒绝：Go 服务器未启动或已崩溃
            this.errorMsg = '无法连接到后端服务器，Go 子进程可能未运行';
        }
        else if (lowerMsg.includes('timeout') || lowerMsg.includes('timed out')) {
            // 连接超时
            this.errorMsg = '连接后端超时，请检查网络或后端状态';
        }
        else if (lowerMsg.includes('not found') || errCode === -6) {
            // 资源未找到（可能是某个静态资源 404，不影响主页面）
            hilog.warn(DOMAIN, TAG, `资源未找到: ${errStr}`);
        }
        else if (lowerMsg.includes('reset') || lowerMsg.includes('broken pipe')) {
            // 连接被重置：后端进程可能正在重启
            this.errorMsg = '连接被重置，后端可能正在重启';
        }
        else {
            this.errorMsg = `页面加载失败: ${errStr}`;
        }
    }
    /**
     * 从 rawfile 释放 Go 二进制到应用沙箱可写目录。
     *
     * rawfile 目录是只读的，无法直接执行其中的二进制。
     * 通过 NDK saveExecutable 写入 filesDir 并在创建时赋予执行权限（0755），
     * 避免 chmod() 被 SELinux 阻止的问题。
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
        // 通过 NDK 写入文件并赋予执行权限（一步到位，避免 chmod 失败）
        await this.nativeProcess.saveExecutable(targetPath, binaryData);
        hilog.info(DOMAIN, TAG, `二进制已写入并赋予执行权限: ${targetPath}`);
        return targetPath;
    }
    /**
     * 从 rawfile/frontend/ 提取前端文件到 filesDir/frontend/。
     *
     * 前端文件（HTML/JS/CSS/字体）从 HAP 包内的 rawfile 释放到
     * 应用沙箱可写目录，供内嵌 C HTTP 服务器读取和提供服务。
     *
     * @param docRoot 目标目录（filesDir/frontend/）
     */
    private async extractFrontend(docRoot: string): Promise<void> {
        const resourceMgr: resourceManager.ResourceManager = this.context.resourceManager;
        // 创建目录
        const assetsDir: string = `${docRoot}/assets`;
        fs.mkdirSync(docRoot, true);
        fs.mkdirSync(assetsDir, true);
        hilog.info(DOMAIN, TAG, `创建目录: ${docRoot}, ${assetsDir}`);
        // 尝试用 getRawFileList 动态列出文件
        let frontendFiles: Array<string> = [];
        let assetFiles: Array<string> = [];
        try {
            frontendFiles = await resourceMgr.getRawFileList('frontend');
            hilog.info(DOMAIN, TAG, `rawfile/frontend/ 文件列表: ${JSON.stringify(frontendFiles)}`);
        }
        catch (err) {
            hilog.warn(DOMAIN, TAG, `getRawFileList('frontend') 失败: ${JSON.stringify(err)}`);
            // 回退到硬编码文件列表
            frontendFiles = ['index.html'];
        }
        try {
            assetFiles = await resourceMgr.getRawFileList('frontend/assets');
            hilog.info(DOMAIN, TAG, `rawfile/frontend/assets/ 文件列表: ${JSON.stringify(assetFiles)}`);
        }
        catch (err) {
            hilog.warn(DOMAIN, TAG, `getRawFileList('frontend/assets') 失败: ${JSON.stringify(err)}`);
            // 回退到硬编码文件列表
            assetFiles = [
                'app-DHxctazZ.js', 'app-Y4PtkA3Z.js', 'index-7_vZgln6.js', 'index-CQZYFgCv.css',
                'jetbrains-mono-cyrillic-wght-normal-D73BlboJ.woff2',
                'jetbrains-mono-greek-wght-normal-Bw9x6K1M.woff2',
                'jetbrains-mono-latin-ext-wght-normal-DBQx-q_a.woff2',
                'jetbrains-mono-latin-wght-normal-B9CIFXIH.woff2',
                'jetbrains-mono-vietnamese-wght-normal-Bt-aOZkq.woff2',
                'rfb-BZ24CxtX.js', 'spice-html5-CX7F7N4V.js',
            ];
        }
        // 提取 frontend/ 下的文件
        for (const file of frontendFiles) {
            // 跳过目录（getRawFileList 可能返回目录名）
            if (file === 'assets' || file.endsWith('/'))
                continue;
            const rawPath: string = `frontend/${file}`;
            const localPath: string = `${docRoot}/${file}`;
            try {
                const data: Uint8Array = await resourceMgr.getRawFileContent(rawPath);
                hilog.info(DOMAIN, TAG, `读取 ${rawPath}: ${data.byteLength} 字节`);
                if (data.byteLength > 0) {
                    await this.nativeProcess.saveExecutable(localPath, data);
                    hilog.info(DOMAIN, TAG, `提取: ${rawPath} → ${localPath} (${data.byteLength} 字节)`);
                }
                else {
                    hilog.warn(DOMAIN, TAG, `${rawPath} 内容为空`);
                }
            }
            catch (err) {
                hilog.error(DOMAIN, TAG, `提取 ${rawPath} 失败: ${JSON.stringify(err)}`);
            }
        }
        // 提取 frontend/assets/ 下的文件
        for (const file of assetFiles) {
            if (file.endsWith('/'))
                continue;
            const rawPath: string = `frontend/assets/${file}`;
            const localPath: string = `${docRoot}/assets/${file}`;
            try {
                const data: Uint8Array = await resourceMgr.getRawFileContent(rawPath);
                hilog.info(DOMAIN, TAG, `读取 ${rawPath}: ${data.byteLength} 字节`);
                if (data.byteLength > 0) {
                    await this.nativeProcess.saveExecutable(localPath, data);
                    hilog.info(DOMAIN, TAG, `提取: ${rawPath} → ${localPath} (${data.byteLength} 字节)`);
                }
                else {
                    hilog.warn(DOMAIN, TAG, `${rawPath} 内容为空`);
                }
            }
            catch (err) {
                hilog.error(DOMAIN, TAG, `提取 ${rawPath} 失败: ${JSON.stringify(err)}`);
            }
        }
    }
    /**
     * 轮询健康检查端点，等待 Go HTTP 服务器就绪。
     *
     * @returns true 表示服务器就绪，false 表示超时
     */
    private async waitForHealth(): Promise<boolean> {
        const url: string = `http://127.0.0.1:${this.port}/`;
        const maxAttempts: number = HEALTH_CHECK_TIMEOUT_MS / HEALTH_CHECK_INTERVAL_MS;
        for (let i: number = 0; i < maxAttempts; i++) {
            try {
                const ready: boolean = await this.nativeProcess.waitForHealth(url, HEALTH_CHECK_INTERVAL_MS);
                if (ready) {
                    return true;
                }
            }
            catch (err) {
                // 忽略轮询期间的连接错误（服务器尚未启动）
            }
        }
        return false;
    }
    rerender() {
        this.updateDirtyElements();
    }
    public __resetStateVarsOnReuse__Internal(params: Object): void {
    }
    static getEntryName(): string {
        return "Index";
    }
}
registerNamedRoute(() => new Index(undefined, {}), "", { bundleName: "com.aiops.terminal", moduleName: "entry", pagePath: "pages/Index", pageFullPath: "entry/src/main/ets/pages/Index", integratedHsp: "false", moduleType: "followWithHap" });
