import { notificationManager } from '@kit.NotificationKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { JSBridge, BridgeException, BridgeErrorCode } from './JSBridge';

const DOMAIN: number = 0x920A;
const TAG: string = 'Notification';

/** 通知显示参数（前端传入，JSON 解析用） */
interface NotificationShowParams {
  id?: number;
  title: string;
  body: string;
  icon?: string;
}

/** 取消通知参数（前端传入，JSON 解析用） */
interface NotificationCancelParams {
  id: number;
}

/**
 * 通知 handler。
 *
 * 基于 HarmonyOS @ohos.notificationManager 实现系统通知，
 * 通过 JSBridge 暴露方法：
 *   - notification.show              显示系统通知
 *   - notification.requestPermission 请求通知权限
 *   - notification.cancel            取消指定通知
 *
 * 使用前需在 module.json5 的 requestPermissions 中声明
 * ohos.permission.NOTIFICATION 权限。
 */
export class NotificationHandler {
  /** 通知 ID 自增计数器（前端未指定 id 时使用） */
  private nextId: number = 1;

  /**
   * 注册所有通知方法到 JSBridge。
   *
   * @param bridge JSBridge 实例
   */
  register(bridge: JSBridge): void {
    bridge.registerHandler('notification.show', (params: string): Promise<string> => {
      return this.showNotification(params);
    });
    bridge.registerHandler('notification.requestPermission', (): Promise<string> => {
      return this.requestPermission();
    });
    bridge.registerHandler('notification.cancel', (params: string): Promise<string> => {
      return this.cancelNotification(params);
    });
    hilog.info(DOMAIN, TAG, '通知 handler 已注册');
  }

  /**
   * 显示系统通知。
   *
   * @param paramsJson 参数 JSON，包含 { id?, title, body, icon? }
   * @returns 通知 ID 的 JSON
   * @throws BridgeException 参数无效、权限不足或发布失败
   */
  async showNotification(paramsJson: string): Promise<string> {
    const params: NotificationShowParams = JSON.parse(paramsJson) as NotificationShowParams;
    const title: string = params.title ?? '';
    const body: string = params.body ?? '';
    const notifyId: number = params.id ?? this.nextId++;
    hilog.info(DOMAIN, TAG, `showNotification: id=${notifyId}, title=${title}`);

    if (title.length === 0) {
      throw new BridgeException(BridgeErrorCode.INVALID_PARAMS, '通知标题不能为空');
    }

    try {
      // 构造基本文本通知请求
      const request = {
        id: notifyId,
        content: {
          contentType: notificationManager.ContentType.NOTIFICATION_CONTENT_BASIC_TEXT,
          normal: {
            title: title,
            text: body,
            additionalText: ''
          }
        }
      } as notificationManager.NotificationRequest;

      await notificationManager.publish(request);
      hilog.info(DOMAIN, TAG, `通知已发布: id=${notifyId}`);
      return JSON.stringify(notifyId);
    } catch (err) {
      const errMsg: string = err instanceof Error ? err.message : JSON.stringify(err);
      hilog.error(DOMAIN, TAG, `发布通知失败: ${errMsg}`);
      // 通知权限不足通常返回 1600004 或包含 permission 的错误
      if (this.isPermissionError(errMsg)) {
        throw new BridgeException(BridgeErrorCode.PERMISSION_DENIED, `通知权限不足: ${errMsg}`);
      }
      throw new BridgeException(BridgeErrorCode.NOTIFICATION_ERROR, `发布通知失败: ${errMsg}`);
    }
  }

  /**
   * 请求通知权限。
   *
   * 调用系统弹窗引导用户授予通知权限。用户拒绝时不抛异常，返回 false。
   *
   * @returns true/false 的 JSON
   */
  async requestPermission(): Promise<string> {
    try {
      await notificationManager.requestEnableNotification();
      hilog.info(DOMAIN, TAG, '通知权限已授予');
      return JSON.stringify(true);
    } catch (err) {
      const errMsg: string = err instanceof Error ? err.message : JSON.stringify(err);
      hilog.warn(DOMAIN, TAG, `通知权限请求失败（用户可能拒绝）: ${errMsg}`);
      return JSON.stringify(false);
    }
  }

  /**
   * 取消指定通知。
   *
   * @param paramsJson 参数 JSON，包含 { id: number }
   * @returns true 的 JSON
   * @throws BridgeException 取消失败
   */
  async cancelNotification(paramsJson: string): Promise<string> {
    const params: NotificationCancelParams = JSON.parse(paramsJson) as NotificationCancelParams;
    const notifyId: number = params.id;
    hilog.info(DOMAIN, TAG, `cancelNotification: id=${notifyId}`);

    try {
      notificationManager.cancel(notifyId);
      hilog.info(DOMAIN, TAG, `通知已取消: id=${notifyId}`);
      return JSON.stringify(true);
    } catch (err) {
      const errMsg: string = err instanceof Error ? err.message : JSON.stringify(err);
      hilog.error(DOMAIN, TAG, `取消通知失败: ${errMsg}`);
      throw new BridgeException(BridgeErrorCode.NOTIFICATION_ERROR, `取消通知失败: ${errMsg}`);
    }
  }

  /**
   * 判断错误信息是否为权限不足。
   *
   * 通知权限错误通常返回错误码 1600004 或包含 permission 的描述。
   *
   * @param errMsg 错误信息
   * @returns true 表示权限不足
   */
  private isPermissionError(errMsg: string): boolean {
    return errMsg.includes('permission') || errMsg.includes('Permission') || errMsg.includes('1600004');
  }
}