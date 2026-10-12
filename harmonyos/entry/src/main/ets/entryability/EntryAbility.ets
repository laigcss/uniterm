import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { window } from '@kit.ArkUI';

const DOMAIN: number = 0x9205;
const TAG: string = 'EntryAbility';

/**
 * 应用入口 Ability。
 *
 * ai-ops-terminal 鸿蒙应用壳的入口，负责创建应用窗口并加载主页面。
 * Go 后端子进程的启动/停止由 Index 页面管理，本 Ability 仅负责
 * 窗口生命周期和全局上下文。
 */
export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    hilog.info(DOMAIN, TAG, 'onCreate: ai-ops-terminal 鸿蒙应用壳启动');
    // 应用全局状态初始化可在此处进行
  }

  onDestroy(): void {
    hilog.info(DOMAIN, TAG, 'onDestroy: 应用退出');
    // Go 子进程的终止由 Index 页面的 aboutToDisappear 处理
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    hilog.info(DOMAIN, TAG, 'onWindowStageCreate: 加载主页面');
    windowStage.loadContent('pages/Index', (err) => {
      if (err.code) {
        hilog.error(DOMAIN, TAG, `加载页面失败: ${err.code} - ${err.message}`);
        return;
      }
      hilog.info(DOMAIN, TAG, '主页面加载成功');
    });
  }

  onWindowStageDestroy(): void {
    hilog.info(DOMAIN, TAG, 'onWindowStageDestroy: 窗口销毁');
  }

  onForeground(): void {
    hilog.info(DOMAIN, TAG, 'onForeground: 应用进入前台');
  }

  onBackground(): void {
    hilog.info(DOMAIN, TAG, 'onBackground: 应用进入后台');
  }

  onNewWant(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    hilog.info(DOMAIN, TAG, 'onNewWant');
  }
}