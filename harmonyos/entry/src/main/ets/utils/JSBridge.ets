import { hilog } from '@kit.PerformanceAnalysisKit';

const DOMAIN: number = 0x9207;
const TAG: string = 'JSBridge';

/**
 * JSBridge 错误码定义。
 *
 * 错误码分段：
 *   1xxx — 通用错误（用户取消、参数无效、方法未找到、权限不足）
 *   2xxx — 模块错误（文件对话框/剪贴板/通知）
 *   9xxx — 未知错误
 */
export class BridgeErrorCode {
  /** 成功 */
  static readonly SUCCESS: number = 0;
  /** 用户取消操作 */
  static readonly USER_CANCEL: number = 1001;
  /** 参数无效 */
  static readonly INVALID_PARAMS: number = 1002;
  /** 方法未找到 */
  static readonly METHOD_NOT_FOUND: number = 1003;
  /** 权限不足 */
  static readonly PERMISSION_DENIED: number = 1004;
  /** 文件对话框错误 */
  static readonly FILE_DIALOG_ERROR: number = 2001;
  /** 剪贴板错误 */
  static readonly CLIPBOARD_ERROR: number = 2002;
  /** 通知错误 */
  static readonly NOTIFICATION_ERROR: number = 2003;
  /** 未知错误 */
  static readonly UNKNOWN: number = 9000;
}

/**
 * JSBridge 业务异常。
 *
 * handler 抛出此异常时，JSBridge.invoke 会将其转换为
 * { "success": false, "error": { "code": ..., "message": ... } } 格式返回前端。
 */
export class BridgeException extends Error {
  /** 错误码 */
  code: number;

  constructor(code: number, message: string) {
    super(message);
    this.code = code;
    this.message = message;
  }
}

/**
 * Bridge handler 函数类型。
 *
 * handler 接收 params 的 JSON 字符串，返回 data 的 JSON 字符串。
 * 业务失败时抛出 BridgeException，由 JSBridge.invoke 统一捕获并包装。
 */
type BridgeHandler = (params: string) => Promise<string>;

/**
 * JSBridge 核心通信类。
 *
 * 统一 JSBridge 协议：前端调用 window.harmonyBridge.invoke(method, paramsJson)
 * → ArkTS 路由分发到对应 handler → 返回结果 JSON。
 *
 * 返回结果格式：
 *   成功: { "success": true, "data": <dataJson> }
 *   失败: { "success": false, "error": { "code": <number>, "message": <string> } }
 *
 * 方法命名规范：模块.操作，如 fileDialog.open、clipboard.readText、notification.show
 *
 * 用法：
 *   const bridge: JSBridge = new JSBridge();
 *   bridge.registerHandler('fileDialog.open', (params: string): Promise<string> => { ... });
 *   // 将 bridge 注入 ArkWeb：
 *   // controller.registerJavaScriptProxy({
 *   //   object: bridge, name: 'harmonyBridge',
 *   //   methodList: [], asyncMethodList: ['invoke']
 *   // });
 */
export class JSBridge {
  /** 方法路由表：method 名称 → handler 函数 */
  private handlers: Map<string, BridgeHandler> = new Map<string, BridgeHandler>();

  /**
   * 构造成功结果。
   *
   * 将 handler 返回的 data JSON 字符串包装为完整的 BridgeResult JSON。
   *
   * @param dataJson data 的 JSON 字符串（如 '["/path1","/path2"]'）
   * @returns 完整的 BridgeResult JSON 字符串
   */
  static ok(dataJson: string): string {
    return '{"success":true,"data":' + dataJson + '}';
  }

  /**
   * 构造失败结果。
   *
   * @param code 错误码
   * @param message 错误描述
   * @returns 完整的 BridgeResult JSON 字符串
   */
  static fail(code: number, message: string): string {
    return '{"success":false,"error":{"code":' + code + ',"message":' + JSON.stringify(message) + '}}';
  }

  /**
   * 注册方法处理函数。
   *
   * @param method 方法名（如 'fileDialog.open'）
   * @param handler 处理函数，接收 params JSON 字符串，返回 data JSON 字符串
   */
  registerHandler(method: string, handler: BridgeHandler): void {
    this.handlers.set(method, handler);
    hilog.info(DOMAIN, TAG, `已注册 handler: ${method}`);
  }

  /**
   * 注销方法处理函数。
   *
   * @param method 方法名
   */
  unregisterHandler(method: string): void {
    this.handlers.delete(method);
    hilog.info(DOMAIN, TAG, `已注销 handler: ${method}`);
  }

  /**
   * 检查方法是否已注册。
   *
   * @param method 方法名
   * @returns true 表示已注册
   */
  hasHandler(method: string): boolean {
    return this.handlers.has(method);
  }

  /**
   * 前端调用入口（异步方法，需注册到 ArkWeb asyncMethodList）。
   *
   * 流程：
   *   1. 记录调用日志
   *   2. 从路由表查找 handler
   *   3. 调用 handler 处理，成功包装为 { success: true, data }
   *   4. 捕获 BridgeException 包装为 { success: false, error }
   *   5. 捕获其他异常包装为未知错误
   *
   * @param method 方法名（如 'fileDialog.open'）
   * @param params 参数 JSON 字符串（前端 JSON.stringify 后传入）
   * @returns BridgeResult JSON 字符串
   */
  async invoke(method: string, params: string): Promise<string> {
    hilog.info(DOMAIN, TAG, `invoke: method=${method}, params=${params}`);

    const handler: BridgeHandler | undefined = this.handlers.get(method);
    if (handler === undefined) {
      hilog.error(DOMAIN, TAG, `方法未找到: ${method}`);
      return JSBridge.fail(BridgeErrorCode.METHOD_NOT_FOUND, `方法未找到: ${method}`);
    }

    try {
      const dataJson: string = await handler(params);
      hilog.info(DOMAIN, TAG, `invoke 成功: method=${method}`);
      return JSBridge.ok(dataJson);
    } catch (err) {
      if (err instanceof BridgeException) {
        hilog.error(DOMAIN, TAG, `invoke 业务错误: method=${method}, code=${err.code}, msg=${err.message}`);
        return JSBridge.fail(err.code, err.message);
      }
      const errMsg: string = err instanceof Error ? err.message : JSON.stringify(err);
      hilog.error(DOMAIN, TAG, `invoke 异常: method=${method}, msg=${errMsg}`);
      return JSBridge.fail(BridgeErrorCode.UNKNOWN, errMsg);
    }
  }

  /**
   * 获取所有已注册的方法名。
   *
   * @returns 方法名数组
   */
  getRegisteredMethods(): string[] {
    const methods: string[] = [];
    this.handlers.forEach((handler: BridgeHandler, method: string) => {
      methods.push(method);
    });
    return methods;
  }
}