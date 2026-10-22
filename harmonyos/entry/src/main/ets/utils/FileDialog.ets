import { picker } from '@kit.CoreFileKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { JSBridge, BridgeException, BridgeErrorCode } from './JSBridge';

const DOMAIN: number = 0x9208;
const TAG: string = 'FileDialog';

/** 文件打开对话框参数（前端传入，JSON 解析用） */
interface FileOpenParams {
  title?: string;
  defaultPath?: string;
  filters?: string[];
  multiple?: boolean;
}

/** 文件保存对话框参数（前端传入，JSON 解析用） */
interface FileSaveParams {
  title?: string;
  defaultPath?: string;
  filters?: string[];
  defaultFileName?: string;
}

/** 目录选择对话框参数（前端传入，JSON 解析用） */
interface DirectoryParams {
  title?: string;
  defaultPath?: string;
}

/**
 * 文件对话框 handler。
 *
 * 基于 HarmonyOS @ohos.file.picker 实现文件选择/保存/目录选择，
 * 通过 JSBridge 暴露方法：
 *   - fileDialog.open      打开文件选择对话框，返回选中文件 URI 数组
 *   - fileDialog.save      打开文件保存对话框，返回保存路径 URI
 *   - fileDialog.directory 打开目录选择对话框，返回选中目录 URI
 *
 * 注意：picker 返回的是 URI（如 filedocs://...），前端如需读取文件内容
 * 需通过其他方式（如 Go 后端）处理 URI。
 */
export class FileDialogHandler {
  /**
   * 注册所有文件对话框方法到 JSBridge。
   *
   * @param bridge JSBridge 实例
   */
  register(bridge: JSBridge): void {
    bridge.registerHandler('fileDialog.open', (params: string): Promise<string> => {
      return this.showOpenDialog(params);
    });
    bridge.registerHandler('fileDialog.save', (params: string): Promise<string> => {
      return this.showSaveDialog(params);
    });
    bridge.registerHandler('fileDialog.directory', (params: string): Promise<string> => {
      return this.showDirectoryDialog(params);
    });
    hilog.info(DOMAIN, TAG, '文件对话框 handler 已注册');
  }

  /**
   * 打开文件选择对话框。
   *
   * @param paramsJson 参数 JSON 字符串，包含 title/defaultPath/filters/multiple
   * @returns 选中文件 URI 数组的 JSON 字符串
   * @throws BridgeException 用户取消或选择失败
   */
  async showOpenDialog(paramsJson: string): Promise<string> {
    const params: FileOpenParams = JSON.parse(paramsJson) as FileOpenParams;
    const filters: string[] = params.filters ?? [];
    const multiple: boolean = params.multiple ?? false;
    hilog.info(DOMAIN, TAG, `showOpenDialog: filters=${JSON.stringify(filters)}, multiple=${multiple}`);

    try {
      const options: picker.DocumentSelectOptions = new picker.DocumentSelectOptions();
      if (filters.length > 0) {
        options.fileSuffixFilters = filters;
      }
      // 多选时放宽上限，单选限定 1 个
      if (multiple) {
        options.maxSelectNumber = 100;
      } else {
        options.maxSelectNumber = 1;
      }

      const documentPicker: picker.DocumentViewPicker = new picker.DocumentViewPicker();
      const uris: string[] = await documentPicker.select(picker.DocumentSelectMode.FILE, options);

      if (uris.length === 0) {
        throw new BridgeException(BridgeErrorCode.USER_CANCEL, '用户取消选择');
      }
      hilog.info(DOMAIN, TAG, `选中文件: ${JSON.stringify(uris)}`);
      return JSON.stringify(uris);
    } catch (err) {
      if (err instanceof BridgeException) {
        throw err;
      }
      const errMsg: string = err instanceof Error ? err.message : JSON.stringify(err);
      hilog.error(DOMAIN, TAG, `文件选择失败: ${errMsg}`);
      // picker 取消通常抛出 13900042 或包含 cancel 的错误，统一作为用户取消
      if (this.isCancelError(errMsg)) {
        throw new BridgeException(BridgeErrorCode.USER_CANCEL, '用户取消选择');
      }
      throw new BridgeException(BridgeErrorCode.FILE_DIALOG_ERROR, `文件选择失败: ${errMsg}`);
    }
  }

