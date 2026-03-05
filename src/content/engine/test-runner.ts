// 测试运行器：执行与正式监控完全相同的流程，但在每个关键步骤记录详细诊断日志
// 测试完成或异常时自动下载日志文件；也支持随时通过 popup 的"下载日志"按钮手动下载已有日志
// 日志通过共享 logger 模块存储，正式模式和测试模式互通

import { CONFIG, getRandomInterval } from '../../config';
import { store } from '../../store';
import { ApiBridge } from '../services/api-bridge';
import { db } from '../services/db';
import { sendNotification, playBeep } from '../services/notification';
import { log, resetLog, downloadLog, formatApiData, formatChange } from '../services/logger';
import { Scanner } from './scanner';
import { Waiter } from './waiter';
import { detectChanges } from './detector';
import { collectAllPages } from './pagination';
import { simulateClick } from './click';
import type { PoolSnapshot, ApiResponseData, PoolChange } from '../../types';

export class TestRunner {
  private apiBridge: ApiBridge;
  private scanner: Scanner;
  private waiter: Waiter;

  constructor(apiBridge: ApiBridge) {
    this.apiBridge = apiBridge;
    this.scanner = new Scanner();
    this.waiter = new Waiter(apiBridge);
  }

  async run(): Promise<void> {
    resetLog('test');
    const testStartTime = Date.now();
    store.setState({ isTesting: true, status: '🧪 测试开始...', statusType: 'normal' });

    try {
      await this.phaseEnvironment();
      await this.phaseApiIntercept();
      await this.phaseScanner();
      await this.phaseInitialCollect();
      await this.phaseCountdownRound();
      await this.phaseUI();
      await this.phaseNotification();
      await this.phaseIndexedDB();
      await this.phaseMemory();
      log('Summary', 'PASS', `全部测试完成，耗时 ${((Date.now() - testStartTime) / 1000).toFixed(1)}s`);
    } catch (err) {
      const e = err as Error;
      log('Summary', 'FAIL', `测试中断: ${e.message}`, e.stack);
    } finally {
      store.setState({ isTesting: false, status: '测试结束，日志已下载', statusType: 'normal' });
      downloadLog();
    }
  }

  // ==================== Phase 1: 环境信息 ====================
  private async phaseEnvironment() {
    store.setState({ status: '🧪 Phase 1: 环境检测...' });

    log('Environment', 'INFO', 'URL', location.href);
    log('Environment', 'INFO', 'UserAgent', navigator.userAgent);
    log('Environment', 'INFO', 'readyState', document.readyState);
    log('Environment', 'INFO', 'timestamp', new Date().toISOString());

    const configDump = JSON.stringify({
      targets: CONFIG.targets,
      minInterval: CONFIG.minInterval,
      maxInterval: CONFIG.maxInterval,
      maxPages: CONFIG.maxPages,
      apiWaitMaxRetries: CONFIG.apiWaitMaxRetries,
      apiWaitRetryInterval: CONFIG.apiWaitRetryInterval,
      clickRenderDelay: CONFIG.clickRenderDelay,
      paginationDelayMin: CONFIG.paginationDelayMin,
      paginationDelayMax: CONFIG.paginationDelayMax,
      apiFreshnessThreshold: CONFIG.apiFreshnessThreshold,
      fastPollMaxAttempts: CONFIG.fastPollMaxAttempts,
      fastPollInterval: CONFIG.fastPollInterval,
      loadTimeoutThreshold: CONFIG.loadTimeoutThreshold,
      memoryLimitMB: CONFIG.memoryLimitMB,
      maxChangesRecords: CONFIG.maxChangesRecords,
      selectors: CONFIG.selectors,
      apiPath: CONFIG.apiPath,
    }, null, 2);
    log('Environment', 'INFO', 'CONFIG', configDump);

    const host = document.getElementById('devops-watcher-root');
    log('Environment', host ? 'PASS' : 'FAIL', 'Shadow DOM', host ? 'mounted' : 'not found');

    const hasQuery = location.href.includes('?');
    log('Environment', hasQuery ? 'PASS' : 'FAIL', 'URL activation', `contains '?': ${hasQuery}`);

    // 倒计时舍入方式：Math.round 避免 timer jitter 导致秒数跳跃
    log('Environment', 'INFO', '倒计时舍入', 'Math.round（消除 Math.ceil 在整数边界的 2 秒跳跃）');

    // isMonitoring 持久化验证
    const MONITORING_KEY = 'devops-watcher-monitoring';
    const savedBefore = localStorage.getItem(MONITORING_KEY);
    log('Environment', 'INFO', 'isMonitoring 持久化（当前值）', `localStorage["${MONITORING_KEY}"]="${savedBefore}"`);
    try {
      localStorage.setItem(MONITORING_KEY, '__test__');
      const readBack = localStorage.getItem(MONITORING_KEY);
      const writable = readBack === '__test__';
      if (savedBefore !== null) {
        localStorage.setItem(MONITORING_KEY, savedBefore);
      } else {
        localStorage.removeItem(MONITORING_KEY);
      }
      log('Environment', writable ? 'PASS' : 'FAIL', 'isMonitoring 持久化（读写）', `writable=${writable}`);
    } catch (e) {
      log('Environment', 'FAIL', 'isMonitoring 持久化（读写）', `localStorage 不可用: ${(e as Error).message}`);
    }
  }

