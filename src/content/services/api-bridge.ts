// API 数据桥接层：监听 inject.ts 通过 window.postMessage 发送的 API 响应数据
// 提供缓存管理和异步等待机制，供 monitor.ts 和 waiter.ts 获取最新 API 数据

import { CONFIG } from '../../config';
import type { ApiResponseData, CachedApiResponse } from '../../types';

// 等待者：当调用 waitForFreshResponse 时注册，收到新响应后自动 resolve
type ResponseWaiter = {
  resolve: (data: ApiResponseData) => void;
  afterTimestamp: number; // 只接受此时间戳之后到达的响应
  timer: number; // 超时定时器 ID，用于超时后清理
};

export class ApiBridge {
  private latest: CachedApiResponse | null = null; // 最近一次拦截到的 API 响应
  private waiters: ResponseWaiter[] = []; // 当前等待 API 响应的回调队列

  // 开始监听 window message，必须在 content script 初始化时调用
  start() {
    window.addEventListener('message', (event) => {
      // 安全校验：只处理来自当前窗口且类型匹配的消息，防止跨 iframe 干扰
      if (event.source !== window) return;
      if (event.data?.type !== 'DEVOPS_WATCHER_API_RESPONSE') return;
      this.handleResponse(event.data.data, event.data.url);
    });
  }

  // 处理收到的 API 响应：更新缓存并唤醒所有满足时间条件的等待者
  private handleResponse(data: ApiResponseData, url: string) {
    const cached: CachedApiResponse = {
      data,
      timestamp: Date.now(),
      url,
    };
    this.latest = cached;

    // 遍历等待队列，resolve 所有 afterTimestamp 早于当前响应时间戳的等待者
    const resolved: ResponseWaiter[] = [];
    for (const w of this.waiters) {
      if (cached.timestamp > w.afterTimestamp) {
        clearTimeout(w.timer);
        w.resolve(cached.data);
        resolved.push(w);
      }
    }
    this.waiters = this.waiters.filter((w) => !resolved.includes(w));
  }

  // 获取最近一次缓存的 API 响应（可能为 null）
  getLatest(): CachedApiResponse | null {
    return this.latest;
  }

  // 判断缓存的 API 数据是否在 maxAgeMs 毫秒内（默认使用 apiFreshnessThreshold 2秒）
  isFresh(maxAgeMs: number = CONFIG.apiFreshnessThreshold): boolean {
    return this.latest !== null && Date.now() - this.latest.timestamp < maxAgeMs;
  }

  // 返回最后一次收到 API 响应的时间戳，用于 recovery.ts 判断 API 超时
  getLastResponseTimestamp(): number {
    return this.latest?.timestamp ?? 0;
  }

  // 使缓存的新鲜度失效：将时间戳设为 0，使 isFresh() 返回 false
  // 切换需求池前调用，防止 waiter 误将上一个池的旧数据视为"就绪"而跳过等待
  invalidateFreshness(): void {
    if (this.latest) {
      this.latest = { ...this.latest, timestamp: 0 };
    }
  }

  // 等待一个在 afterTimestamp 之后到达的新鲜 API 响应，超时则 reject
  // 典型用法：点击菜单后调用此方法等待页面发起的 API 请求返回数据
  waitForFreshResponse(afterTimestamp: number, timeoutMs = 10000): Promise<ApiResponseData> {
    // 快速路径：如果当前缓存已满足时间要求则直接返回
    if (this.latest && this.latest.timestamp > afterTimestamp) {
      return Promise.resolve(this.latest.data);
    }

    return new Promise<ApiResponseData>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        // 超时后从队列移除并 reject，调用方可捕获此错误进行重试
        this.waiters = this.waiters.filter((w) => w !== waiter);
        reject(new Error('API response timeout'));
      }, timeoutMs);

      const waiter: ResponseWaiter = { resolve, afterTimestamp, timer };
      this.waiters.push(waiter);
    });
  }
}
