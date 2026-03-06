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
  private latest: CachedApiResponse | null = null;
  private waiters: ResponseWaiter[] = [];
  // 真实的最后响应时间戳，不受 invalidateFreshness() 影响，供 recovery.ts 使用
  private lastRealResponseTime = 0;

  start() {
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      if (event.data?.type !== 'DEVOPS_WATCHER_API_RESPONSE') return;
      this.handleResponse(event.data.data, event.data.url);
    });
  }

  private handleResponse(data: ApiResponseData, url: string) {
    const cached: CachedApiResponse = {
      data,
      timestamp: Date.now(),
      url,
    };
    this.latest = cached;
    this.lastRealResponseTime = cached.timestamp;

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

  getLatest(): CachedApiResponse | null {
    return this.latest;
  }

  isFresh(maxAgeMs: number = CONFIG.apiFreshnessThreshold): boolean {
    return this.latest !== null && Date.now() - this.latest.timestamp < maxAgeMs;
  }

  // 返回最后一次真实收到 API 响应的时间戳，不受 invalidateFreshness() 影响
  getLastResponseTimestamp(): number {
    return this.lastRealResponseTime;
  }

  // 仅使新鲜度判断失效（isFresh 返回 false），不影响 getLastResponseTimestamp
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
