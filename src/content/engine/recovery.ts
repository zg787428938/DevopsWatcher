// 自动恢复模块：监测内存超限和 API 超时两种异常场景，触发通知并安全刷新页面
// 安全刷新：确保刷新后的 URL 包含查询参数（?），使插件能正常激活

import { CONFIG } from '../../config';
import { store } from '../../store';
import type { ApiBridge } from '../services/api-bridge';

let recoveryInterval: number | null = null;
let refreshScheduled = false; // 防止内存超限和 API 超时同时触发多次刷新

// 启动恢复监控：按 loadTimeoutCheckInterval（10秒）周期检测内存和 API 状态
export function startRecovery(apiBridge: ApiBridge): void {
  if (!CONFIG.loadTimeoutEnabled) return;

  // 等首次收到 API 响应后才开始超时检测，避免启动阶段误判
  let firstResponseReceived = false;

  recoveryInterval = window.setInterval(() => {
    if (refreshScheduled) return; // 已安排刷新，跳过后续检测

    checkMemory();

    const lastResponse = apiBridge.getLastResponseTimestamp();
    if (lastResponse > 0) firstResponseReceived = true;
    if (!firstResponseReceived) return;

    // API 超时判定：最后一次 API 响应距今超过 loadTimeoutThreshold（60秒）
    const elapsed = Date.now() - lastResponse;
    if (elapsed > CONFIG.loadTimeoutThreshold) {
      refreshScheduled = true;
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
    store.setState({
      status: `内存超限 (${Math.round(usedMB)}MB)，即将刷新...`,
      statusType: 'error',
    });
    sendRefreshNotification('内存超限', `JS 堆内存已达 ${Math.round(usedMB)}MB，超过 ${CONFIG.memoryLimitMB}MB 阈值`);
    setTimeout(() => safeRefresh(), 2000);
  }
}

// 安全刷新：确保刷新后的 URL 包含 ? 使插件能激活，兼容 hash 路由中 ? 在 # 之后的情况
function safeRefresh(): void {
  const href = location.href;
  if (!href.includes('?')) {
    // hash 路由场景：在 hash 末尾追加 ?_dw=1 作为占位参数
    location.href = href + (href.includes('#') ? '?_dw=1' : '?_dw=1');
  } else {
    location.reload();
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
