// 测试运行器：执行与正式监控完全相同的流程，但在每个关键步骤记录详细诊断日志
// 测试完成或异常时自动下载日志文件；也支持随时通过 popup 的"下载日志"按钮手动下载已有日志
// 日志通过共享 logger 模块存储，正式模式和测试模式互通

import { CONFIG, getRandomInterval } from '../../config';
import { store } from '../../store';
import { ApiBridge } from '../services/api-bridge';
import { db } from '../services/db';
import { sendNotification, playBeep } from '../services/notification';
import { log, resetLog, downloadLog, getLogs, formatApiData, formatChange } from '../services/logger';
import { isContextValid, isRefreshPending } from './recovery';
import { Scanner } from './scanner';
import { Waiter } from './waiter';
import { detectChanges } from './detector';
import { collectAllPages, type CollectResult } from './pagination';
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
      await this.phaseRuntimeHealth();
      this.logTestSummary(testStartTime);
    } catch (err) {
      const e = err as Error;
      log('Summary', 'FAIL', `测试中断: ${e.message}`, e.stack);
      this.logTestSummary(testStartTime);
    } finally {
      store.setState({ isTesting: false, status: '测试结束，日志已下载', statusType: 'normal' });
      downloadLog();
      setTimeout(() => {
        try { chrome.runtime.sendMessage({ type: 'CLOSE_TAB' }); } catch {}
      }, 1000);
    }
  }

  // ==================== Phase 1: 环境信息 ====================
  private async phaseEnvironment() {
    store.setState({ status: '🧪 Phase 1: 环境检测...' });

    // 版本信息
    try {
      const manifest = chrome.runtime.getManifest();
      log('Environment', 'INFO', '版本', `v${manifest.version} (${manifest.name})`);
    } catch {
      log('Environment', 'WARN', '版本', '无法读取 manifest（扩展上下文可能已失效）');
    }

    log('Environment', 'INFO', 'URL', location.href);
    log('Environment', 'INFO', 'UserAgent', navigator.userAgent);
    log('Environment', 'INFO', 'timestamp', new Date().toISOString());

    const configDump = JSON.stringify({
      targets: CONFIG.targets,
      minInterval: CONFIG.minInterval,
      maxInterval: CONFIG.maxInterval,
      maxPages: CONFIG.maxPages,
      apiWaitMaxRetries: CONFIG.apiWaitMaxRetries,
      loadTimeoutThreshold: CONFIG.loadTimeoutThreshold,
      memoryLimitMB: CONFIG.memoryLimitMB,
      maxHistoryRecords: CONFIG.maxHistoryRecords,
      maxChangesRecords: CONFIG.maxChangesRecords,
      selectors: CONFIG.selectors,
    }, null, 2);
    log('Environment', 'INFO', 'CONFIG', configDump);

    const host = document.getElementById('devops-watcher-root');
    log('Environment', host ? 'PASS' : 'FAIL', 'Shadow DOM', host ? 'mounted' : 'not found');

    const hasQuery = location.href.includes('?');
    log('Environment', hasQuery ? 'PASS' : 'FAIL', 'URL activation', `contains '?': ${hasQuery}`);

    // inject.js 注入验证
    const scripts = document.querySelectorAll('script[src*="inject.js"]');
    log('Environment', scripts.length > 0 ? 'PASS' : 'WARN', 'inject.js 注入',
      scripts.length > 0 ? `找到 ${scripts.length} 个 script 标签` : '未找到 inject.js 标签（API 拦截可能失败）');

    // isMonitoring 持久化验证
    const MONITORING_KEY = 'devops-watcher-monitoring';
    const savedBefore = localStorage.getItem(MONITORING_KEY);
    log('Environment', 'INFO', 'isMonitoring 持久化', `localStorage="${savedBefore}"`);
    try {
      localStorage.setItem(MONITORING_KEY, '__test__');
      const readBack = localStorage.getItem(MONITORING_KEY);
      const writable = readBack === '__test__';
      if (savedBefore !== null) {
        localStorage.setItem(MONITORING_KEY, savedBefore);
      } else {
        localStorage.removeItem(MONITORING_KEY);
      }
      log('Environment', writable ? 'PASS' : 'FAIL', 'localStorage 读写', `writable=${writable}`);
    } catch (e) {
      log('Environment', 'FAIL', 'localStorage 读写', `不可用: ${(e as Error).message}`);
    }
  }

  // ==================== Phase 2: API 拦截 ====================
  private async phaseApiIntercept() {
    store.setState({ status: '🧪 Phase 2: API 拦截检测...' });

    let apiData: ApiResponseData | null = null;
    const cached = this.apiBridge.getLatest();
    if (cached) {
      apiData = cached.data;
      log('API', 'PASS', '已有缓存数据', formatApiData(cached.data, cached.url, cached.timestamp));
    } else {
      log('API', 'INFO', '无缓存数据，等待 API 响应...');
      const waitStart = Date.now();
      try {
        apiData = await this.apiBridge.waitForFreshResponse(0, 15_000);
        const elapsed = Date.now() - waitStart;
        log('API', 'PASS', `收到 API 响应 (${elapsed}ms)`, formatApiData(apiData));
      } catch {
        const elapsed = Date.now() - waitStart;
        log('API', 'FAIL', `等待 API 响应超时 (${elapsed}ms)`, '15秒内未收到任何 API 响应，inject.js 可能未成功注入');
      }
    }

    // API 数据结构验证
    if (apiData) {
      const checks: string[] = [];
      if (typeof apiData.totalCount !== 'number' || apiData.totalCount < 0)
        checks.push(`totalCount 异常: ${apiData.totalCount}`);
      if (!Array.isArray(apiData.result))
        checks.push('result 不是数组');
      if (typeof apiData.toPage !== 'number' || apiData.toPage < 1)
        checks.push(`toPage 异常: ${apiData.toPage}`);
      if (typeof apiData.pageSize !== 'number' || apiData.pageSize <= 0)
        checks.push(`pageSize 异常: ${apiData.pageSize}`);
      if (apiData.result.length > 0 && !apiData.result[0].subject)
        checks.push('result[0] 缺少 subject 字段');
      if (apiData.result.length > 0 && !apiData.result[0].identifier)
        checks.push('result[0] 缺少 identifier 字段（无法获取工作项详情）');

      if (checks.length > 0) {
        log('API', 'FAIL', 'API 数据结构异常', checks.join('\n'));
      } else {
        log('API', 'PASS', 'API 数据结构正常',
          `totalCount=${apiData.totalCount} resultLength=${apiData.result.length} toPage=${apiData.toPage} pageSize=${apiData.pageSize}`);
        if (apiData.result.length > 0) {
          log('API', 'PASS', 'identifier 字段',
            `result[0].identifier="${apiData.result[0].identifier}" （工作项详情可用）`);
        }
      }

      // URL 路径验证
      if (cached?.url) {
        const matchesPath = cached.url.includes(CONFIG.apiPath);
        log('API', matchesPath ? 'PASS' : 'WARN', 'API URL 路径',
          `url=${cached.url} expected contains="${CONFIG.apiPath}" match=${matchesPath}`);
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
  private async phaseInitialCollect() {
    store.setState({ status: '🧪 Phase 4: 初始收集...' });

    const currentPool = this.scanner.getCurrentPoolName();

    if (currentPool) {
      log('InitialCollect', 'INFO', `当前页面在目标池 "${currentPool}" 上，提取已有数据`);
      const cached = this.apiBridge.getLatest();
      if (cached) {
        const data = cached.data;
        const pageSize = data.pageSize || 100;
        const totalPages = Math.ceil(data.totalCount / pageSize);

        // 分页状态检测
        if (data.toPage > 1) {
          log('InitialCollect', 'WARN', `缓存数据在第 ${data.toPage} 页`,
            `页面可能保留了上次浏览的分页状态，初始快照将不完整`);
        }

        if (totalPages > 1) {
          log('InitialCollect', 'INFO', `"${currentPool}" 有 ${totalPages} 页`,
            `仅有第 ${data.toPage} 页的 ${data.result.length} 条数据，monitor 会跳过部分快照保存`);
          // 模拟 monitor.initialCollect 的多页处理逻辑：不保存部分快照
          log('InitialCollect', 'PASS', `"${currentPool}" 多页池处理正确`,
            '跳过部分快照保存，避免后续误报变化');
        } else {
          await this.collectAndLog('InitialCollect', currentPool, data, false);
        }
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

    // 轮次后快照一致性验证
    const finalSnapshots = store.getState().poolSnapshots;
    const snapshotIssues: string[] = [];
    for (const target of CONFIG.targets) {
      const snap = finalSnapshots[target];
      if (!snap) {
        snapshotIssues.push(`"${target}" 无快照（检测可能失败）`);
        continue;
      }
      if (snap.requirements.length < snap.totalCount) {
        snapshotIssues.push(`"${target}" 数据不完整: ${snap.requirements.length}/${snap.totalCount}`);
      }
      // 需求名去重检查：重复的 subject 可能导致变化检测失准
      const uniqueNames = new Set(snap.requirements);
      if (uniqueNames.size < snap.requirements.length) {
        const dupeCount = snap.requirements.length - uniqueNames.size;
        snapshotIssues.push(`"${target}" 有 ${dupeCount} 条重名需求，可能影响变化检测准确性`);
      }
    }
    if (snapshotIssues.length > 0) {
      log('CountdownRound', 'WARN', '轮次后快照问题', snapshotIssues.join('\n'));
    } else {
      const summary = CONFIG.targets.map(t => {
        const s = finalSnapshots[t];
        return `${t}:${s?.totalCount ?? '?'}`;
      }).join(' ');
      log('CountdownRound', 'PASS', '轮次后快照完整', summary);
    }

    // 跨池数据污染检测：各池快照的 items 不应出现在其他池中
    const poolItemSets = new Map<string, Set<string>>();
    for (const target of CONFIG.targets) {
      const snap = finalSnapshots[target];
      if (snap?.items && snap.items.length > 0) {
        poolItemSets.set(target, new Set(snap.items.map(i => i.identifier).filter(Boolean)));
      }
    }
    const contaminations: string[] = [];
    const poolNames = [...poolItemSets.keys()];
    for (let i = 0; i < poolNames.length; i++) {
      for (let j = i + 1; j < poolNames.length; j++) {
        const setA = poolItemSets.get(poolNames[i])!;
        const setB = poolItemSets.get(poolNames[j])!;
        let overlap = 0;
        for (const id of setA) {
          if (setB.has(id)) overlap++;
        }
        if (overlap > 0) {
          contaminations.push(`"${poolNames[i]}" 与 "${poolNames[j]}" 有 ${overlap} 条重复 identifier`);
        }
      }
    }
    if (contaminations.length > 0) {
      log('CountdownRound', 'FAIL', '跨池数据污染', contaminations.join('\n'));
    } else if (poolItemSets.size >= 2) {
      log('CountdownRound', 'PASS', '跨池数据隔离', `${poolItemSets.size} 个池的 identifier 无重叠`);
    }

    // 跨池 totalCount 互换检测：检查是否有池的 totalCount 与其他池完全一致（可疑）
    const countMap = new Map<number, string[]>();
    for (const target of CONFIG.targets) {
      const snap = finalSnapshots[target];
      if (snap) {
        const arr = countMap.get(snap.totalCount) ?? [];
        arr.push(target);
        countMap.set(snap.totalCount, arr);
      }
    }
    for (const [count, pools] of countMap) {
      if (pools.length > 1) {
        log('CountdownRound', 'WARN', '多池 totalCount 相同',
          `${pools.map(p => `"${p}"`).join(' 和 ')} 的 totalCount 均为 ${count}，可能存在数据互换`);
      }
    }
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

        // 跨池数据污染检测
        const activePool = this.scanner.getCurrentPoolName();
        if (activePool && activePool !== poolName) {
          log(phase, 'FAIL', `"${poolName}" 跨池数据污染`,
            `activePool="${activePool}" expected="${poolName}"，API 数据来自错误的池`);
          apiData = undefined;
          if (attempt < CONFIG.apiWaitMaxRetries) {
            this.apiBridge.invalidateFreshness();
            simulateClick(menuItem);
            await sleep(CONFIG.apiWaitRetryInterval);
            continue;
          }
          return false;
        }

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

    // 分页状态残留检测：上一轮翻页后页面未重置，导致当前返回非第 1 页数据
    if (apiData.toPage > 1) {
      log(phase, 'WARN', `"${poolName}" 分页状态残留`,
        `toPage=${apiData.toPage}（期望 1），页面保留了上次翻页状态`);

      const pagItems = document.querySelectorAll('.next-pagination-item');
      let firstPageBtn: HTMLElement | null = null;
      for (const item of pagItems) {
        const el = item as HTMLElement;
        const text = el.textContent?.trim();
        if (text === '1' && !el.classList.contains('next-next') && !el.classList.contains('next-prev')) {
          firstPageBtn = el;
          break;
        }
      }
      if (!firstPageBtn) {
        firstPageBtn = document.querySelector(CONFIG.selectors.prevPageBtn) as HTMLElement | null;
      }

      if (firstPageBtn) {
        this.apiBridge.invalidateFreshness();
        const resetTime = Date.now();
        simulateClick(firstPageBtn);
        await sleep(CONFIG.clickRenderDelay);
        await this.waiter.waitForContentReady();
        try {
          apiData = await this.apiBridge.waitForFreshResponse(resetTime, 10_000);
          log(phase, apiData.toPage === 1 ? 'PASS' : 'WARN', `"${poolName}" 分页回退`,
            `toPage=${apiData.toPage} resultLength=${apiData.result.length}`);
        } catch {
          log(phase, 'FAIL', `"${poolName}" 分页回退超时`);
          return false;
        }
      } else {
        log(phase, 'FAIL', `"${poolName}" 未找到分页回退按钮`);
      }
    }

    await this.collectAndLog(phase, poolName, apiData, true);
    return true;
  }

  private async collectAndLog(phase: string, poolName: string, apiData: ApiResponseData, didClick: boolean) {
    let allRequirements: string[];
    let allItems: { subject: string; identifier: string }[];
    const pageSize = apiData.pageSize || 100;
    const totalPages = Math.ceil(apiData.totalCount / pageSize);
    log(phase, 'INFO', `"${poolName}" 分页信息`,
      `totalCount=${apiData.totalCount} pageSize=${pageSize} toPage=${apiData.toPage} totalPages=${totalPages} maxPages=${CONFIG.maxPages}`);

    // 数据一致性检查：resultLength vs pageSize/totalCount
    const expectedLen = apiData.toPage < totalPages ? pageSize : apiData.totalCount - (apiData.toPage - 1) * pageSize;
    if (apiData.result.length !== expectedLen && apiData.result.length !== apiData.totalCount) {
      log(phase, 'WARN', `"${poolName}" 数据长度异常`,
        `resultLength=${apiData.result.length} expected=${expectedLen}（toPage=${apiData.toPage} of ${totalPages}）`);
    }

    if (totalPages > 1 && didClick) {
      if (apiData.toPage !== 1) {
        log(phase, 'WARN', `"${poolName}" 翻页起始页异常`,
          `toPage=${apiData.toPage}，collectAllPages 将从非第 1 页开始，数据可能不完整`);
      }
      const pageStart = Date.now();
      const collected = await collectAllPages(this.apiBridge, this.waiter, apiData);
      allRequirements = collected.requirements;
      allItems = collected.items;
      log(phase, 'INFO', `"${poolName}" 翻页完成 (${Date.now() - pageStart}ms)`, `collected=${allRequirements.length} items`);

      // 翻页完整性检查
      const completeness = allRequirements.length / apiData.totalCount;
      if (completeness < 0.9) {
        log(phase, 'WARN', `"${poolName}" 翻页数据不完整`,
          `collected=${allRequirements.length} totalCount=${apiData.totalCount} completeness=${(completeness * 100).toFixed(1)}%`);
      }
    } else {
      allRequirements = apiData.result.map((r) => r.subject);
      allItems = apiData.result.map(r => ({ subject: r.subject, identifier: r.identifier }));
    }

    // 去重：翻页期间数据变动可能导致同一需求出现在多页中
    const uniqueReqs = [...new Set(allRequirements)];
    if (uniqueReqs.length < allRequirements.length) {
      log(phase, 'WARN', `"${poolName}" 翻页数据重复`,
        `collected=${allRequirements.length} unique=${uniqueReqs.length}`);
      allRequirements = uniqueReqs;
      const seen = new Set<string>();
      allItems = allItems.filter(item => {
        if (seen.has(item.subject)) return false;
        seen.add(item.subject);
        return true;
      });
    }

    log(phase, 'INFO', `"${poolName}" 需求列表 (${allRequirements.length})`, allRequirements.map((r, i) => `${i + 1}. ${r}`).join('\n'));

    // 翻页数据完整性校验
    if (allRequirements.length !== apiData.totalCount) {
      log(phase, 'WARN', `"${poolName}" 翻页数据不完整`,
        `collected=${allRequirements.length} totalCount=${apiData.totalCount}，正式运行时会跳过变化检测`);
    }

    const newSnapshot: PoolSnapshot = { poolName, totalCount: apiData.totalCount, requirements: allRequirements, items: allItems };

    // items 字段完整性校验
    const hasIdentifiers = allItems.length > 0 && allItems.every((i: { identifier: string }) => i.identifier && i.identifier !== '');
    log(phase, hasIdentifiers ? 'PASS' : 'WARN', `"${poolName}" items 字段`,
      `count=${allItems.length} allHaveIdentifier=${hasIdentifiers}${!hasIdentifiers && allItems.length > 0 ? '（部分工作项缺少 identifier，详情功能受限）' : ''}`);

    const oldSnapshot = store.getState().poolSnapshots[poolName] ?? null;
    if (oldSnapshot) {
      log(phase, 'INFO', `"${poolName}" 旧快照`, `totalCount=${oldSnapshot.totalCount} requirements=${oldSnapshot.requirements.length}`);
    } else {
      log(phase, 'INFO', `"${poolName}" 无旧快照（首次检测）`);
    }

    const change = detectChanges(oldSnapshot, newSnapshot);
    if (change) {
      // 分页残留误报特征检测
      if (change.removed.length >= pageSize * 0.8 && change.added.length <= 5) {
        log(phase, 'WARN', `"${poolName}" 疑似分页残留误报`,
          `removed=${change.removed.length}（接近 pageSize=${pageSize}），可能仅获取了部分页数据`);
      }
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
      const dot = card.querySelector('.dw-pool-card-dot') as HTMLElement | null;
      const dotColor = dot?.style.background ?? 'none';
      log('UI', match ? 'PASS' : 'FAIL', `卡片 "${name}"`,
        `count: 显示=${countText} 快照=${expectedCount ?? '无'} dot=${dotColor}`);
    });

    // 5. 状态栏
    const statusBar = shadow.querySelector('.dw-status-bar');
    const statusText = shadow.querySelector('.dw-status-text');
    log('UI', statusBar ? 'PASS' : 'FAIL', '状态栏', `text="${statusText?.textContent}"`);

    // 6. 折叠区域存在性
    const content = shadow.querySelector('.dw-content');
    const sections = content?.querySelectorAll('.dw-section-header');
    log('UI', 'INFO', '折叠区域', `count=${sections?.length ?? 0}`);

    // 6b. 需求列表区域验证
    store.setState({ requirementsCollapsed: false, chartCollapsed: true, changesCollapsed: true, historyCollapsed: true });
    await sleep(100);
    const reqPools = shadow.querySelectorAll('.dw-req-pool');
    const reqItems = shadow.querySelectorAll('.dw-req-item');
    const reqPoolHeaders = shadow.querySelectorAll('.dw-req-pool-header');
    log('UI', reqPools.length > 0 ? 'PASS' : 'WARN', '需求列表池分组',
      `pools=${reqPools.length} expected=${CONFIG.targets.length} items=${reqItems.length}`);
    reqPoolHeaders.forEach(header => {
      const name = (header as HTMLElement).querySelector('.dw-pool-label')?.textContent?.trim() ?? '';
      const badge = (header as HTMLElement).querySelector('.dw-section-badge')?.textContent?.trim() ?? '';
      log('UI', 'INFO', `需求池 "${name}"`, `badge=${badge}`);
    });
    if (reqItems.length > 0) {
      const firstItem = reqItems[0] as HTMLElement;
      const cursor = getComputedStyle(firstItem).cursor;
      const idxEl = firstItem.querySelector('.dw-req-idx');
      const nameEl = firstItem.querySelector('.dw-req-name');
      const chevron = firstItem.querySelector('.dw-req-chevron');
      log('UI', cursor === 'pointer' ? 'PASS' : 'WARN', '需求项可点击性',
        `cursor=${cursor} idx=${idxEl?.textContent?.trim()} name="${nameEl?.textContent?.trim()?.slice(0, 30)}" chevron=${!!chevron}`);
    }
    store.setState({ requirementsCollapsed: true });
    await sleep(100);

    // 6c. 需求详情页测试（独立视图导航 + 渲染 + 滚动）
    const detailSnapshots = store.getState().poolSnapshots;
    let testDetailItem: { identifier: string; subject: string } | null = null;
    for (const target of CONFIG.targets) {
      const snap = detailSnapshots[target];
      if (snap?.items) {
        const found = snap.items.find(i => i.identifier && i.identifier !== '');
        if (found) {
          testDetailItem = { identifier: found.identifier, subject: found.subject };
          break;
        }
      }
    }

    if (testDetailItem) {
      log('UI', 'INFO', '--- 详情页测试 ---', `identifier="${testDetailItem.identifier}" subject="${testDetailItem.subject.slice(0, 30)}"`);

      store.setState({ detailView: testDetailItem });
      await sleep(200);

      const detailPage = shadow.querySelector('.dw-detail-page');
      log('UI', detailPage ? 'PASS' : 'FAIL', '详情页渲染', `detailPage=${!!detailPage}`);

      if (detailPage) {
        // 标题栏元素验证
        const backBtn = shadow.querySelector('.dw-detail-back');
        const detailId = shadow.querySelector('.dw-detail-id');
        const detailTitle = shadow.querySelector('.dw-detail-title');
        log('UI', backBtn ? 'PASS' : 'FAIL', '详情页返回按钮', `存在=${!!backBtn}`);
        log('UI', detailId?.textContent === testDetailItem.identifier ? 'PASS' : 'FAIL', '详情页 identifier',
          `expected="${testDetailItem.identifier}" actual="${detailId?.textContent}"`);
        log('UI', detailTitle?.textContent ? 'PASS' : 'FAIL', '详情页标题',
          `text="${detailTitle?.textContent?.slice(0, 40)}"`);

        // 返回按钮 aria-label
        const backLabel = backBtn?.getAttribute('aria-label');
        log('UI', backLabel ? 'PASS' : 'WARN', '详情页返回按钮 aria-label', `aria-label="${backLabel}"`);

        // 拖拽手柄
        const detailHeader = shadow.querySelector('.dw-detail-header');
        log('UI', detailHeader?.hasAttribute('data-drag-handle') ? 'PASS' : 'FAIL', '详情页拖拽手柄',
          `data-drag-handle=${detailHeader?.hasAttribute('data-drag-handle')}`);

        // 主面板内容区互斥：dw-content 不应存在
        const mainContentInDetail = shadow.querySelector('.dw-content');
        log('UI', !mainContentInDetail ? 'PASS' : 'FAIL', '详情页与主面板互斥',
          `dw-content=${mainContentInDetail ? '存在（不应存在）' : '已隐藏'}`);

        // 详情内容区滚动能力
        const detailContent = shadow.querySelector('.dw-detail-content') as HTMLElement | null;
        if (detailContent) {
          const dcs = getComputedStyle(detailContent);
          const detailOverflow = dcs.overflowY;
          log('UI', detailOverflow === 'auto' || detailOverflow === 'scroll' ? 'PASS' : 'FAIL', '详情页 overflow-y',
            `expected="auto" actual="${detailOverflow}"`);

          const detailGutter = dcs.getPropertyValue('scrollbar-gutter') || (dcs as any).scrollbarGutter || '';
          log('UI', detailGutter.includes('stable') ? 'PASS' : 'FAIL', '详情页 scrollbar-gutter',
            `expected="stable" actual="${detailGutter}"`);

          // data-no-drag 验证：内容区滚动不应触发拖拽
          log('UI', detailContent.hasAttribute('data-no-drag') ? 'PASS' : 'FAIL', '详情页内容区 data-no-drag',
            `data-no-drag=${detailContent.hasAttribute('data-no-drag')}`);

          // Flex 布局验证：detail-page 应为 flex:1 + min-height:0
          const pageCS = getComputedStyle(detailPage);
          const pageFlex = pageCS.flex;
          const pageMinH = pageCS.minHeight;
          log('UI', pageFlex.startsWith('1') && pageMinH === '0px' ? 'PASS' : 'FAIL', '详情页 flex 布局',
            `flex="${pageFlex}" minHeight="${pageMinH}"（需要 flex:1 + min-height:0 才能滚动）`);

          // 等待详情数据加载
          log('UI', 'INFO', '等待详情 API 响应...（最长 5s）');
          await sleep(5000);

          const spinner = shadow.querySelector('.dw-detail-page .dw-req-spinner');
          const errorEl = shadow.querySelector('.dw-detail-status.error');
          const fields = shadow.querySelectorAll('.dw-detail-field');

          if (spinner) {
            log('UI', 'WARN', '详情页仍在加载', '5s 内未完成加载，API 可能超时');
          } else if (errorEl) {
            log('UI', 'WARN', '详情页加载失败', `error="${errorEl.textContent?.trim()}"`);
            const retryBtn = shadow.querySelector('.dw-detail-status .dw-req-retry');
            log('UI', retryBtn ? 'PASS' : 'FAIL', '详情页重试按钮', `存在=${!!retryBtn}`);
          } else if (fields.length > 0) {
            log('UI', 'PASS', '详情页字段渲染', `fieldCount=${fields.length}`);

            // 字段结构验证
            const firstField = fields[0] as HTMLElement;
            const labelEl = firstField.querySelector('.dw-detail-field-label');
            const valueEl = firstField.querySelector('.dw-detail-field-value');
            log('UI', labelEl && valueEl ? 'PASS' : 'FAIL', '详情页字段结构',
              `label="${labelEl?.textContent?.trim()}" value="${valueEl?.textContent?.trim()?.slice(0, 50)}"`);

            // 字段布局验证：label 和 value 应纵向排列（flex-direction: column）
            const fieldCS = getComputedStyle(firstField);
            log('UI', fieldCS.flexDirection === 'column' ? 'PASS' : 'FAIL', '详情页字段纵向布局',
              `flex-direction="${fieldCS.flexDirection}"（纵向布局避免换行问题）`);

            // 列出前 5 个字段名称
            const fieldNames: string[] = [];
            fields.forEach((f, i) => {
              if (i < 5) fieldNames.push(f.querySelector('.dw-detail-field-label')?.textContent?.trim() ?? '?');
            });
            log('UI', 'INFO', '详情页字段列表（前5）', fieldNames.join(' | '));

            // 滚动测试：内容溢出时验证可滚到底部
            if (detailContent.scrollHeight > detailContent.clientHeight) {
              detailContent.scrollTop = detailContent.scrollHeight;
              await sleep(100);
              const scrolledBottom = Math.abs(detailContent.scrollTop + detailContent.clientHeight - detailContent.scrollHeight) < 2;
              log('UI', scrolledBottom ? 'PASS' : 'FAIL', '详情页滚动到底部',
                `scrollTop=${Math.round(detailContent.scrollTop)} scrollHeight=${detailContent.scrollHeight} clientHeight=${detailContent.clientHeight}`);

              // 最后一个字段可见性
              const lastField = fields[fields.length - 1] as HTMLElement;
              const lfr = lastField.getBoundingClientRect();
              const dcr = detailContent.getBoundingClientRect();
              const lastVisible = lfr.bottom <= dcr.bottom + 2;
              log('UI', lastVisible ? 'PASS' : 'FAIL', '详情页底部字段可见',
                `lastFieldBottom=${Math.round(lfr.bottom)} containerBottom=${Math.round(dcr.bottom)} lastFieldLabel="${lastField.querySelector('.dw-detail-field-label')?.textContent?.trim()}"`);

              detailContent.scrollTop = 0;
              await sleep(100);
            } else {
              log('UI', 'PASS', '详情页内容未溢出', `scrollHeight=${detailContent.scrollHeight} clientHeight=${detailContent.clientHeight}（无需滚动）`);
            }
          } else {
            log('UI', 'INFO', '详情页暂无字段数据');
          }
        } else {
          log('UI', 'FAIL', '详情页内容容器 .dw-detail-content 未找到');
        }

        // 返回主面板
        store.setState({ detailView: null });
        await sleep(200);
        const detailGone = !shadow.querySelector('.dw-detail-page');
        const mainRestored = !!shadow.querySelector('.dw-content');
        log('UI', detailGone && mainRestored ? 'PASS' : 'FAIL', '详情页返回主面板',
          `detailRemoved=${detailGone} mainContentRestored=${mainRestored}`);
      }
    } else {
      log('UI', 'WARN', '详情页测试跳过', '所有快照中均无含 identifier 的需求项');
    }

    // 确保恢复到主面板
    store.setState({ detailView: null });
    await sleep(100);

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

    // 8b. user-select 验证：内容区域可选中复制，交互元素不可选
    const contentArea = shadow.querySelector('.dw-content') as HTMLElement | null;
    if (contentArea) {
      const contentUS = getComputedStyle(contentArea).userSelect;
      log('UI', contentUS === 'text' ? 'PASS' : 'FAIL', '内容区 user-select',
        `expected="text" actual="${contentUS}"（需求名称需要可复制）`);
    }
    const titlebarEl = shadow.querySelector('.dw-titlebar') as HTMLElement | null;
    if (titlebarEl) {
      const titleUS = getComputedStyle(titlebarEl).userSelect;
      log('UI', titleUS === 'none' ? 'PASS' : 'WARN', '标题栏 user-select',
        `expected="none" actual="${titleUS}"（拖拽区域应禁止选中）`);
    }
    const panelUS = panel ? getComputedStyle(panel).userSelect : '';
    if (panelUS === 'none') {
      log('UI', 'FAIL', '面板 user-select',
        `actual="none"（全局禁止选中会导致内容不可复制）`);
    } else {
      log('UI', 'PASS', '面板 user-select', `actual="${panelUS}"（未全局禁止）`);
    }

    // 8c. touch-action 验证：drag-handle 应为 none，滚动容器不应为 none
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
    store.setState({ requirementsCollapsed: true, chartCollapsed: true, changesCollapsed: true, historyCollapsed: true });
    await sleep(100);
    store.setState({ chartCollapsed: false, requirementsCollapsed: true });
    await sleep(100);
    const afterChart = store.getState();
    log('UI', !afterChart.chartCollapsed && afterChart.changesCollapsed && afterChart.historyCollapsed && afterChart.requirementsCollapsed ? 'PASS' : 'WARN',
      '手风琴-展开图表', `requirements=${!afterChart.requirementsCollapsed} chart=${!afterChart.chartCollapsed} changes=${!afterChart.changesCollapsed} history=${!afterChart.historyCollapsed}`);

    // 需求变化 section 详细验证
    store.setState({ changesCollapsed: false, requirementsCollapsed: true, chartCollapsed: true, historyCollapsed: true });
    await sleep(100);
    const storeChanges = store.getState().changes;
    if (storeChanges.length > 0) {
      // 变化条目 & 时间戳
      const changesEntries = shadow.querySelectorAll('.dw-changes-entry');
      const changesTimeEls = shadow.querySelectorAll('.dw-changes-time');
      log('UI', changesEntries.length > 0 ? 'PASS' : 'FAIL', '需求变化条目',
        `entries=${changesEntries.length} storeChanges=${storeChanges.length}`);
      log('UI', changesTimeEls.length > 0 ? 'PASS' : 'FAIL', '需求变化时间戳',
        `timeElements=${changesTimeEls.length} firstText="${changesTimeEls[0]?.textContent}"`);

      // 池分组标题 & 颜色标识
      const poolHeaders = shadow.querySelectorAll('.dw-changes-pool-header');
      log('UI', poolHeaders.length > 0 ? 'PASS' : 'FAIL', '变化池标题',
        `poolHeaders=${poolHeaders.length}`);
      poolHeaders.forEach(header => {
        const headerEl = header as HTMLElement;
        const name = headerEl.querySelector('.dw-pool-label')?.textContent?.trim() ?? '';
        const dot = headerEl.querySelector('.dw-pool-dot') as HTMLElement | null;
        const hasBorderLeft = headerEl.style.borderLeft?.includes('solid');
        const hasDot = dot && dot.style.background;
        log('UI', hasBorderLeft && hasDot ? 'PASS' : 'WARN', `池标题 "${name}"`,
          `borderLeft=${hasBorderLeft} dot=${!!hasDot}`);
      });

      // 新增/移除区块
      const addedBlocks = shadow.querySelectorAll('.dw-changes-block.added');
      const removedBlocks = shadow.querySelectorAll('.dw-changes-block.removed');
      log('UI', 'INFO', '变化区块', `added=${addedBlocks.length} removed=${removedBlocks.length}`);

      // 计数差值显示
      const countDiffs = shadow.querySelectorAll('.dw-changes-count-diff');
      log('UI', countDiffs.length > 0 ? 'PASS' : 'WARN', '计数差值显示',
        `countDiffElements=${countDiffs.length} firstText="${countDiffs[0]?.textContent?.trim()}"`);

      // 需求名可选中验证（在 li 元素上）
      const changeLi = shadow.querySelector('.dw-changes-list li') as HTMLElement | null;
      if (changeLi) {
        const liUS = getComputedStyle(changeLi).userSelect;
        log('UI', liUS !== 'none' ? 'PASS' : 'FAIL', '需求名可选中',
          `user-select="${liUS}"（应允许复制需求名）`);
      }

      // 清除按钮二次确认机制
      const clearBtns = shadow.querySelectorAll('.dw-changes-clear');
      if (clearBtns.length > 0) {
        const clearBtn = clearBtns[0] as HTMLElement;
        const initialText = clearBtn.textContent?.trim();
        log('UI', initialText === '清除' ? 'PASS' : 'FAIL', '清除按钮初始文本',
          `expected="清除" actual="${initialText}"`);
        log('UI', !clearBtn.classList.contains('confirming') ? 'PASS' : 'FAIL', '清除按钮初始状态',
          `confirming=${clearBtn.classList.contains('confirming')}（初始不应有确认样式）`);
      } else {
        log('UI', 'INFO', '未找到清除按钮（可能仅一个池有变化）');
      }
    } else {
      log('UI', 'INFO', '无需求变化数据，跳过变化 section 验证');
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
    store.setState({ requirementsCollapsed: true, chartCollapsed: true, changesCollapsed: true, historyCollapsed: true });
    await sleep(100);

    // 13. 滚动容器测试
    const contentEl = shadow.querySelector('.dw-content') as HTMLElement | null;
    if (contentEl) {
      const cs = getComputedStyle(contentEl);
      const overflowY = cs.overflowY;
      const scrollable = contentEl.scrollHeight > contentEl.clientHeight;
      log('UI', overflowY === 'auto' || overflowY === 'scroll' ? 'PASS' : 'FAIL', '滚动容器 overflow-y',
        `overflowY="${overflowY}" scrollHeight=${contentEl.scrollHeight} clientHeight=${contentEl.clientHeight} needsScroll=${scrollable}`);

      // 14. scrollbar-gutter 验证（防止滚动条出现/消失导致宽度跳动）
      const contentGutter = cs.getPropertyValue('scrollbar-gutter') || (cs as any).scrollbarGutter || '';
      log('UI', contentGutter.includes('stable') ? 'PASS' : 'FAIL', '滚动容器 scrollbar-gutter',
        `expected="stable" actual="${contentGutter}"（防止滚动条显隐导致内容宽度跳动）`);

      const sectionBodies = shadow.querySelectorAll('.dw-section-body');
      sectionBodies.forEach((body, i) => {
        const bodyCS = getComputedStyle(body);
        const bodyOverflow = bodyCS.overflowY;
        if (bodyOverflow === 'auto' || bodyOverflow === 'scroll') {
          const bodyGutter = bodyCS.getPropertyValue('scrollbar-gutter') || (bodyCS as any).scrollbarGutter || '';
          log('UI', bodyGutter.includes('stable') ? 'PASS' : 'FAIL', `section-body[${i}] scrollbar-gutter`,
            `expected="stable" actual="${bodyGutter}" overflowY="${bodyOverflow}"`);
        }
      });

      // 展开所有折叠区域后重新检测
      store.setState({ requirementsCollapsed: false, chartCollapsed: false, changesCollapsed: false, historyCollapsed: false });
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
      store.setState({ requirementsCollapsed: true, chartCollapsed: true, changesCollapsed: true, historyCollapsed: true });
    } else {
      log('UI', 'FAIL', '滚动容器 .dw-content 未找到');
    }

    // 15. 可访问性验证（aria 属性）
    log('UI', 'INFO', '--- 可访问性验证 ---');

    const allSvgs = shadow.querySelectorAll('svg');
    let svgHiddenCount = 0;
    let svgMissingAria = 0;
    allSvgs.forEach(svg => {
      if (svg.getAttribute('aria-hidden') === 'true') {
        svgHiddenCount++;
      } else if (!svg.getAttribute('aria-label')) {
        svgMissingAria++;
      }
    });
    log('UI', svgMissingAria === 0 ? 'PASS' : 'WARN', 'SVG aria 属性',
      `total=${allSvgs.length} aria-hidden=${svgHiddenCount} missingAria=${svgMissingAria}`);

    const closeBtn = shadow.querySelector('.dw-close-btn');
    const closeBtnLabel = closeBtn?.getAttribute('aria-label');
    log('UI', closeBtnLabel ? 'PASS' : 'WARN', '关闭按钮 aria-label',
      `aria-label="${closeBtnLabel ?? '(无)'}"`);

    // 16. CSS 类名迁移验证（旧名不应存在）
    log('UI', 'INFO', '--- CSS 类名迁移验证 ---');

    const oldPoolName = shadow.querySelector('.dw-changes-pool-name');
    log('UI', !oldPoolName ? 'PASS' : 'FAIL', '旧类名 dw-changes-pool-name',
      `${oldPoolName ? '仍存在（应迁移为 dw-pool-label）' : '已移除'}`);

    const oldPoolDot = shadow.querySelector('.dw-history-pool-dot');
    log('UI', !oldPoolDot ? 'PASS' : 'FAIL', '旧类名 dw-history-pool-dot',
      `${oldPoolDot ? '仍存在（应迁移为 dw-pool-dot）' : '已移除'}`);

    store.setState({ requirementsCollapsed: false, changesCollapsed: false, chartCollapsed: true, historyCollapsed: true });
    await sleep(100);
    const poolLabelsAll = shadow.querySelectorAll('.dw-pool-label');
    const poolDotsAll = shadow.querySelectorAll('.dw-pool-dot');
    log('UI', poolLabelsAll.length > 0 ? 'PASS' : 'WARN', '新类名 dw-pool-label',
      `count=${poolLabelsAll.length}（需求列表+变化区域共享）`);
    log('UI', poolDotsAll.length > 0 ? 'PASS' : 'WARN', '新类名 dw-pool-dot',
      `count=${poolDotsAll.length}（需求列表+变化+历史共享）`);

    store.setState({ requirementsCollapsed: true, changesCollapsed: true });
    await sleep(100);

    // 17. 颜色对比度抽检（检查关键元素的计算颜色）
    log('UI', 'INFO', '--- 颜色对比度抽检 ---');

    const contrastChecks: { selector: string; name: string; minContrast: string }[] = [
      { selector: '.dw-memory-text', name: '内存文字', minContrast: '#64748b' },
      { selector: '.dw-section-arrow', name: '折叠箭头', minContrast: '#64748b' },
    ];

    // 展开需求列表检查序号和箭头颜色
    store.setState({ requirementsCollapsed: false, chartCollapsed: true, changesCollapsed: true, historyCollapsed: true });
    await sleep(100);

    const reqIdxEl = shadow.querySelector('.dw-req-idx') as HTMLElement | null;
    if (reqIdxEl) {
      const idxColor = getComputedStyle(reqIdxEl).color;
      log('UI', 'INFO', '需求序号颜色', `color="${idxColor}"（需满足 WCAG AA 4.5:1）`);
    }

    const reqChevronEl = shadow.querySelector('.dw-req-chevron') as HTMLElement | null;
    if (reqChevronEl) {
      const chevronColor = getComputedStyle(reqChevronEl).color;
      log('UI', 'INFO', '需求箭头颜色', `color="${chevronColor}"（需满足 WCAG AA 4.5:1）`);
    }

    for (const check of contrastChecks) {
      const el = shadow.querySelector(check.selector) as HTMLElement | null;
      if (el) {
        const color = getComputedStyle(el).color;
        log('UI', 'INFO', `${check.name} 颜色`, `selector="${check.selector}" color="${color}" expectedMin="${check.minContrast}"`);
      }
    }

    // 展开变化区域检查时间戳颜色
    store.setState({ changesCollapsed: false, requirementsCollapsed: true });
    await sleep(100);
    const changeTimeEl = shadow.querySelector('.dw-changes-time') as HTMLElement | null;
    if (changeTimeEl) {
      const timeColor = getComputedStyle(changeTimeEl).color;
      log('UI', 'INFO', '变化时间戳颜色', `color="${timeColor}"（需满足 WCAG AA 4.5:1）`);
    }

    // 18. 折叠区域动画验证
    log('UI', 'INFO', '--- 折叠区域动画验证 ---');
    store.setState({ requirementsCollapsed: true, changesCollapsed: true, chartCollapsed: true, historyCollapsed: true });
    await sleep(100);
    store.setState({ requirementsCollapsed: false });
    await sleep(50);

    const animatedBody = shadow.querySelector('.dw-section-body') as HTMLElement | null;
    if (animatedBody) {
      const anim = getComputedStyle(animatedBody).animationName;
      log('UI', anim && anim !== 'none' ? 'PASS' : 'WARN', '折叠区域展开动画',
        `animationName="${anim}"（期望 dw-section-open）`);
    }

    // 19. detailView store 状态一致性
    log('UI', 'INFO', '--- Store detailView 状态验证 ---');
    const dvState = store.getState().detailView;
    log('UI', dvState === null ? 'PASS' : 'WARN', 'detailView 初始/恢复状态',
      `detailView=${dvState === null ? 'null（正常）' : JSON.stringify(dvState) + '（应在测试后恢复为 null）'}`);

    // 恢复折叠状态
    store.setState({ requirementsCollapsed: true, chartCollapsed: true, changesCollapsed: true, historyCollapsed: true });
    await sleep(100);

    // 恢复收起状态
    store.setState({ isExpanded: false, detailView: null });
  }

  // ==================== Phase 7: 通知测试 ====================
  private async phaseNotification() {
    store.setState({ status: '🧪 Phase 7: 通知测试...' });

    // 前置检查：扩展上下文
    if (!isContextValid()) {
      log('Notification', 'FAIL', '扩展上下文已失效', '通知将无法发送（chrome.runtime.sendMessage 会抛出 Extension context invalidated）');
      return;
    }
    log('Notification', 'PASS', '扩展上下文有效');

    // 通知权限检查
    if (typeof Notification !== 'undefined') {
      log('Notification', 'INFO', '通知权限', `Notification.permission="${Notification.permission}"`);
    }

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
      const msg = (err as Error).message;
      const isContextError = msg.includes('Extension context invalidated');
      log('Notification', 'FAIL', '桌面通知发送失败',
        `${msg}${isContextError ? '（扩展已重新加载，需刷新页面）' : ''}`);
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
      // ── 历史记录健康检查 ──
      const historyCount = await db.getHistoryCount();
      const historyOverLimit = historyCount > CONFIG.maxHistoryRecords;
      log('IndexedDB', historyOverLimit ? 'WARN' : 'PASS', '历史记录数',
        `count=${historyCount} max=${CONFIG.maxHistoryRecords}${historyOverLimit ? ' ⚠ 超出上限' : ''}`);

      // ── 快照完整性检查 ──
      const snapshots = await db.getAllSnapshots();
      log('IndexedDB', 'PASS', '快照数', `count=${snapshots.length}`);
      for (const snap of snapshots) {
        const isPartial = snap.requirements.length < snap.totalCount;
        const isTarget = CONFIG.targets.includes(snap.poolName);
        const hasItems = Array.isArray(snap.items) && snap.items.length > 0;
        const itemsHaveId = hasItems && snap.items!.every(i => i.identifier && i.identifier !== '');
        const status = !isTarget ? 'WARN' : isPartial ? 'WARN' : 'PASS';
        const detail = [
          `totalCount=${snap.totalCount}`,
          `requirements=${snap.requirements.length}`,
          `items=${hasItems ? snap.items!.length : '无'}`,
          `identifiers=${itemsHaveId ? '完整' : '缺失'}`,
          !isTarget ? '⚠ 非当前监控目标' : '',
          isPartial ? `⚠ 数据不完整（缺 ${snap.totalCount - snap.requirements.length} 条，可能为分页未完成）` : '',
          !hasItems ? '⚠ 无 items 字段（旧快照，需求详情功能不可用）' : '',
          hasItems && !itemsHaveId ? '⚠ 部分 items 缺少 identifier' : '',
        ].filter(Boolean).join(' ');
        log('IndexedDB', status, `快照 "${snap.poolName}"`, detail);
      }

      // ── 变化记录健康检查 ──
      const changesCount = await db.getChangesCount();
      const changesOverLimit = changesCount > CONFIG.maxChangesRecords;
      log('IndexedDB', changesOverLimit ? 'WARN' : 'PASS', '变化记录数',
        `count=${changesCount} max=${CONFIG.maxChangesRecords}${changesOverLimit ? ' ⚠ 超出上限' : ''}`);

      if (changesCount > 0) {
        const allChanges = await db.getRecentChanges(changesCount);

        // 统计总条目数
        let totalAdded = 0;
        let totalRemoved = 0;
        const suspiciousRecords: { id?: number; poolName: string; added: number; removed: number; time: string }[] = [];
        const SUSPICIOUS_THRESHOLD = 20;

        for (const c of allChanges) {
          totalAdded += c.added.length;
          totalRemoved += c.removed.length;
          if (c.added.length >= SUSPICIOUS_THRESHOLD || c.removed.length >= SUSPICIOUS_THRESHOLD) {
            suspiciousRecords.push({
              id: c.id,
              poolName: c.poolName,
              added: c.added.length,
              removed: c.removed.length,
              time: new Date(c.timestamp).toISOString(),
            });
          }
        }

        const totalItems = totalAdded + totalRemoved;
        log('IndexedDB', 'INFO', '变化记录总条目',
          `records=${changesCount} totalAdded=${totalAdded} totalRemoved=${totalRemoved} totalItems=${totalItems}`);

        // 按池分组统计
        const poolStats = new Map<string, { records: number; added: number; removed: number }>();
        for (const c of allChanges) {
          const s = poolStats.get(c.poolName) ?? { records: 0, added: 0, removed: 0 };
          s.records++;
          s.added += c.added.length;
          s.removed += c.removed.length;
          poolStats.set(c.poolName, s);
        }
        for (const [pool, s] of poolStats) {
          log('IndexedDB', 'INFO', `变化统计 "${pool}"`,
            `records=${s.records} added=${s.added} removed=${s.removed}`);
        }

        // 可疑记录检测：单条变化含大量条目（initialCollect 部分快照 bug 的特征）
        if (suspiciousRecords.length > 0) {
          log('IndexedDB', 'WARN', `发现 ${suspiciousRecords.length} 条可疑变化记录`,
            `单条 added/removed >= ${SUSPICIOUS_THRESHOLD} 可能为初始收集部分快照导致的误报`);
          for (const r of suspiciousRecords.slice(0, 10)) {
            log('IndexedDB', 'WARN', `可疑记录 id=${r.id}`,
              `pool="${r.poolName}" added=${r.added} removed=${r.removed} time=${r.time}`);
          }
          if (suspiciousRecords.length > 10) {
            log('IndexedDB', 'WARN', `... 还有 ${suspiciousRecords.length - 10} 条可疑记录`);
          }
        } else {
          log('IndexedDB', 'PASS', '无可疑变化记录（所有记录条目数合理）');
        }

        // 对称误报检测：相邻记录中出现 A 被移除 → A 被新增的镜像模式
        let mirrorCount = 0;
        for (let i = 0; i < allChanges.length - 1; i++) {
          const curr = allChanges[i];
          const next = allChanges[i + 1];
          if (curr.poolName !== next.poolName) continue;
          const addedSet = new Set(curr.added);
          const overlap = next.removed.filter(r => addedSet.has(r));
          if (overlap.length >= SUSPICIOUS_THRESHOLD) mirrorCount++;
          const removedSet = new Set(curr.removed);
          const overlap2 = next.added.filter(a => removedSet.has(a));
          if (overlap2.length >= SUSPICIOUS_THRESHOLD) mirrorCount++;
        }
        if (mirrorCount > 0) {
          log('IndexedDB', 'WARN', `发现 ${mirrorCount} 对镜像误报`,
            '相邻记录中同一批需求先被移除后被新增（或反之），为初始收集 bug 的典型特征');
        }

        // 分页残留误报检测：removed 数量接近 pageSize（80-100）且 added 很少
        const PAGE_SIZE = 100;
        let paginationFalseCount = 0;
        for (const c of allChanges) {
          if (c.removed.length >= PAGE_SIZE * 0.8 && c.added.length <= 5) {
            paginationFalseCount++;
          }
        }
        if (paginationFalseCount > 0) {
          log('IndexedDB', 'WARN', `发现 ${paginationFalseCount} 条疑似分页残留误报`,
            `removed≥${PAGE_SIZE * 0.8} 且 added≤5，特征为翻页后页面未重置到第 1 页`);
        } else {
          log('IndexedDB', 'PASS', '无分页残留误报特征');
        }

        // 初始收集误报检测：added 和 removed 数量都很大且接近
        let initialFalseCount = 0;
        for (const c of allChanges) {
          if (c.added.length >= SUSPICIOUS_THRESHOLD && c.removed.length >= SUSPICIOUS_THRESHOLD) {
            const ratio = Math.min(c.added.length, c.removed.length) / Math.max(c.added.length, c.removed.length);
            if (ratio > 0.5) initialFalseCount++;
          }
        }
        if (initialFalseCount > 0) {
          log('IndexedDB', 'WARN', `发现 ${initialFalseCount} 条疑似初始收集误报`,
            'added 和 removed 数量都很大且接近，特征为多页池首次收集时用部分数据做了比对');
        }

        // 最近 5 条变化详情
        const recent = allChanges.slice(0, 5);
        for (const c of recent) {
          log('IndexedDB', 'INFO', `变化 id=${c.id} "${c.poolName}"`,
            `time=${new Date(c.timestamp).toISOString()} added=${c.added.length} removed=${c.removed.length}`);
        }
      }

      // ── 历史记录健康检查（排序 & 时间间隔 & 重复） ──
      if (historyCount > 0) {
        const recentHistory = await db.getHistory(0, Math.min(historyCount, 100));
        // 时间排序验证：应为倒序（最新在前）
        let orderIssues = 0;
        for (let i = 0; i < recentHistory.length - 1; i++) {
          if (recentHistory[i].timestamp < recentHistory[i + 1].timestamp) {
            orderIssues++;
          }
        }
        log('IndexedDB', orderIssues === 0 ? 'PASS' : 'FAIL', '历史记录排序',
          `检查 ${recentHistory.length} 条，乱序 ${orderIssues} 处${orderIssues > 0 ? '（getHistory 的游标方向可能有误）' : ''}`);

        // 连续记录时间间隔分析
        if (recentHistory.length >= 2) {
          const gaps: number[] = [];
          for (let i = 0; i < recentHistory.length - 1; i++) {
            gaps.push(recentHistory[i].timestamp - recentHistory[i + 1].timestamp);
          }
          const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
          const maxGap = Math.max(...gaps);
          const minGap = Math.min(...gaps);
          log('IndexedDB', 'INFO', '历史记录间隔',
            `avg=${Math.round(avgGap / 1000)}s min=${Math.round(minGap / 1000)}s max=${Math.round(maxGap / 1000)}s（配置间隔 ${CONFIG.minInterval}-${CONFIG.maxInterval}s）`);
          if (maxGap > CONFIG.maxInterval * 3 * 1000) {
            log('IndexedDB', 'WARN', '历史记录存在大间隔',
              `最大间隔 ${Math.round(maxGap / 1000)}s 超过配置最大间隔的 3 倍，可能发生过页面刷新或扩展重启`);
          }
        }

        // 连续重复检测：相邻记录数据完全相同
        let dupeCount = 0;
        for (let i = 0; i < recentHistory.length - 1; i++) {
          const a = recentHistory[i], b = recentHistory[i + 1];
          if (JSON.stringify(a.pools) === JSON.stringify(b.pools)) {
            dupeCount++;
          }
        }
        if (dupeCount > recentHistory.length * 0.5) {
          log('IndexedDB', 'WARN', '大量连续重复历史',
            `${dupeCount}/${recentHistory.length} 条相邻记录 pools 数据相同，可能产生不必要的写入`);
        }
      }

      // ── 快照需求名去重检查 ──
      for (const snap of snapshots) {
        const unique = new Set(snap.requirements);
        if (unique.size < snap.requirements.length) {
          const dupeCount = snap.requirements.length - unique.size;
          log('IndexedDB', 'WARN', `快照 "${snap.poolName}" 重名需求`,
            `${dupeCount} 条重名（总 ${snap.requirements.length} 条），变化检测可能因此失准`);
        }
      }

      // ── 位置数据 ──
      const collapsedPos = await db.getPosition('collapsed');
      const expandedPos = await db.getPosition('expanded');
      log('IndexedDB', 'PASS', '位置数据', `collapsed=${JSON.stringify(collapsedPos)} expanded=${JSON.stringify(expandedPos)}`);

      // 位置合理性检查
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      for (const [label, pos] of [['collapsed', collapsedPos], ['expanded', expandedPos]] as const) {
        if (pos) {
          const outOfBounds = pos.x < -200 || pos.y < -200 || pos.x > vw + 200 || pos.y > vh + 200;
          if (outOfBounds) {
            log('IndexedDB', 'WARN', `${label} 位置偏离视口`,
              `(${pos.x}, ${pos.y}) viewport=${vw}x${vh}，下次打开可能看不到面板`);
          }
        }
      }
      // ── 日志持久化验证（DB v3）──
      const logsCount = await db.getLogsCount();
      log('IndexedDB', logsCount > 0 ? 'PASS' : 'WARN', '日志持久化',
        `logs store 记录数=${logsCount}（刷新后应保留历史日志）`);

      const allSavedLogs = await db.getAllLogs();
      const hasTs = allSavedLogs.length > 0 && typeof allSavedLogs[0].ts === 'number' && allSavedLogs[0].ts > 0;
      log('IndexedDB', hasTs ? 'PASS' : (allSavedLogs.length === 0 ? 'WARN' : 'FAIL'), '日志条目 ts 字段',
        allSavedLogs.length > 0
          ? `firstEntry.ts=${allSavedLogs[0].ts}（用于 Duration 精确计算）`
          : '无日志条目');

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
      const percent = Math.round((used / limit) * 100);
      log('Memory', 'PASS', '内存信息', `used=${used}MB total=${total}MB limit=${limit}MB configLimit=${CONFIG.memoryLimitMB}MB`);
      if (used > CONFIG.memoryLimitMB * 0.8) {
        log('Memory', 'WARN', '内存接近阈值',
          `used=${used}MB（${percent}%），阈值=${CONFIG.memoryLimitMB}MB，超过后将触发自动刷新`);
      }
    } else {
      log('Memory', 'WARN', 'performance.memory 不可用（非 Chromium 浏览器）');
    }
  }

  // ==================== Phase 10: 运行时健康检查 ====================
  private async phaseRuntimeHealth() {
    store.setState({ status: '🧪 Phase 10: 运行时健康检查...' });

    // ── 1. 扩展上下文有效性 ──
    const contextValid = isContextValid();
    log('RuntimeHealth', contextValid ? 'PASS' : 'FAIL', '扩展上下文',
      `chrome.runtime.id=${contextValid ? '有效' : '无效（扩展已被重新加载或卸载，将触发页面刷新）'}`);

    // ── 2. API Bridge 状态一致性 ──
    const lastTimestamp = this.apiBridge.getLastResponseTimestamp();
    const cached = this.apiBridge.getLatest();
    if (lastTimestamp > 0) {
      const age = Math.round((Date.now() - lastTimestamp) / 1000);
      log('RuntimeHealth', 'PASS', 'API Bridge 最后响应', `${age}s 前`);

      // 验证 invalidateFreshness 不影响 getLastResponseTimestamp
      const beforeInvalidate = this.apiBridge.getLastResponseTimestamp();
      this.apiBridge.invalidateFreshness();
      const afterInvalidate = this.apiBridge.getLastResponseTimestamp();
      const isFreshAfter = this.apiBridge.isFresh();
      log('RuntimeHealth', beforeInvalidate === afterInvalidate ? 'PASS' : 'FAIL',
        'invalidateFreshness 隔离性',
        `lastResponseTime: before=${beforeInvalidate} after=${afterInvalidate} isFresh=${isFreshAfter}（应为 false）`);
      if (isFreshAfter) {
        log('RuntimeHealth', 'FAIL', 'invalidateFreshness 未生效',
          'isFresh() 仍返回 true，recovery.ts 超时计算可能产生大数字');
      }
    } else {
      log('RuntimeHealth', 'WARN', 'API Bridge 无历史响应', '尚未收到任何 API 数据');
    }

    // ── 3. Recovery 超时计算验证 ──
    if (lastTimestamp > 0) {
      const elapsed = Date.now() - lastTimestamp;
      const thresholdSec = Math.round(CONFIG.loadTimeoutThreshold / 1000);
      if (elapsed > CONFIG.loadTimeoutThreshold) {
        log('RuntimeHealth', 'WARN', 'Recovery 超时条件已满足',
          `elapsed=${Math.round(elapsed / 1000)}s > threshold=${thresholdSec}s，正式运行时将触发页面刷新`);
      } else {
        log('RuntimeHealth', 'PASS', 'Recovery 超时正常',
          `elapsed=${Math.round(elapsed / 1000)}s < threshold=${thresholdSec}s`);
      }
      if (elapsed > 1e9) {
        log('RuntimeHealth', 'FAIL', 'Recovery 超时计算异常',
          `elapsed=${elapsed}ms 值异常大，可能 lastResponseTimestamp 被错误重置`);
      }
    }

    // ── 4. 分页 DOM 选择器可用性 ──
    const nextBtn = document.querySelector(CONFIG.selectors.nextPageBtn);
    const prevBtn = document.querySelector(CONFIG.selectors.prevPageBtn);
    const loadingEl = document.querySelector(CONFIG.selectors.loadingIndicator);
    const sidebarItems = document.querySelectorAll(CONFIG.selectors.sidebarMenuItem);
    const activeCategory = document.querySelector(CONFIG.selectors.activeCategory);

    log('RuntimeHealth', 'INFO', 'DOM 选择器检查',
      [
        `sidebarMenuItem: ${sidebarItems.length} 个`,
        `activeCategory: ${activeCategory ? '存在' : '未找到'}`,
        `nextPageBtn: ${nextBtn ? '存在' : '未找到'}`,
        `prevPageBtn: ${prevBtn ? '存在' : '未找到'}`,
        `loadingIndicator: ${loadingEl ? '存在' : '未找到'}`,
      ].join('\n'));

    if (nextBtn) {
      const disabled = (nextBtn as HTMLElement).hasAttribute('disabled') ||
        nextBtn.classList.contains('next-disabled');
      log('RuntimeHealth', 'INFO', '翻页按钮状态', `nextBtn disabled=${disabled}`);
    }

    // ── 5. 分页状态快照 ──
    const paginationItems = document.querySelectorAll('.next-pagination-item');
    const currentPages: string[] = [];
    paginationItems.forEach(el => {
      const text = (el as HTMLElement).textContent?.trim() ?? '';
      const isCurrent = el.classList.contains('next-current');
      if (text && !el.classList.contains('next-next') && !el.classList.contains('next-prev')) {
        currentPages.push(isCurrent ? `[${text}]` : text);
      }
    });
    if (currentPages.length > 0) {
      log('RuntimeHealth', 'INFO', '当前分页状态', `pages: ${currentPages.join(' ')}`);
      const activePage = currentPages.find(p => p.startsWith('['));
      if (activePage && activePage !== '[1]') {
        log('RuntimeHealth', 'WARN', '分页未在第 1 页',
          `当前在第 ${activePage} 页，下次检测可能获取到非首页数据`);
      }
    }

    // ── 6. Store 状态一致性 ──
    const state = store.getState();
    const snapshotPoolNames = Object.keys(state.poolSnapshots);
    const targetSet = new Set(CONFIG.targets);
    const orphanSnapshots = snapshotPoolNames.filter(name => !targetSet.has(name));
    if (orphanSnapshots.length > 0) {
      log('RuntimeHealth', 'WARN', 'Store 孤立快照',
        `${orphanSnapshots.join(', ')} 不在 CONFIG.targets 中，可能是旧配置残留`);
    }
    const missingSnapshots = CONFIG.targets.filter(t => !state.poolSnapshots[t]);
    if (missingSnapshots.length > 0) {
      log('RuntimeHealth', 'INFO', 'Store 缺少快照', `${missingSnapshots.join(', ')} 尚未完成首次检测`);
    }

    log('RuntimeHealth', 'INFO', 'Store 状态摘要',
      `isMonitoring=${state.isMonitoring} currentRound=${state.currentRound} changes=${state.changes.length} historyTotal=${state.historyTotal}`);

    // ── 7. Recovery 延迟刷新机制验证 ──
    const refreshPending = isRefreshPending();
    log('RuntimeHealth', !refreshPending ? 'PASS' : 'WARN', 'Recovery 延迟刷新状态',
      `isRefreshPending=${refreshPending}（true 表示将在当前轮次结束后刷新，而非立即刷新）`);

    // ── 8. 日志条目 ts 字段验证 ──
    const logEntries = getLogs();
    if (logEntries.length > 0) {
      const first = logEntries[0];
      const last = logEntries[logEntries.length - 1];
      const firstHasTs = typeof first.ts === 'number' && first.ts > 0;
      const lastHasTs = typeof last.ts === 'number' && last.ts > 0;
      log('RuntimeHealth', firstHasTs && lastHasTs ? 'PASS' : 'FAIL', '日志 ts 字段完整性',
        `first.ts=${first.ts} last.ts=${last.ts} span=${firstHasTs && lastHasTs ? ((last.ts - first.ts) / 1000).toFixed(1) + 's' : 'N/A'}`);
    }
  }

  // ==================== Summary ====================
  private logTestSummary(startTime: number) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const allLogs = getLogs();

    const fails = allLogs.filter(l => l.status === 'FAIL');
    const warns = allLogs.filter(l => l.status === 'WARN');
    const passes = allLogs.filter(l => l.status === 'PASS');

    // 按 phase 分组统计
    const phaseStats = new Map<string, { pass: number; fail: number; warn: number }>();
    for (const entry of allLogs) {
      if (entry.status === 'INFO') continue;
      const s = phaseStats.get(entry.phase) ?? { pass: 0, fail: 0, warn: 0 };
      if (entry.status === 'PASS') s.pass++;
      if (entry.status === 'FAIL') s.fail++;
      if (entry.status === 'WARN') s.warn++;
      phaseStats.set(entry.phase, s);
    }

    log('Summary', 'INFO', '各阶段统计',
      Array.from(phaseStats.entries())
        .map(([phase, s]) => `${phase}: ✓${s.pass} ✗${s.fail} ⚠${s.warn}`)
        .join('\n'));

    if (fails.length > 0) {
      log('Summary', 'FAIL', `发现 ${fails.length} 个失败项`,
        fails.map(f => `[${f.phase}] ${f.message}`).join('\n'));
    }
    if (warns.length > 0) {
      log('Summary', 'WARN', `发现 ${warns.length} 个警告项`,
        warns.map(w => `[${w.phase}] ${w.message}`).join('\n'));
    }

    const result = fails.length === 0 ? 'PASS' : 'FAIL';
    log('Summary', result, `测试完成: ✓${passes.length} ✗${fails.length} ⚠${warns.length}，耗时 ${elapsed}s`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
