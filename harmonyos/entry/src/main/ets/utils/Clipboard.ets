import { pasteboard } from '@kit.BasicServicesKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { JSBridge, BridgeException, BridgeErrorCode } from './JSBridge';

const DOMAIN: number = 0x9209;
const TAG: string = 'Clipboard';

/** 剪贴板写入参数（多 MIME 类型，前端传入 JSON 解析用） */
interface ClipboardWriteParams {
  text?: string;
  html?: string;
}

/** 剪贴板读取结果（多 MIME 类型） */
interface ClipboardReadResult {
  text: string;
  html: string;
  image: string;
}

/** writeText 参数（前端传入 JSON 解析用） */
interface ClipboardWriteTextParams {
  text: string;
}

/**
 * 剪贴板 handler。
 *
 * 基于 HarmonyOS @ohos.pasteboard 实现剪贴板读写，
 * 通过 JSBridge 暴露方法：
 *   - clipboard.readText  读取剪贴板文本内容
 *   - clipboard.writeText 写入文本到剪贴板
 *   - clipboard.read      读取剪贴板（支持多种 MIME 类型）
 *   - clipboard.write     写入剪贴板（支持多种 MIME 类型）
 *   - clipboard.clear     清空剪贴板
 */
export class ClipboardHandler {
  /** 系统剪贴板单例 */
  private systemPasteboard: pasteboard.SystemPasteboard = pasteboard.getSystemPasteboard();

  /**
   * 注册所有剪贴板方法到 JSBridge。
   *
   * @param bridge JSBridge 实例
   */
  register(bridge: JSBridge): void {
    bridge.registerHandler('clipboard.readText', (): Promise<string> => {
      return this.readText();
    });
    bridge.registerHandler('clipboard.writeText', (params: string): Promise<string> => {
      return this.writeText(params);
    });
    bridge.registerHandler('clipboard.read', (): Promise<string> => {
      return this.read();
    });
    bridge.registerHandler('clipboard.write', (params: string): Promise<string> => {
      return this.write(params);
    });
    bridge.registerHandler('clipboard.clear', (): Promise<string> => {
      return this.clear();
    });
    hilog.info(DOMAIN, TAG, '剪贴板 handler 已注册');
  }

  /**
   * 读取剪贴板文本内容。
   *
   * @returns 文本字符串的 JSON
   * @throws BridgeException 读取失败
   */
  async readText(): Promise<string> {
    try {
      const data: pasteboard.PasteData = await this.systemPasteboard.getData();
      // getPrimaryText() 在剪贴板无文本（空板 / 非文本类型 / 权限未授权）
      // 时返回 undefined，?? '' 让读取优雅降级为空字符串而非抛 TypeError。
      const text: string = data.getPrimaryText() ?? '';
      hilog.info(DOMAIN, TAG, `readText: length=${text.length}`);
      return JSON.stringify(text);
    } catch (err) {
      const errMsg: string = err instanceof Error ? err.message : JSON.stringify(err);
      hilog.error(DOMAIN, TAG, `读取剪贴板失败: ${errMsg}`);
      throw new BridgeException(BridgeErrorCode.CLIPBOARD_ERROR, `读取剪贴板失败: ${errMsg}`);
    }
  }

