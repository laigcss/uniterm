import { AbilityConstant, UIAbility, Want, ConfigurationConstant } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { window } from '@kit.ArkUI';

const DOMAIN: number = 0x9205;
const TAG: string = 'EntryAbility';

/**
 * 应用入口 Ability。
 *
 * ai-ops-terminal 鸿蒙应用壳的入口，负责创建应用窗口并加载主页面。
 * Go 后端子进程的启动/停止由 Index 页面管理，本 Ability 负责：
 *   - 窗口生命周期与沉浸式状态栏配置
 *   - 内存告警通知（通知 Go 子进程做 GC）
 *   - 系统配置更新（语言、颜色模式等）
 *   - 全局上下文管理
 */
export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    hilog.info(DOMAIN, TAG, 'onCreate: ai-ops-terminal 鸿蒙应用壳启动');
    // 应用全局状态初始化
  }

  onDestroy(): void {
    hilog.info(DOMAIN, TAG, 'onDestroy: 应用退出');
    // Go 子进程的终止由 Index 页面的 aboutToDisappear 处理
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    hilog.info(DOMAIN, TAG, 'onWindowStageCreate: 加载主页面');
    // 设置沉浸式状态栏与窗口属性
    this.setWindowLayout(windowStage);
    windowStage.loadContent('pages/Index', (err) => {
      if (err.code) {
        hilog.error(DOMAIN, TAG, `加载页面失败: ${err.code} - ${err.message}`);
        return;
      }
      hilog.info(DOMAIN, TAG, '主页面加载成功');
    });
  }

  /**
   * 设置窗口属性：沉浸式状态栏、全屏布局。
   *
   * 将内容延伸到状态栏下方，状态栏背景设为透明，
   * 提供更沉浸的前端 UI 体验。
   *
   * @param windowStage 窗口舞台
   */
  private setWindowLayout(windowStage: window.WindowStage): void {
    try {
      const mainWindow: window.Window = windowStage.getMainWindowSync();
      // 设置全屏布局（内容延伸到状态栏和导航栏下方）
      mainWindow.setWindowLayoutFullScreen(true);
      // 设置状态栏透明、导航栏透明
      mainWindow.setWindowSystemBarProperties({
        statusBarColor: '#00000000',
        navigationBarColor: '#00000000',
        isStatusBarLightIcon: false
      });
      hilog.info(DOMAIN, TAG, '窗口属性设置完成：沉浸式状态栏');
    } catch (err) {
      hilog.error(DOMAIN, TAG, `设置窗口属性失败: ${JSON.stringify(err)}`);
    }
  }

  onWindowStageDestroy(): void {
    hilog.info(DOMAIN, TAG, 'onWindowStageDestroy: 窗口销毁');
  }

  onForeground(): void {
    hilog.info(DOMAIN, TAG, 'onForeground: 应用进入前台');
    // 应用回到前台，Go 子进程由 Index 页面的监控定时器保障运行
  }

  onBackground(): void {
    hilog.info(DOMAIN, TAG, 'onBackground: 应用进入后台');
    // 应用进入后台，依赖 backgroundModes 保持 Go 子进程持续运行
  }

  onNewWant(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    hilog.info(DOMAIN, TAG, 'onNewWant');
  }

  /**
   * 内存告警回调。
   *
   * 系统内存紧张时触发。通过 AppStorage 传递内存压力等级，
   * Index 页面监听后可通知 Go 子进程执行 GC 释放内存。
   *
   * @param level 内存压力等级：
   *   MEMORY_LEVEL_MODERATE = 0  中等压力
   *   MEMORY_LEVEL_LOW = 1       低压力
   *   MEMORY_LEVEL_CRITICAL = 2  严重压力
   */
  onMemoryLevel(level: AbilityConstant.MemoryLevel): void {
    hilog.warn(DOMAIN, TAG, `onMemoryLevel: ${level}`);
    // 通过 AppStorage 传递内存告警信号给 Index 页面
    AppStorage.setOrCreate<number>('memoryLevel', level);
  }

  /**
   * 配置更新回调。
   *
   * 系统配置（语言、颜色模式、屏幕方向等）变化时触发，
   * 通过 AppStorage 通知页面做相应适配。
   *
   * @param newConfig 新的系统配置
   */
  onConfigurationUpdate(newConfig: ConfigurationConstant.Configuration): void {
    hilog.info(
      DOMAIN, TAG,
      `onConfigurationUpdate: language=${newConfig.language}, colorMode=${newConfig.colorMode}, direction=${newConfig.direction}`
    );
    // 将配置变化通过 AppStorage 通知页面
    AppStorage.setOrCreate<string>('configLanguage', newConfig.language);
    AppStorage.setOrCreate<number>('configColorMode', newConfig.colorMode);
    AppStorage.setOrCreate<number>('configDirection', newConfig.direction);
  }
}