  // ==================== Phase 2: API 拦截 ====================
  private async phaseApiIntercept() {
    store.setState({ status: '🧪 Phase 2: API 拦截检测...' });

    const cached = this.apiBridge.getLatest();
    if (cached) {
      log('API', 'PASS', '已有缓存数据', formatApiData(cached.data, cached.url, cached.timestamp));
    } else {
      log('API', 'INFO', '无缓存数据，等待 API 响应...');
      const waitStart = Date.now();
      try {
        const data = await this.apiBridge.waitForFreshResponse(0, 15_000);
        const elapsed = Date.now() - waitStart;
        log('API', 'PASS', `收到 API 响应 (${elapsed}ms)`, formatApiData(data));
      } catch {
        const elapsed = Date.now() - waitStart;
        log('API', 'FAIL', `等待 API 响应超时 (${elapsed}ms)`, '15秒内未收到任何 API 响应，inject.js 可能未成功注入');
      }
    }
  }

  // ==================== Phase 3: 侧边栏扫描 ====================
  private async phaseScanner() {
    store.setState({ status: '🧪 Phase 3: 侧边栏扫描...' });

    const allItems = document.querySelectorAll(CONFIG.selectors.sidebarMenuItem);
    log('Scanner', 'INFO', '侧边栏菜单项数量', `selector="${CONFIG.selectors.sidebarMenuItem}" matched=${allItems.length}`);

    const itemTexts: string[] = [];
    allItems.forEach((el) => {
      itemTexts.push((el as HTMLElement).textContent?.trim() ?? '(empty)');
    });
    log('Scanner', 'INFO', '所有菜单项', itemTexts.join(' | '));

    for (const target of CONFIG.targets) {
      const el = this.scanner.findMenuItem(target);
      if (el) {
        log('Scanner', 'PASS', `找到 "${target}"`, `text="${el.textContent?.trim()}" tag=${el.tagName}`);
      } else {
        log('Scanner', 'FAIL', `未找到 "${target}"`, `在 ${allItems.length} 个菜单项中未匹配`);
      }
    }

    const activeEl = document.querySelector(CONFIG.selectors.activeCategory);
    const activeText = activeEl ? (activeEl as HTMLElement).textContent?.trim() : null;
    const currentPool = this.scanner.getCurrentPoolName();
    log('Scanner', 'INFO', '当前激活池', `selector="${CONFIG.selectors.activeCategory}" text="${activeText}" matched="${currentPool}"`);

    // 特异性匹配测试：检测是否存在互为子串的 target，验证匹配优先级
    const substrPairs: string[] = [];
    for (let i = 0; i < CONFIG.targets.length; i++) {
      for (let j = 0; j < CONFIG.targets.length; j++) {
        if (i !== j && CONFIG.targets[j].includes(CONFIG.targets[i])) {
          substrPairs.push(`"${CONFIG.targets[i]}" ⊂ "${CONFIG.targets[j]}"`);
        }
      }
    }
    if (substrPairs.length > 0) {
      log('Scanner', 'INFO', '子串关系', substrPairs.join(', '));
      if (activeText && currentPool) {
        const longestMatch = CONFIG.targets
          .filter(t => activeText.includes(t))
          .sort((a, b) => b.length - a.length)[0];
        const correct = currentPool === longestMatch;
        log('Scanner', correct ? 'PASS' : 'FAIL', '特异性匹配',
          `text="${activeText}" matched="${currentPool}" expected="${longestMatch}"`);
      }
    } else {
      log('Scanner', 'INFO', '无子串关系，无需特异性测试');
    }
  }

