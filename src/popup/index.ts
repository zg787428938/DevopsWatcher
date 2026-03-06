// Popup 弹窗脚本：监控开关 + 开始测试（新开标签页）+ 下载日志

async function init() {
  const content = document.getElementById('content')!;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tab?.id;
  const tabUrl = tab?.url || '';

  let isMonitoring = false;
  let isTesting = false;
  let connected = false;

  if (tabId) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: 'QUERY_STATE' });
      if (response) {
        connected = true;
        isMonitoring = response.isMonitoring;
        isTesting = response.isTesting;
      }
    } catch {}
  }

  const disabled = !connected;

  content.innerHTML = `
    <div class="row">
      <span class="label">监控开关</span>
      <label class="switch">
        <input type="checkbox" id="toggle" ${isMonitoring ? 'checked' : ''} ${disabled || isTesting ? 'disabled' : ''}>
        <span class="slider"></span>
      </label>
    </div>
    <div class="divider"></div>
    <div class="btn-group">
      <button class="test-btn" id="test-btn" ${disabled || isTesting ? 'disabled' : ''}>
        🧪 ${isTesting ? '测试中...' : '开始测试'}
      </button>
      <button class="test-btn download-btn" id="download-btn" ${disabled ? 'disabled' : ''}>
        📥 下载日志
      </button>
    </div>
    <div class="secondary-group">
      <button class="secondary-btn" id="reset-pos-btn" ${disabled ? 'disabled' : ''}>↺ 重置位置</button>
    </div>
    <div class="status" id="status-text">
      ${!connected ? '⚠ 未连接 · 请刷新页面' : isTesting ? '⏳ 测试标签页已打开' : isMonitoring ? '✅ 监控运行中' : '⏸️ 监控已暂停'}
    </div>
  `;

  const toggle = document.getElementById('toggle') as HTMLInputElement;
  const testBtn = document.getElementById('test-btn') as HTMLButtonElement;
  const downloadBtn = document.getElementById('download-btn') as HTMLButtonElement;
  const resetPosBtn = document.getElementById('reset-pos-btn') as HTMLButtonElement;
  const statusText = document.getElementById('status-text')!;

  toggle.addEventListener('change', async () => {
    try {
      await chrome.tabs.sendMessage(tabId!, { type: 'SET_MONITORING', enabled: toggle.checked });
      statusText.textContent = toggle.checked ? '✅ 监控运行中' : '⏸️ 监控已暂停';
    } catch {
      statusText.textContent = '❌ 通信失败';
      statusText.className = 'status error';
    }
  });

  testBtn.addEventListener('click', () => {
    if (!tabUrl) return;
    let testUrl = tabUrl;
    testUrl = testUrl.replace(/[&?]_dwtest=1/g, '');
    const separator = testUrl.includes('?') ? '&' : '?';
    testUrl += separator + '_dwtest=1';
    chrome.tabs.create({ url: testUrl });
    if (tabId) chrome.tabs.remove(tabId);
  });

  downloadBtn.addEventListener('click', async () => {
    try {
      await chrome.tabs.sendMessage(tabId!, { type: 'DOWNLOAD_LOG' });
      statusText.textContent = '📥 日志下载已触发';
    } catch {
      statusText.textContent = '❌ 无可下载的日志';
      statusText.className = 'status error';
    }
  });

  resetPosBtn.addEventListener('click', async () => {
    try {
      await chrome.tabs.sendMessage(tabId!, { type: 'RESET_POSITION' });
      statusText.textContent = '✅ 位置已重置';
    } catch {
      statusText.textContent = '❌ 重置失败';
      statusText.className = 'status error';
    }
  });
}

init();
