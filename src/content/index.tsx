// 内容脚本入口模块，运行时机为 document_start（页面最早阶段）
// 分两阶段执行：Phase 1 在 DOM 就绪前注入 API 劫持脚本并启动监听
// Phase 2 在 DOM body 就绪后创建 Shadow DOM、挂载 React UI、启动监控或测试
// URL 含 _dwtest=1 时进入测试模式（由 popup "开始测试"按钮新开标签页触发）

import React from 'react';
import { createRoot } from 'react-dom/client';
import { CONFIG } from '../config';
import { store } from '../store';
import { ApiBridge } from './services/api-bridge';
import { db } from './services/db';
import { Monitor } from './engine/monitor';
import { TestRunner } from './engine/test-runner';
import { downloadLog } from './services/logger';
import { App } from './ui/App';
import { STYLES } from './ui/styles';

const MONITORING_STATE_KEY = 'devops-watcher-monitoring';

function saveMonitoringState(enabled: boolean) {
  try { localStorage.setItem(MONITORING_STATE_KEY, enabled ? '1' : '0'); } catch {}
}

function loadMonitoringState(): boolean | null {
  try {
    const v = localStorage.getItem(MONITORING_STATE_KEY);
    return v === '1' ? true : v === '0' ? false : null;
  } catch { return null; }
}

function shouldActivate(): boolean {
  return location.href.includes('?');
}

function isTestMode(): boolean {
  return location.href.includes('_dwtest=1');
}

function injectApiHook() {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('inject.js');
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);
}

function waitForBody(): Promise<void> {
  if (document.body) return Promise.resolve();
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (document.body) {
        observer.disconnect();
        resolve();
      }
    });
    observer.observe(document.documentElement, { childList: true });
  });
}

function resetPosition() {
  const collapsedPos = {
    x: window.innerWidth + CONFIG.defaultPosition.x,
    y: window.innerHeight + CONFIG.defaultPosition.y,
  };
  const expandedPos = {
    x: window.innerWidth - CONFIG.panelWidth - 20,
    y: 60,
  };
  store.setState({ collapsedPos, expandedPos });
  db.savePosition('collapsed', collapsedPos).catch(() => {});
  db.savePosition('expanded', expandedPos).catch(() => {});
}

let uiMounted = false;

function mountUI() {
  if (uiMounted) return;
  uiMounted = true;

  const host = document.createElement('div');
  host.id = 'devops-watcher-root';
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = STYLES;
  shadow.appendChild(style);

  const mountPoint = document.createElement('div');
  shadow.appendChild(mountPoint);

  const root = createRoot(mountPoint);
  root.render(<App />);
}

async function main() {
  // Phase 1：注入 API 劫持并启动桥接
  injectApiHook();
  const apiBridge = new ApiBridge();
  apiBridge.start();

  await waitForBody();

  const canActivate = shouldActivate();
  const testMode = isTestMode();
  const savedState = loadMonitoringState();

  // 自动启动条件：URL 可激活且未被用户明确关闭
  const shouldAutoStart = canActivate && savedState !== false && !testMode;

  let monitor: Monitor | null = null;

  if (testMode) {
    mountUI();
    await db.init();
    const runner = new TestRunner(apiBridge);
    runner.run();
  } else if (shouldAutoStart) {
    mountUI();
    monitor = new Monitor(apiBridge);
    monitor.start();
    saveMonitoringState(true);
  } else {
    store.setState({ isMonitoring: false, status: '监控未启动', statusType: 'normal' });
  }

  // 始终注册消息监听，确保 Popup 在任何状态下都能通信
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'QUERY_STATE') {
      const s = store.getState();
      sendResponse({ isMonitoring: s.isMonitoring, isTesting: s.isTesting });
      return true;
    }

    if (message.type === 'SET_MONITORING') {
      if (message.enabled) {
        mountUI();
        if (!monitor) {
          monitor = new Monitor(apiBridge);
          monitor.start();
        } else {
          monitor.resume();
        }
        saveMonitoringState(true);
      } else {
        if (monitor) monitor.pause();
        saveMonitoringState(false);
      }
      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'DOWNLOAD_LOG') {
      downloadLog();
      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'RESET_POSITION') {
      resetPosition();
      sendResponse({ success: true });
      return true;
    }

    return false;
  });
}

main();