  // ==================== Phase 4: 初始收集（与 monitor.initialCollect 一致） ====================
  // 仅提取当前页面已有的目标池数据，不主动点击其他池
  private async phaseInitialCollect() {
    store.setState({ status: '🧪 Phase 4: 初始收集...' });

    const currentPool = this.scanner.getCurrentPoolName();

    if (currentPool) {
      log('InitialCollect', 'INFO', `当前页面在目标池 "${currentPool}" 上，提取已有数据`);
      const cached = this.apiBridge.getLatest();
      if (cached) {
        await this.collectAndLog('InitialCollect', currentPool, cached.data, false);
      } else {
        log('InitialCollect', 'WARN', `当前池 "${currentPool}" 无缓存数据`);
      }
    } else {
      log('InitialCollect', 'INFO', '当前页面不在任何目标池上，全部由倒计时轮询处理');
    }
  }

  // ==================== Phase 5: 倒计时轮询（与 CountdownService 一致，按操作均匀分布） ====================
  private async phaseCountdownRound() {
    store.setState({ status: '🧪 Phase 5: 倒计时轮询...' });

    const interval = getRandomInterval();

    // 根据快照预估各池页数（与 monitor.startNextRound 一致）
    const snapshots = store.getState().poolSnapshots;
    const estimatedPages = CONFIG.targets.map(target => {
      const snap = snapshots[target];
      if (!snap) return 1;
      const pages = Math.ceil(snap.totalCount / 100);
      return CONFIG.maxPages > 0 ? Math.min(Math.max(1, pages), CONFIG.maxPages) : Math.max(1, pages);
    });

    // 模拟首轮跳过已初始采集的池（与 monitor.startNextRound 一致）
    const currentPool = this.scanner.getCurrentPoolName();
    const skipIndex = currentPool ? CONFIG.targets.indexOf(currentPool) : -1;
    const skipIndices = skipIndex !== -1 ? new Set([skipIndex]) : undefined;
    if (skipIndices) {
      log('CountdownRound', 'INFO', `首轮跳过已采集池: "${currentPool}" (index=${skipIndex})`);
    }

    // 构建操作列表（与 CountdownService.startRound 一致，支持 skipPoolIndices）
    const operations: { poolIndex: number; pageIndex: number }[] = [];
    for (let p = 0; p < CONFIG.targets.length; p++) {
      if (skipIndices?.has(p)) continue;
      for (let pg = 0; pg < estimatedPages[p]; pg++) {
        operations.push({ poolIndex: p, pageIndex: pg });
      }
    }

    const totalOps = operations.length;
    log('CountdownRound', 'INFO', `随机间隔: ${interval}s（范围 ${CONFIG.minInterval}-${CONFIG.maxInterval}s）`);
    log('CountdownRound', 'INFO', `预估页数: ${CONFIG.targets.map((t, i) => `${t}=${estimatedPages[i]}p`).join(' ')}`);
    log('CountdownRound', 'INFO', `操作数: ${totalOps}（${totalOps} 个操作均匀分布，间隔 ≈${(interval / totalOps).toFixed(1)}s）`);

    // 打印调度计划：T*(i+1)/(totalOps+1) 使首尾留出等间距
    const schedule = operations.map((op, i) => {
      const offset = ((interval * (i + 1)) / (totalOps + 1)).toFixed(1);
      const name = CONFIG.targets[op.poolIndex];
      const page = op.pageIndex > 0 ? ` P${op.pageIndex + 1}` : '';
      return `  ${offset}s → ${name}${page}`;
    }).join('\n');
    log('CountdownRound', 'INFO', '调度计划', '\n' + schedule);

    const roundStart = Date.now();

    for (let i = 0; i < totalOps; i++) {
      const op = operations[i];
      const poolName = CONFIG.targets[op.poolIndex];
      const pageLabel = op.pageIndex > 0 ? ` P${op.pageIndex + 1}` : '';
      const targetOffset = (interval * (i + 1)) / (totalOps + 1);
      const elapsed = (Date.now() - roundStart) / 1000;
      const waitTime = Math.max(0, targetOffset - elapsed);

      if (waitTime > 0) {
        log('CountdownRound', 'INFO', `等待 ${waitTime.toFixed(1)}s → "${poolName}${pageLabel}"（offset=${targetOffset.toFixed(1)}s）`);
        store.setState({
          status: `🧪 等待中... ${Math.ceil(waitTime)}s 后检测 ${poolName}${pageLabel}`,
          countdown: Math.ceil(interval - elapsed),
          totalCountdown: interval,
        });
        await sleep(waitTime * 1000);
      }

      const opElapsed = ((Date.now() - roundStart) / 1000).toFixed(1);

      if (op.pageIndex === 0) {
        log('CountdownRound', 'INFO', `--- 检测 "${poolName}" (elapsed=${opElapsed}s) ---`);
        await this.clickAndCollect('CountdownRound', poolName);
      } else {
        log('CountdownRound', 'INFO', `--- 翻页 "${poolName}" P${op.pageIndex + 1} (elapsed=${opElapsed}s) ---`);
        log('CountdownRound', 'INFO', `翻页由 collectAllPages 在首页操作中已完成，此处仅验证调度时间`);
      }
    }

    const totalElapsed = ((Date.now() - roundStart) / 1000).toFixed(1);
    log('CountdownRound', 'PASS', `倒计时轮询完成，实际耗时 ${totalElapsed}s（计划 ${interval}s）`);
  }

