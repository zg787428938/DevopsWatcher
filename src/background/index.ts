// Background Service Worker：职责单一，仅作为桌面通知的代理
// content script 无法直接调用 chrome.notifications API，需通过 sendMessage 委托 background 创建
// Popup 与 content script 直接通信（chrome.tabs.sendMessage），不经过 background 中转

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'CREATE_NOTIFICATION') {
    // 使用时间戳生成唯一通知 ID，避免多次通知互相覆盖
    const notifId = `devops-watcher-${Date.now()}`;
    chrome.notifications.create(notifId, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: message.title,
      message: message.message,
      priority: 2, // 高优先级确保通知显示在前
    });

    // 按配置时长自动清除通知（PRD 要求 10 秒），duration <= 0 时不自动清除
    if (message.duration > 0) {
      setTimeout(() => {
        chrome.notifications.clear(notifId);
      }, message.duration);
    }

    sendResponse({ success: true });
  }
  if (message.type === 'CLOSE_TAB') {
    if (_sender.tab?.id) {
      chrome.tabs.remove(_sender.tab.id);
    }
    sendResponse({ success: true });
  }

  return true;
});

// 标签页关闭时的清理钩子（当前无需额外清理，因为 tab 状态由 content script 自行管理）
chrome.tabs.onRemoved.addListener((_tabId) => {});
