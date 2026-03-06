// 自动恢复模块：监测内存超限和 API 超时两种异常场景，触发通知并安全刷新页面
// 安全刷新：确保刷新后的 URL 包含查询参数（?），使插件能正常激活

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

export function startRecovery(apiBridge: ApiBridge): void {
  if (!CONFIG.loadTimeoutEnabled) return;

  let firstResponseReceived = false;

  recoveryInterval = window.setInterval(() => {
    if (refreshScheduled) return;

    // 扩展上下文失效检测（扩展被重新加载/更新后触发）
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
      log('Recovery', 'FAIL', 'API 超时，即将刷新页面', `elapsed=${Math.round(elapsed / 1000)}s threshold=${Math.round(CONFIG.loadTimeoutThreshold / 1000)}s`);
      store.setState({
        status: '页面加载超时，即将刷新...',
        statusType: 'error',
      });
      sendRefreshNotification('API 超时', `API 请求已超过 ${Math.round(elapsed / 1000)} 秒无响应`);
      setTimeout(() => safeRefresh(), 2000);
    }
  }, CONFIG.loadTimeoutCheckInterval);
}

// 停止恢复监控（monitor.stop() 时调用）
export function stopRecovery(): void {
  if (recoveryInterval !== null) {
    clearInterval(recoveryInterval);
    recoveryInterval = null;
  }
}

// 内存超限检测：JS 堆大小超过 memoryLimitMB（1024MB）时触发刷新
function checkMemory(): void {
  const perf = performance as any;
  if (!perf.memory) return;

  const usedMB = perf.memory.usedJSHeapSize / 1048576;
  if (usedMB > CONFIG.memoryLimitMB) {
    refreshScheduled = true;
    log('Recovery', 'FAIL', '内存超限，即将刷新页面', `usedMB=${Math.round(usedMB)} limitMB=${CONFIG.memoryLimitMB}`);
    store.setState({
      status: `内存超限 (${Math.round(usedMB)}MB)，即将刷新...`,
      statusType: 'error',
    });
    sendRefreshNotification('内存超限', `JS 堆内存已达 ${Math.round(usedMB)}MB，超过 ${CONFIG.memoryLimitMB}MB 阈值`);
    setTimeout(() => safeRefresh(), 2000);
  }
}

// 安全刷新：确保刷新后的 URL 包含 ? 使插件能激活
// 使用 location.href 赋值而非 location.reload()，后者在 SPA + content script 中可能不可靠
function safeRefresh(): void {
  const href = location.href;
  // 检查是否有真正的查询参数（? 在 # 之前才算）
  const hashIdx = href.indexOf('#');
  const hasRealQuery = hashIdx === -1
    ? href.includes('?')
    : href.substring(0, hashIdx).includes('?');

  if (hasRealQuery) {
    // 已有查询参数，追加/替换时间戳参数强制刷新
    const sep = href.includes('?') ? '&' : '?';
    window.location.href = href.replace(/[&?]_dw=\d+/, '') + sep + '_dw=' + Date.now();
  } else {
    // 无查询参数，在 hash 之前插入 ?_dw=timestamp
    if (hashIdx !== -1) {
      window.location.href = href.substring(0, hashIdx) + '?_dw=' + Date.now() + href.substring(hashIdx);
    } else {
      window.location.href = href + '?_dw=' + Date.now();
    }
  }
}

// 通过 background 发送刷新预警通知，让用户知道页面即将自动刷新
function sendRefreshNotification(title: string, message: string): void {
  try {
    chrome.runtime.sendMessage({
      type: 'CREATE_NOTIFICATION',
      title: `⚠️ DevOps Watcher: ${title}`,
      message,
      duration: CONFIG.notificationDuration,
    });
  } catch {} // 通知发送失败不阻塞刷新流程
}