  // 通用的点击 → 等待 → 收集流程，供 initialCollect 和 countdownRound 共用
  private async clickAndCollect(phase: string, poolName: string): Promise<boolean> {
    const menuItem = this.scanner.findMenuItem(poolName);
    if (!menuItem) {
      log(phase, 'FAIL', `"${poolName}" 菜单项未找到，跳过`);
      return false;
    }

    this.apiBridge.invalidateFreshness();
    const clickTime = Date.now();
    log(phase, 'INFO', `点击 "${poolName}" 菜单项`, `clickTime=${clickTime} (freshness invalidated)`);
    simulateClick(menuItem);

    await sleep(CONFIG.clickRenderDelay);
    log(phase, 'INFO', `渲染延迟完成 (${CONFIG.clickRenderDelay}ms)`);

    const waitStart = Date.now();
    await this.waiter.waitForContentReady();
    log(phase, 'INFO', `内容就绪等待完成 (${Date.now() - waitStart}ms)`);

    let apiData: ApiResponseData | undefined;
    for (let attempt = 0; attempt <= CONFIG.apiWaitMaxRetries; attempt++) {
      try {
        const apiStart = Date.now();
        apiData = await this.apiBridge.waitForFreshResponse(clickTime, 15_000);
        log(phase, 'PASS', `"${poolName}" API 响应成功 (${Date.now() - apiStart}ms, attempt=${attempt})`, formatApiData(apiData));
        break;
      } catch {
        if (attempt < CONFIG.apiWaitMaxRetries) {
          log(phase, 'WARN', `"${poolName}" API 超时，重试 ${attempt + 1}/${CONFIG.apiWaitMaxRetries}`);
          simulateClick(menuItem);
          await sleep(CONFIG.apiWaitRetryInterval);
        } else {
          log(phase, 'FAIL', `"${poolName}" API 响应超时，已重试 ${CONFIG.apiWaitMaxRetries} 次`);
        }
      }
    }

    if (!apiData) return false;

    await this.collectAndLog(phase, poolName, apiData, true);
    return true;
  }

