// 自动恢复模块：监测内存超限和 API 超时两种异常场景，触发通知并安全刷新页面
// 内存超限和 API 超时：标记待刷新，等待当前轮次完成后由 monitor.onRoundComplete() 执行刷新
// 扩展上下文失效：立即刷新（扩展已不可用，轮次无法正常完成）

import { CONFIG } from '../../config';
import { store } from '../../store';
import { log } from '../services/logger';
import type { ApiBridge } from '../services/api-bridge';

let recoveryInterval: number | null = null;
let refreshScheduled = false;

export function isContextValid(): boolean {
  try {
    return !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

export function isRefreshPending(): boolean {
  return refreshScheduled;
}

export function startRecovery(apiBridge: ApiBridge): void {
  if (!CONFIG.loadTimeoutEnabled) return;

  let firstResponseReceived = false;

  recoveryInterval = window.setInterval(() => {
    if (refreshScheduled) return;

    // 扩展上下文失效：立即刷新（轮次操作已无法正常执行）
    if (!isContextValid()) {
      refreshScheduled = true;
      log('Recovery', 'WARN', '扩展上下文已失效，即将刷新页面');
      store.setState({
        status: '扩展已更新，即将刷新...',
        statusType: 'warning',
      });
      setTimeout(() => safeRefresh(), 1000);
      return;
    }

    checkMemory();

    const lastResponse = apiBridge.getLastResponseTimestamp();
    if (lastResponse > 0) firstResponseReceived = true;
    if (!firstResponseReceived) return;

    const elapsed = Date.now() - lastResponse;
    if (elapsed > CONFIG.loadTimeoutThreshold) {
      refreshScheduled = true;
      log('Recovery', 'FAIL', 'API 超时，等待当前轮次完成后刷新', `elapsed=${Math.round(elapsed / 1000)}s threshold=${Math.round(CONFIG.loadTimeoutThreshold / 1000)}s`);
      store.setState({
        status: '页面加载超时，等待轮次结束后刷新...',
        statusType: 'error',
      });
      sendRefreshNotification('API 超时', `API 请求已超过 ${Math.round(elapsed / 1000)} 秒无响应，将在当前轮次结束后刷新`);
    }
  }, CONFIG.loadTimeoutCheckInterval);
}

export function stopRecovery(): void {
  if (recoveryInterval !== null) {
    clearInterval(recoveryInterval);
    recoveryInterval = null;
  }
}

function checkMemory(): void {
  const perf = performance as any;
  if (!perf.memory) return;

  const usedMB = perf.memory.usedJSHeapSize / 1048576;
  if (usedMB > CONFIG.memoryLimitMB) {
    refreshScheduled = true;
    log('Recovery', 'FAIL', '内存超限，等待当前轮次完成后刷新', `usedMB=${Math.round(usedMB)} limitMB=${CONFIG.memoryLimitMB}`);
    store.setState({
      status: `内存超限 (${Math.round(usedMB)}MB)，等待轮次结束后刷新...`,
      statusType: 'error',
    });
    sendRefreshNotification('内存超限', `JS 堆内存已达 ${Math.round(usedMB)}MB，将在当前轮次结束后刷新`);
  }
}

export function safeRefresh(): void {
  const href = location.href;
  const hashIdx = href.indexOf('#');
  const hasRealQuery = hashIdx === -1
    ? href.includes('?')
    : href.substring(0, hashIdx).includes('?');

  if (hasRealQuery) {
    const sep = href.includes('?') ? '&' : '?';
    window.location.href = href.replace(/[&?]_dw=\d+/, '') + sep + '_dw=' + Date.now();
  } else {
    if (hashIdx !== -1) {
      window.location.href = href.substring(0, hashIdx) + '?_dw=' + Date.now() + href.substring(hashIdx);
    } else {
      window.location.href = href + '?_dw=' + Date.now();
    }
  }
}

function sendRefreshNotification(title: string, message: string): void {
  try {
    chrome.runtime.sendMessage({
      type: 'CREATE_NOTIFICATION',
      title: `⚠️ DevOps Watcher: ${title}`,
      message,
      duration: CONFIG.notificationDuration,
    });
  } catch {}
}