  /**
   * 打开文件保存对话框。
   *
   * @param paramsJson 参数 JSON 字符串，包含 title/defaultPath/filters/defaultFileName
   * @returns 保存路径 URI 的 JSON 字符串
   * @throws BridgeException 用户取消或保存失败
   */
  async showSaveDialog(paramsJson: string): Promise<string> {
    const params: FileSaveParams = JSON.parse(paramsJson) as FileSaveParams;
    const filters: string[] = params.filters ?? [];
    const defaultFileName: string = params.defaultFileName ?? '';
    hilog.info(DOMAIN, TAG, `showSaveDialog: filters=${JSON.stringify(filters)}, defaultFileName=${defaultFileName}`);

    try {
      const options: picker.DocumentSaveOptions = new picker.DocumentSaveOptions();
      if (filters.length > 0) {
        options.fileSuffixFilters = filters;
      }
      if (defaultFileName.length > 0) {
        options.newFileNames = [defaultFileName];
      }

      const documentPicker: picker.DocumentViewPicker = new picker.DocumentViewPicker();
      const uris: string[] = await documentPicker.save(picker.DocumentSelectMode.FILE, options);

      if (uris.length === 0) {
        throw new BridgeException(BridgeErrorCode.USER_CANCEL, '用户取消保存');
      }
      hilog.info(DOMAIN, TAG, `保存路径: ${uris[0]}`);
      return JSON.stringify(uris[0]);
    } catch (err) {
      if (err instanceof BridgeException) {
        throw err;
      }
      const errMsg: string = err instanceof Error ? err.message : JSON.stringify(err);
      hilog.error(DOMAIN, TAG, `文件保存失败: ${errMsg}`);
      if (this.isCancelError(errMsg)) {
        throw new BridgeException(BridgeErrorCode.USER_CANCEL, '用户取消保存');
      }
      throw new BridgeException(BridgeErrorCode.FILE_DIALOG_ERROR, `文件保存失败: ${errMsg}`);
    }
  }

  /**
   * 打开目录选择对话框。
   *
   * @param paramsJson 参数 JSON 字符串，包含 title/defaultPath
   * @returns 选中目录 URI 的 JSON 字符串
   * @throws BridgeException 用户取消或选择失败
   */
  async showDirectoryDialog(paramsJson: string): Promise<string> {
    const params: DirectoryParams = JSON.parse(paramsJson) as DirectoryParams;
    hilog.info(DOMAIN, TAG, `showDirectoryDialog: title=${params.title ?? ''}`);

    try {
      const options: picker.DocumentSelectOptions = new picker.DocumentSelectOptions();
      options.maxSelectNumber = 1;

      const documentPicker: picker.DocumentViewPicker = new picker.DocumentViewPicker();
      const uris: string[] = await documentPicker.select(picker.DocumentSelectMode.FOLDER, options);

      if (uris.length === 0) {
        throw new BridgeException(BridgeErrorCode.USER_CANCEL, '用户取消选择目录');
      }
      hilog.info(DOMAIN, TAG, `选中目录: ${uris[0]}`);
      return JSON.stringify(uris[0]);
    } catch (err) {
      if (err instanceof BridgeException) {
        throw err;
      }
      const errMsg: string = err instanceof Error ? err.message : JSON.stringify(err);
      hilog.error(DOMAIN, TAG, `目录选择失败: ${errMsg}`);
      if (this.isCancelError(errMsg)) {
        throw new BridgeException(BridgeErrorCode.USER_CANCEL, '用户取消选择目录');
      }
      throw new BridgeException(BridgeErrorCode.FILE_DIALOG_ERROR, `目录选择失败: ${errMsg}`);
    }
  }

  /**
   * 判断错误信息是否为用户取消操作。
   *
   * picker 取消操作通常抛出错误码 13900042 或包含 cancel/Cancel 的描述。
   *
   * @param errMsg 错误信息
   * @returns true 表示用户取消
   */
  private isCancelError(errMsg: string): boolean {
    return errMsg.includes('cancel') || errMsg.includes('Cancel') || errMsg.includes('13900042');
  }
}