  private async collectAndLog(phase: string, poolName: string, apiData: ApiResponseData, didClick: boolean) {
    let allRequirements: string[];
    const totalPages = Math.ceil(apiData.totalCount / (apiData.pageSize || 100));
    log(phase, 'INFO', `"${poolName}" 分页信息`, `totalCount=${apiData.totalCount} pageSize=${apiData.pageSize} totalPages=${totalPages} maxPages=${CONFIG.maxPages}`);

    if (totalPages > 1 && didClick) {
      const pageStart = Date.now();
      allRequirements = await collectAllPages(this.apiBridge, this.waiter, apiData);
      log(phase, 'INFO', `"${poolName}" 翻页完成 (${Date.now() - pageStart}ms)`, `collected=${allRequirements.length} items`);
    } else {
      allRequirements = apiData.result.map((r) => r.subject);
    }

    log(phase, 'INFO', `"${poolName}" 需求列表 (${allRequirements.length})`, allRequirements.map((r, i) => `${i + 1}. ${r}`).join('\n'));

    const newSnapshot: PoolSnapshot = { poolName, totalCount: apiData.totalCount, requirements: allRequirements };

    const oldSnapshot = store.getState().poolSnapshots[poolName] ?? null;
    if (oldSnapshot) {
      log(phase, 'INFO', `"${poolName}" 旧快照`, `totalCount=${oldSnapshot.totalCount} requirements=${oldSnapshot.requirements.length}`);
    } else {
      log(phase, 'INFO', `"${poolName}" 无旧快照（首次检测）`);
    }

    const change = detectChanges(oldSnapshot, newSnapshot);
    if (change) {
      log(phase, 'INFO', `"${poolName}" 检测到变化`, formatChange(change));
    } else {
      log(phase, 'PASS', `"${poolName}" 无变化`);
    }

    store.updatePoolSnapshot(poolName, newSnapshot);
    await db.saveSnapshot(newSnapshot);
    log(phase, 'PASS', `"${poolName}" 快照已保存`);
  }

