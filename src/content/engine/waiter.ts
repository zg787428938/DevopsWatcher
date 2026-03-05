// 内容就绪等待器：点击菜单项后判断页面数据是否加载完成
// 采用三段式策略逐步升级等待方式，兼顾响应速度和可靠性
// 第一段：API 新鲜度快判（<2秒）→ 第二段：DOM 快速轮询（50ms×10） → 第三段：MutationObserver（最长10秒）

import { CONFIG } from '../../config';
import type { ApiBridge } from '../services/api-bridge';

export class Waiter {
  private apiBridge: ApiBridge;

  constructor(apiBridge: ApiBridge) {
    this.apiBridge = apiBridge;
  }

  // 主入口：依次尝试三段等待策略，任一阶段判定就绪即立即返回
  async waitForContentReady(): Promise<void> {
    // 第一段：若 API 数据在 apiFreshnessThreshold（2秒）内到达，直接判定就绪
    if (this.apiBridge.isFresh(CONFIG.apiFreshnessThreshold)) {
      return;
    }

    // 第二段：以 50ms 间隔最多轮询 10 次（共约 500ms），检查 DOM 加载状态和 API 新鲜度
    const ready = await this.fastPoll();
    if (ready) return;

    // 第三段：启动 MutationObserver 持续监听 DOM 变化，最长等待 10 秒
    await this.observeDOM();
  }

  // 快速 DOM 轮询：高频检测 loading 指示器是否消失 + API 数据是否到达
  private async fastPoll(): Promise<boolean> {
    for (let i = 0; i < CONFIG.fastPollMaxAttempts; i++) {
      if (this.isContentReady()) return true;
      await sleep(CONFIG.fastPollInterval);
    }
    return false;
  }

  // 就绪判定：API 新鲜度为主信号（数据到达即就绪），loading 指示器为辅助信号
  private isContentReady(): boolean {
    // 主信号：API 数据已到达，即使 loading 动画尚未消失也视为就绪
    if (this.apiBridge.isFresh(CONFIG.apiFreshnessThreshold)) {
      return true;
    }

    // 辅助信号：loading 指示器仍可见时继续等待
    const loading = document.querySelector(CONFIG.selectors.loadingIndicator);
    if (loading) {
      const style = window.getComputedStyle(loading);
      if (style.display !== 'none' && style.visibility !== 'hidden') {
        return false;
      }
    }

    return false;
  }

  // MutationObserver 兜底：监听 DOM 变化并定期复查，超时 10 秒后强制放行
  private observeDOM(): Promise<void> {
    return new Promise((resolve) => {
      const maxWait = 10_000;
      const startTime = Date.now();
      let resolved = false; // 防止 MutationObserver 和 interval 双重 resolve

      // 统一清理函数：断开 observer、清除 interval、resolve Promise
      const cleanup = () => {
        if (resolved) return;
        resolved = true;
        observer.disconnect();
        clearInterval(checkInterval);
        resolve();
      };

      const observer = new MutationObserver(() => {
        if (this.isContentReady()) {
          cleanup();
        }
      });

      // 监听整个 body 的子节点变化和 class/style 属性变化
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style'],
      });

      // 每 500ms 主动复查，避免与 apiFreshnessThreshold(2000ms) 对齐导致竞态
      const checkInterval = setInterval(() => {
        if (Date.now() - startTime > maxWait) {
          cleanup();
          return;
        }
        if (this.isContentReady()) {
          cleanup();
        }
      }, 500);
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