  /**
   * 写入文本到剪贴板。
   *
   * @param paramsJson 参数 JSON，包含 { text: string }
   * @returns true 的 JSON
   * @throws BridgeException 写入失败
   */
  async writeText(paramsJson: string): Promise<string> {
    const params: ClipboardWriteTextParams = JSON.parse(paramsJson) as ClipboardWriteTextParams;
    const text: string = params.text ?? '';
    hilog.info(DOMAIN, TAG, `writeText: length=${text.length}`);

    try {
      const pasteData: pasteboard.PasteData = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, text);
      await this.systemPasteboard.setData(pasteData);
      return JSON.stringify(true);
    } catch (err) {
      const errMsg: string = err instanceof Error ? err.message : JSON.stringify(err);
      hilog.error(DOMAIN, TAG, `写入剪贴板失败: ${errMsg}`);
      throw new BridgeException(BridgeErrorCode.CLIPBOARD_ERROR, `写入剪贴板失败: ${errMsg}`);
    }
  }

  /**
   * 读取剪贴板（支持多种 MIME 类型）。
   *
   * @returns { text, html, image } 的 JSON
   * @throws BridgeException 读取失败
   */
  async read(): Promise<string> {
    try {
      const data: pasteboard.PasteData = await this.systemPasteboard.getData();
      const result: ClipboardReadResult = { text: '', html: '', image: '' };

      // 尝试读取纯文本（无文本内容时 getPrimaryText 返回 undefined，降级为空字符串）
      try {
        result.text = data.getPrimaryText() ?? '';
      } catch (e) {
        // 无文本内容，保持空字符串
      }

      // 尝试读取 HTML（同理，无 HTML 内容时降级为空字符串）
      try {
        result.html = data.getPrimaryHtml() ?? '';
      } catch (e) {
        // 无 HTML 内容，保持空字符串
      }

      hilog.info(DOMAIN, TAG, `read: textLen=${result.text.length}, htmlLen=${result.html.length}`);
      return JSON.stringify(result);
    } catch (err) {
      const errMsg: string = err instanceof Error ? err.message : JSON.stringify(err);
      hilog.error(DOMAIN, TAG, `读取剪贴板失败: ${errMsg}`);
      throw new BridgeException(BridgeErrorCode.CLIPBOARD_ERROR, `读取剪贴板失败: ${errMsg}`);
    }
  }

  /**
   * 写入剪贴板（支持多种 MIME 类型）。
   *
   * 当同时提供 text 和 html 时，以 html 为主记录、text 为附加纯文本记录。
   *
   * @param paramsJson 参数 JSON，包含 { text?, html? }
   * @returns true 的 JSON
   * @throws BridgeException 内容为空或写入失败
   */
  async write(paramsJson: string): Promise<string> {
    const params: ClipboardWriteParams = JSON.parse(paramsJson) as ClipboardWriteParams;
    const text: string = params.text ?? '';
    const html: string = params.html ?? '';
    hilog.info(DOMAIN, TAG, `write: textLen=${text.length}, htmlLen=${html.length}`);

    if (text.length === 0 && html.length === 0) {
      throw new BridgeException(BridgeErrorCode.INVALID_PARAMS, '写入内容不能为空');
    }

    try {
      let pasteData: pasteboard.PasteData;
      // 优先以 HTML 为主记录（保留富文本格式），否则以纯文本为主
      if (html.length > 0) {
        pasteData = pasteboard.createData(pasteboard.MIMETYPE_TEXT_HTML, html);
      } else {
        pasteData = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, text);
      }

      // 若同时有 text 和 html，追加纯文本记录以便不支持 HTML 的粘贴方使用
      if (text.length > 0 && html.length > 0) {
        try {
          const textRecord: pasteboard.PasteDataRecord = pasteboard.createRecord(pasteboard.MIMETYPE_TEXT_PLAIN, text);
          pasteData.addRecord(textRecord);
        } catch (e) {
          // addRecord 不可用时仅保留主记录
          hilog.warn(DOMAIN, TAG, '追加纯文本记录失败，仅保留主记录');
        }
      }

      await this.systemPasteboard.setData(pasteData);
      return JSON.stringify(true);
    } catch (err) {
      if (err instanceof BridgeException) {
        throw err;
      }
      const errMsg: string = err instanceof Error ? err.message : JSON.stringify(err);
      hilog.error(DOMAIN, TAG, `写入剪贴板失败: ${errMsg}`);
      throw new BridgeException(BridgeErrorCode.CLIPBOARD_ERROR, `写入剪贴板失败: ${errMsg}`);
    }
  }

  /**
   * 清空剪贴板。
   *
   * @returns true 的 JSON
   * @throws BridgeException 清空失败
   */
  async clear(): Promise<string> {
    try {
      await this.systemPasteboard.clear();
      hilog.info(DOMAIN, TAG, '剪贴板已清空');
      return JSON.stringify(true);
    } catch (err) {
      const errMsg: string = err instanceof Error ? err.message : JSON.stringify(err);
      hilog.error(DOMAIN, TAG, `清空剪贴板失败: ${errMsg}`);
      throw new BridgeException(BridgeErrorCode.CLIPBOARD_ERROR, `清空剪贴板失败: ${errMsg}`);
    }
  }
}