  // ==================== Phase 6: UI 组件测试 ====================
  private async phaseUI() {
    store.setState({ status: '🧪 Phase 6: UI 组件测试...' });

    // 获取 Shadow DOM 根节点
    const host = document.getElementById('devops-watcher-root');
    if (!host || !host.shadowRoot) {
      log('UI', 'FAIL', 'Shadow DOM 宿主不存在');
      return;
    }
    const shadow = host.shadowRoot;
    log('UI', 'PASS', 'Shadow DOM 宿主', `id="${host.id}" shadowRoot=${!!shadow}`);

    // 1. 验证悬浮球渲染（默认收起状态）
    store.setState({ isExpanded: false });
    await sleep(100);
    const ball = shadow.querySelector('.dw-ball');
    if (ball) {
      const countdownText = shadow.querySelector('.countdown-text');
      log('UI', 'PASS', '悬浮球已渲染', `countdownText="${countdownText?.textContent}"`);
    } else {
      log('UI', 'FAIL', '悬浮球未渲染');
    }

    // 2. 展开面板
    store.setState({ isExpanded: true });
    await sleep(100);
    const panel = shadow.querySelector('.dw-panel');
    if (panel) {
      log('UI', 'PASS', '面板已展开');
    } else {
      log('UI', 'FAIL', '面板展开失败');
      return;
    }

    // 3. 标题栏
    const titleBar = shadow.querySelector('.dw-titlebar');
    const titleText = shadow.querySelector('.dw-titlebar-title');
    const badge = shadow.querySelector('.dw-badge');
    const countdownEl = shadow.querySelector('.dw-titlebar-countdown');
    log('UI', titleBar ? 'PASS' : 'FAIL', '标题栏', `title="${titleText?.textContent}" badge="${badge?.textContent}" countdown="${countdownEl?.textContent}"`);

    // 4. 需求池卡片 — 验证数量与快照一致
    const cards = shadow.querySelectorAll('.dw-pool-card');
    log('UI', cards.length === CONFIG.targets.length ? 'PASS' : 'FAIL', `需求池卡片数量`, `expected=${CONFIG.targets.length} actual=${cards.length}`);

    const snapshots = store.getState().poolSnapshots;
    cards.forEach((card, idx) => {
      const name = card.querySelector('.dw-pool-card-name')?.textContent?.trim() ?? '';
      const countText = card.querySelector('.dw-pool-card-count')?.textContent?.trim() ?? '-';
      const expectedCount = snapshots[name]?.totalCount;
      const match = expectedCount !== undefined && String(expectedCount) === countText;
      log('UI', match ? 'PASS' : 'FAIL', `卡片 "${name}"`, `显示=${countText} 快照=${expectedCount ?? '无'}`);
    });

    // 5. 状态栏
    const statusBar = shadow.querySelector('.dw-status-bar');
    const statusText = shadow.querySelector('.dw-status-text');
    log('UI', statusBar ? 'PASS' : 'FAIL', '状态栏', `text="${statusText?.textContent}"`);

    // 6. 折叠区域存在性
    const content = shadow.querySelector('.dw-content');
    const sections = content?.querySelectorAll('.dw-section-header');
    log('UI', 'INFO', '折叠区域', `count=${sections?.length ?? 0}`);

    // 7. 收起面板 → 回到悬浮球
    store.setState({ isExpanded: false });
    await sleep(100);
    const ballAgain = shadow.querySelector('.dw-ball');
    const panelGone = !shadow.querySelector('.dw-panel');
    log('UI', ballAgain && panelGone ? 'PASS' : 'FAIL', '收起面板', `ball=${!!ballAgain} panelRemoved=${panelGone}`);

    // 8. 拖拽手柄标记
    store.setState({ isExpanded: true });
    await sleep(100);
    const dragHandle = shadow.querySelector('[data-drag-handle]');
    const noDrag = shadow.querySelector('[data-no-drag]');
    log('UI', dragHandle ? 'PASS' : 'FAIL', '拖拽手柄', `data-drag-handle=${!!dragHandle} data-no-drag=${!!noDrag}`);

    // 8b. touch-action 验证：drag-handle 应为 none，滚动容器不应为 none
    if (dragHandle) {
      const handleTA = getComputedStyle(dragHandle as Element).touchAction;
      log('UI', handleTA === 'none' ? 'PASS' : 'FAIL', 'drag-handle touch-action',
        `expected="none" actual="${handleTA}"`);
    }
    const scrollBodies = shadow.querySelectorAll('.dw-section-body');
    scrollBodies.forEach((body, i) => {
      const ta = getComputedStyle(body).touchAction;
      const ok = ta !== 'none';
      log('UI', ok ? 'PASS' : 'FAIL', `section-body[${i}] touch-action`,
        `expected≠"none" actual="${ta}" (滚动需要 touch-action≠none)`);
    });
    const wrapperEl = host.parentElement ?? host;
    const wrapperTA = getComputedStyle(wrapperEl).touchAction;
    log('UI', wrapperTA !== 'none' ? 'PASS' : 'FAIL', 'DragWrapper 容器 touch-action',
      `expected≠"none" actual="${wrapperTA}"`);

    // 9. 悬浮球视口可见性（以中心为锚点，中心在视口内即为正常）
    store.setState({ isExpanded: false });
    await sleep(100);
    const ballEl = shadow.querySelector('.dw-ball') as HTMLElement | null;
    if (ballEl) {
      const br = ballEl.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const cx = br.left + br.width / 2;
      const cy = br.top + br.height / 2;
      const centerInView = cx >= 0 && cx <= vw && cy >= 0 && cy <= vh;
      log('UI', centerInView ? 'PASS' : 'WARN', '悬浮球视口可见性',
        `center=(${Math.round(cx)},${Math.round(cy)}) rect=(${Math.round(br.left)},${Math.round(br.top)},${Math.round(br.right)},${Math.round(br.bottom)}) viewport=${vw}x${vh} centerInView=${centerInView}`);
    }

    // 10. 展开面板视口可见性（以中心为锚点）
    store.setState({ isExpanded: true });
    await sleep(100);
    const panelEl = shadow.querySelector('.dw-panel') as HTMLElement | null;
    if (panelEl) {
      const pr = panelEl.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const cx = pr.left + pr.width / 2;
      const cy = pr.top + pr.height / 2;
      const centerInView = cx >= 0 && cx <= vw && cy >= 0 && cy <= vh;
      log('UI', centerInView ? 'PASS' : 'WARN', '面板视口可见性',
        `center=(${Math.round(cx)},${Math.round(cy)}) rect=(${Math.round(pr.left)},${Math.round(pr.top)},${Math.round(pr.right)},${Math.round(pr.bottom)}) viewport=${vw}x${vh} centerInView=${centerInView}`);
      log('UI', 'INFO', '面板尺寸', `width=${Math.round(pr.width)} height=${Math.round(pr.height)} maxHeight=85vh(${Math.round(vh * 0.85)}px)`);
    }

    // 11. 需求池卡片列数上限（最多 2 列）
    const poolGrid = shadow.querySelector('.dw-pool-grid') as HTMLElement | null;
    if (poolGrid) {
      const gridCols = getComputedStyle(poolGrid).gridTemplateColumns;
      const colCount = gridCols.split(' ').length;
      const expectedCols = Math.min(CONFIG.targets.length, 2);
      log('UI', colCount === expectedCols ? 'PASS' : 'FAIL', '卡片网格列数',
        `columns=${colCount} expected=${expectedCols} gridTemplateColumns="${gridCols}"`);
    }

    // 12. 手风琴模式：展开一个区域，其他自动收起
    store.setState({ chartCollapsed: true, changesCollapsed: true, historyCollapsed: true });
    await sleep(100);
    store.setState({ chartCollapsed: false });
    await sleep(100);
    const afterChart = store.getState();
    log('UI', !afterChart.chartCollapsed && afterChart.changesCollapsed && afterChart.historyCollapsed ? 'PASS' : 'WARN',
      '手风琴-展开图表', `chart=${!afterChart.chartCollapsed} changes=${!afterChart.changesCollapsed} history=${!afterChart.historyCollapsed}`);

    // 需求变化时间戳显示
    store.setState({ changesCollapsed: false, chartCollapsed: true, historyCollapsed: true });
    await sleep(100);
    const changesEntries = shadow.querySelectorAll('.dw-changes-entry');
    const changesTimeEls = shadow.querySelectorAll('.dw-changes-time');
    const storeChanges = store.getState().changes;
    if (storeChanges.length > 0) {
      log('UI', changesEntries.length > 0 ? 'PASS' : 'FAIL', '需求变化条目',
        `entries=${changesEntries.length} storeChanges=${storeChanges.length}`);
      log('UI', changesTimeEls.length > 0 ? 'PASS' : 'FAIL', '需求变化时间戳',
        `timeElements=${changesTimeEls.length} firstText="${changesTimeEls[0]?.textContent}"`);
    } else {
      log('UI', 'INFO', '无需求变化数据，跳过时间戳验证');
    }

    // 需求变化 section 内部滚动
    const changesBodies = shadow.querySelectorAll('.dw-section-body');
    let changesBodyFound = false;
    changesBodies.forEach(body => {
      const el = body as HTMLElement;
      if (el.style.maxHeight) {
        changesBodyFound = true;
        log('UI', 'PASS', '需求变化滚动容器', `maxHeight=${el.style.maxHeight} overflowY=${el.style.overflowY}`);
      }
    });
    if (!changesBodyFound) {
      log('UI', 'INFO', '需求变化 section-body 无 maxHeight（可能折叠中）');
    }

    // 恢复折叠状态
    store.setState({ chartCollapsed: true, changesCollapsed: true, historyCollapsed: true });
    await sleep(100);

    // 13. 滚动容器测试
    const contentEl = shadow.querySelector('.dw-content') as HTMLElement | null;
    if (contentEl) {
      const cs = getComputedStyle(contentEl);
      const overflowY = cs.overflowY;
      const scrollable = contentEl.scrollHeight > contentEl.clientHeight;
      log('UI', overflowY === 'auto' || overflowY === 'scroll' ? 'PASS' : 'FAIL', '滚动容器 overflow-y',
        `overflowY="${overflowY}" scrollHeight=${contentEl.scrollHeight} clientHeight=${contentEl.clientHeight} needsScroll=${scrollable}`);

      // 展开所有折叠区域后重新检测
      store.setState({ chartCollapsed: false, changesCollapsed: false, historyCollapsed: false });
      await sleep(200);
      const expandedScrollable = contentEl.scrollHeight > contentEl.clientHeight;
      log('UI', 'INFO', '全部展开后滚动',
        `scrollHeight=${contentEl.scrollHeight} clientHeight=${contentEl.clientHeight} needsScroll=${expandedScrollable}`);

      // 滚动到底部，验证最后一个子元素可达
      contentEl.scrollTop = contentEl.scrollHeight;
      await sleep(100);
      const atBottom = Math.abs(contentEl.scrollTop + contentEl.clientHeight - contentEl.scrollHeight) < 2;
      log('UI', atBottom ? 'PASS' : 'FAIL', '滚动到底部',
        `scrollTop=${Math.round(contentEl.scrollTop)} scrollHeight=${contentEl.scrollHeight} clientHeight=${contentEl.clientHeight} reachedBottom=${atBottom}`);

      // 验证底部最后一个区域在滚动后可见
      const lastSection = contentEl.lastElementChild as HTMLElement | null;
      if (lastSection) {
        const lr = lastSection.getBoundingClientRect();
        const cr = contentEl.getBoundingClientRect();
        const visible = lr.bottom <= cr.bottom + 2 && lr.top >= cr.top - 2;
        log('UI', visible ? 'PASS' : 'FAIL', '底部区域可见性',
          `lastSection="${lastSection.className}" top=${Math.round(lr.top)} bottom=${Math.round(lr.bottom)} containerBottom=${Math.round(cr.bottom)} visible=${visible}`);
      }

      // 滚动回顶部
      contentEl.scrollTop = 0;
      await sleep(100);
      const atTop = contentEl.scrollTop === 0;
      log('UI', atTop ? 'PASS' : 'FAIL', '滚动回顶部', `scrollTop=${contentEl.scrollTop}`);

      // 恢复折叠状态
      store.setState({ chartCollapsed: true, changesCollapsed: true, historyCollapsed: true });
    } else {
      log('UI', 'FAIL', '滚动容器 .dw-content 未找到');
    }

    // 恢复收起状态
    store.setState({ isExpanded: false });
  }

  // ==================== Phase 7: 通知测试 ====================
  private async phaseNotification() {
    store.setState({ status: '🧪 Phase 7: 通知测试...' });

    const testChange: PoolChange = {
      poolName: '测试通知',
      oldCount: 0,
      newCount: 1,
      added: ['DevOps Watcher 测试通知 - 请忽略'],
      removed: [],
      timestamp: Date.now(),
    };

    try {
      await sendNotification(testChange);
      log('Notification', 'PASS', '桌面通知发送成功');
    } catch (err) {
      log('Notification', 'FAIL', '桌面通知发送失败', (err as Error).message);
    }

    try {
      playBeep();
      log('Notification', 'PASS', '蜂鸣音播放成功');
    } catch (err) {
      log('Notification', 'FAIL', '蜂鸣音播放失败', (err as Error).message);
    }
  }

  // ==================== Phase 8: IndexedDB ====================
  private async phaseIndexedDB() {
    store.setState({ status: '🧪 Phase 8: IndexedDB...' });

    try {
      const historyCount = await db.getHistoryCount();
      log('IndexedDB', 'PASS', '历史记录数', `count=${historyCount}`);

      const snapshots = await db.getAllSnapshots();
      log('IndexedDB', 'PASS', '快照数', `count=${snapshots.length}`);
      for (const snap of snapshots) {
        log('IndexedDB', 'INFO', `快照 "${snap.poolName}"`, `totalCount=${snap.totalCount} requirements=${snap.requirements.length}`);
      }

      const changesCount = await db.getChangesCount();
      log('IndexedDB', 'PASS', '变化记录数', `count=${changesCount}`);
      if (changesCount > 0) {
        const recentChanges = await db.getRecentChanges(5);
        for (const c of recentChanges) {
          log('IndexedDB', 'INFO', `变化 "${c.poolName}"`,
            `id=${c.id} time=${new Date(c.timestamp).toISOString()} added=${c.added.length} removed=${c.removed.length}`);
        }
      }

      const collapsedPos = await db.getPosition('collapsed');
      const expandedPos = await db.getPosition('expanded');
      log('IndexedDB', 'PASS', '位置数据', `collapsed=${JSON.stringify(collapsedPos)} expanded=${JSON.stringify(expandedPos)}`);
    } catch (err) {
      log('IndexedDB', 'FAIL', 'IndexedDB 访问失败', (err as Error).message);
    }
  }

  // ==================== Phase 9: 内存 ====================
  private async phaseMemory() {
    store.setState({ status: '🧪 Phase 9: 内存检测...' });

    const perf = performance as any;
    if (perf.memory) {
      const used = Math.round(perf.memory.usedJSHeapSize / 1048576);
      const total = Math.round(perf.memory.totalJSHeapSize / 1048576);
      const limit = Math.round(perf.memory.jsHeapSizeLimit / 1048576);
      log('Memory', 'PASS', '内存信息', `used=${used}MB total=${total}MB limit=${limit}MB configLimit=${CONFIG.memoryLimitMB}MB`);
    } else {
      log('Memory', 'WARN', 'performance.memory 不可用');
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
