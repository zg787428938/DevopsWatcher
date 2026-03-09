// 监控引擎核心编排器：协调所有子模块完成需求池检测的完整生命周期
// 每轮检测中，所有操作（各池首页点击 + 翻页）被均匀分布在倒计时周期内
// 上一轮快照的 totalCount 用于预估本轮各池页数，动态构建操作列表

import { CONFIG, formatTimestamp } from '../../config';
import { store } from '../../store';
import { ApiBridge } from '../services/api-bridge';
import { CountdownService } from '../services/countdown';
import { sendNotification, playBeep } from '../services/notification';
import { db } from '../services/db';
import { startMemoryMonitor } from '../services/memory';
import { log, initLogger, formatApiData, formatChange } from '../services/logger';
import { Scanner } from './scanner';
import { Waiter } from './waiter';
import { detectChanges } from './detector';
import { startRecovery, stopRecovery, isRefreshPending, safeRefresh } from './recovery';
import { simulateClick } from './click';
import type { PoolSnapshot, HistoryRecord, ApiResponseData } from '../../types';

interface PoolPageState {
  requirements: string[];
  totalCount: number;
  totalPages: number;
  pagesCollected: number;
}

export class Monitor {
  private apiBridge: ApiBridge;
  private countdown: CountdownService;
  private scanner: Scanner;
  private waiter: Waiter;
  private initialized = false;
  private estimatedPages: number[] = [];
  // 跨多个调度操作维护每池的翻页收集状态
  private poolStates = new Map<number, PoolPageState>();
  // 初始收集时已采集的池索引，首轮倒计时跳过该池
  private initialPoolIndex: number | null = null;

  constructor(apiBridge: ApiBridge) {
    this.apiBridge = apiBridge;
    this.scanner = new Scanner();
    this.waiter = new Waiter(this.apiBridge);
    this.countdown = new CountdownService(
      (poolIdx, pageIdx) => this.handleOperation(poolIdx, pageIdx),
      () => this.onRoundComplete(),
    );
  }

  async start() {
    if (this.initialized) return;
    this.initialized = true;

    store.setState({ isMonitoring: true, status: '正在初始化...', statusType: 'normal' });

    await db.init();
    await initLogger();

    log('Monitor', 'INFO', '监控启动', `URL=${location.href}`);
    log('Monitor', 'INFO', '环境', `targets=${CONFIG.targets.join(',')} interval=${CONFIG.minInterval}-${CONFIG.maxInterval}s`);

    const [history, snapshots, changes, collapsedPos, expandedPos] = await Promise.all([
      db.getHistory(0, CONFIG.historyPageSize),
      db.getAllSnapshots(),
      db.getRecentChanges(CONFIG.maxChangesRecords),
      db.getPosition('collapsed'),
      db.getPosition('expanded'),
    ]);

    const targetSet = new Set(CONFIG.targets);
    const snapshotMap: Record<string, PoolSnapshot> = {};
    for (const s of snapshots) {
      if (targetSet.has(s.poolName)) {
        snapshotMap[s.poolName] = s;
      }
    }

    const activeChanges = changes.filter(c => targetSet.has(c.poolName));

    const historyTotal = await db.getHistoryCount();
    const changesCount = await db.getChangesCount();
    log('Monitor', 'INFO', 'IndexedDB 已加载', `history=${historyTotal} snapshots=${snapshots.length} changes=${changesCount}`);

    store.setState({
      history,
      historyTotal,
      poolSnapshots: snapshotMap,
      changes: activeChanges,
      ...(collapsedPos ? { collapsedPos } : {}),
      ...(expandedPos ? { expandedPos } : {}),
    });

    startMemoryMonitor();
    startRecovery(this.apiBridge);

    await this.initialCollect();
    this.startNextRound(true);
  }

  private async initialCollect() {
    store.setState({ status: '等待页面初始数据...', statusType: 'normal' });
    log('InitialCollect', 'INFO', '等待页面初始 API 响应...');

    let initialData: ApiResponseData | null = null;
    try {
      initialData = await this.apiBridge.waitForFreshResponse(0, 30_000);
      log('InitialCollect', 'PASS', '收到初始 API 响应', formatApiData(initialData));
    } catch {
      log('InitialCollect', 'WARN', '初始数据获取超时 (30s)');
      store.setState({ status: '初始数据获取超时，开始常规检测', statusType: 'warning' });
      return;
    }

    await sleep(CONFIG.clickRenderDelay);

    const currentPool = this.scanner.getCurrentPoolName();
    if (currentPool) {
      const idx = CONFIG.targets.indexOf(currentPool);
      log('InitialCollect', 'INFO', `当前页面在目标池 "${currentPool}" (index=${idx}) 上，提取数据`);
      store.setState({ status: `初始化: 提取 ${currentPool} 数据...`, statusType: 'normal' });

      const pageSize = initialData.pageSize || 100;
      const totalPages = Math.ceil(initialData.totalCount / pageSize);

      if (totalPages > 1) {
        // 多页池：当前只有第 1 页数据，保存部分快照会导致误判变化
        // 跳过快照保存，由后续轮次完整翻页后再比对
        log('InitialCollect', 'INFO', `"${currentPool}" 有 ${totalPages} 页，跳过部分快照保存`);
      } else {
        // 单页池：数据完整，直接保存为基准快照（不做变化检测，避免刷新后误报）
        const requirements = initialData.result.map(r => r.subject);
        const snapshot: PoolSnapshot = { poolName: currentPool, totalCount: initialData.totalCount, requirements };
        store.updatePoolSnapshot(currentPool, snapshot);
        await db.saveSnapshot(snapshot);
        log('InitialCollect', 'PASS', `"${currentPool}" 初始快照已保存`);
      }

      if (idx !== -1) this.initialPoolIndex = idx;
    } else {
      log('InitialCollect', 'INFO', '当前页面不在任何目标池上，由倒计时轮询处理');
    }

    log('InitialCollect', 'PASS', '初始收集完成');
    store.setState({ status: '初始收集完成，进入常规监控', statusType: 'normal' });
  }

  private startNextRound(isFirstRound = false) {
    const snapshots = store.getState().poolSnapshots;
    this.estimatedPages = CONFIG.targets.map(target => {
      const snap = snapshots[target];
      if (!snap) return 1;
      const pages = Math.ceil(snap.totalCount / 100);
      return CONFIG.maxPages > 0 ? Math.min(Math.max(1, pages), CONFIG.maxPages) : Math.max(1, pages);
    });
    this.poolStates.clear();

    // 首轮跳过初始收集时已采集的池，避免重复点击
    const skipIndices = isFirstRound && this.initialPoolIndex !== null
      ? new Set([this.initialPoolIndex])
      : undefined;
    this.initialPoolIndex = null;

    const pageSummary = CONFIG.targets.map((t, i) => `${t}:${this.estimatedPages[i]}p`).join(' ');
    const skipInfo = skipIndices ? ` skip=[${[...skipIndices].map(i => CONFIG.targets[i]).join(',')}]` : '';
    log('Round', 'INFO', '开始新一轮', `estimatedPages=[${pageSummary}]${skipInfo}`);

    this.countdown.startRound(this.estimatedPages, skipIndices);
  }

  pause() {
    log('Monitor', 'INFO', '监控已暂停');
    store.setState({ isMonitoring: false, status: '监控已暂停', statusType: 'warning' });
  }

  resume() {
    log('Monitor', 'INFO', '监控已恢复');
    store.setState({ isMonitoring: true, status: '监控已恢复', statusType: 'normal' });
  }

  stop() {
    log('Monitor', 'INFO', '监控已停止');
    this.countdown.stop();
    stopRecovery();
    this.initialized = false;
  }

  // ── 操作调度入口 ──

  private async handleOperation(poolIndex: number, pageIndex: number) {
    if (!store.getState().isMonitoring) return;

    if (pageIndex === 0) {
      await this.handleFirstPage(poolIndex);
    } else {
      await this.handleSubsequentPage(poolIndex, pageIndex);
    }
  }

  // ── 首页：点击菜单 → 等待 → 获取 API 数据 ──

  private async handleFirstPage(poolIndex: number) {
    const poolName = CONFIG.targets[poolIndex];
    log('CheckPool', 'INFO', `开始检测 "${poolName}"`);
    store.setState({ status: `正在检测 ${poolName}...`, statusType: 'normal' });

    try {
      const menuItem = this.scanner.findMenuItem(poolName);
      if (!menuItem) {
        log('CheckPool', 'FAIL', `未找到 "${poolName}" 菜单项`);
        store.setState({ status: `未找到 ${poolName} 菜单项`, statusType: 'warning' });
        return;
      }

      let apiData: ApiResponseData | undefined;
      for (let attempt = 0; attempt <= CONFIG.apiWaitMaxRetries; attempt++) {
        this.apiBridge.invalidateFreshness();
        const clickTime = Date.now();
        simulateClick(menuItem);
        await sleep(CONFIG.clickRenderDelay);
        await this.waiter.waitForContentReady();

        try {
          apiData = await this.apiBridge.waitForFreshResponse(clickTime, 15_000);
          log('CheckPool', 'PASS', `"${poolName}" API 响应成功`, formatApiData(apiData));
          break;
        } catch {
          if (attempt < CONFIG.apiWaitMaxRetries) {
            log('CheckPool', 'WARN', `"${poolName}" API 超时，重试 ${attempt + 1}/${CONFIG.apiWaitMaxRetries}`);
            store.setState({
              status: `${poolName}: API 超时，第 ${attempt + 1} 次重试...`,
              statusType: 'warning',
            });
            await sleep(CONFIG.apiWaitRetryInterval);
          } else {
            log('CheckPool', 'FAIL', `"${poolName}" API 超时，已重试 ${CONFIG.apiWaitMaxRetries} 次`);
            store.setState({ status: `${poolName}: API 超时`, statusType: 'error' });
            return;
          }
        }
      }

      if (!apiData) return;

      // 分页残留修复：上一轮翻页后页面保留了分页状态，点击菜单可能返回非第 1 页数据
      if (apiData.toPage > 1) {
        log('CheckPool', 'WARN', `"${poolName}" 收到第 ${apiData.toPage} 页数据，回退到第 1 页`);
        const resetData = await this.resetPagination(poolName);
        if (resetData) {
          apiData = resetData;
          log('CheckPool', 'PASS', `"${poolName}" 已回退到第 1 页`, formatApiData(apiData));
        } else {
          log('CheckPool', 'FAIL', `"${poolName}" 回退到第 1 页失败，跳过本轮`);
          return;
        }
      }

      const pageSize = apiData.pageSize || 100;
      const rawPages = Math.ceil(apiData.totalCount / pageSize);
      const totalPages = CONFIG.maxPages > 0 ? Math.min(rawPages, CONFIG.maxPages) : rawPages;
      const requirements = apiData.result.map(r => r.subject);

      if (totalPages <= 1) {
        await this.finalizePool(poolName, apiData.totalCount, requirements);
      } else {
        this.poolStates.set(poolIndex, {
          requirements,
          totalCount: apiData.totalCount,
          totalPages,
          pagesCollected: 1,
        });
        log('CheckPool', 'INFO', `"${poolName}" 需要翻页`, `totalPages=${totalPages} estimated=${this.estimatedPages[poolIndex]}`);

        // 预估只有 1 页但实际有多页 → 补充翻页
        if ((this.estimatedPages[poolIndex] || 1) <= 1) {
          await this.collectRemainingPages(poolIndex);
        }
      }
    } catch (error) {
      log('CheckPool', 'FAIL', `"${poolName}" 检测异常`, (error as Error).message);
      console.error(`[DevOps Watcher] Check pool ${poolName} failed:`, error);
      store.setState({
        status: `${poolName} 检测失败: ${(error as Error).message}`,
        statusType: 'warning',
      });
    }
  }

  // ── 后续页：点击翻页按钮 → 等待 → 获取分页数据 ──

  private async handleSubsequentPage(poolIndex: number, pageIndex: number) {
    const poolName = CONFIG.targets[poolIndex];
    const state = this.poolStates.get(poolIndex);

    if (!state || state.pagesCollected >= state.totalPages) {
      return;
    }

    const page = state.pagesCollected + 1;
    log('CheckPool', 'INFO', `"${poolName}" 翻页 ${page}/${state.totalPages}`);
    store.setState({ status: `${poolName} 翻页 (${page}/${state.totalPages})...` });

    const nextBtn = document.querySelector(CONFIG.selectors.nextPageBtn) as HTMLElement | null;
    if (!nextBtn || nextBtn.hasAttribute('disabled') || nextBtn.classList.contains('next-disabled')) {
      log('CheckPool', 'WARN', `"${poolName}" 翻页按钮不可用，提前结束`);
      await this.finalizePool(poolName, state.totalCount, state.requirements);
      this.poolStates.delete(poolIndex);
      return;
    }

    this.apiBridge.invalidateFreshness();
    const clickTime = Date.now();
    simulateClick(nextBtn);
    await sleep(CONFIG.clickRenderDelay);
    await this.waiter.waitForContentReady();

    try {
      const pageData = await this.apiBridge.waitForFreshResponse(clickTime, 10_000);
      state.requirements.push(...pageData.result.map(r => r.subject));
      state.pagesCollected++;
      log('CheckPool', 'PASS', `"${poolName}" 翻页 ${page} 完成`, `collected=${state.requirements.length}`);
    } catch {
      log('CheckPool', 'WARN', `"${poolName}" 翻页 ${page} 失败，提前结束`);
      await this.finalizePool(poolName, state.totalCount, state.requirements);
      this.poolStates.delete(poolIndex);
      return;
    }

    const isLastScheduled = (pageIndex + 1) >= (this.estimatedPages[poolIndex] || 1);

    if (state.pagesCollected >= state.totalPages) {
      await this.finalizePool(poolName, state.totalCount, state.requirements);
      this.poolStates.delete(poolIndex);
    } else if (isLastScheduled) {
      // 实际页数 > 预估页数，补充翻页（使用 paginationDelay 间隔）
      await this.collectRemainingPages(poolIndex);
    }
  }

  // ── 补充翻页：实际页数超过预估时的回退逻辑 ──

  private async collectRemainingPages(poolIndex: number) {
    const poolName = CONFIG.targets[poolIndex];
    const state = this.poolStates.get(poolIndex);
    if (!state) return;

    log('CheckPool', 'INFO', `"${poolName}" 补充翻页`, `remaining=${state.totalPages - state.pagesCollected}`);

    while (state.pagesCollected < state.totalPages) {
      const delay = CONFIG.paginationDelayMin +
        Math.random() * (CONFIG.paginationDelayMax - CONFIG.paginationDelayMin);
      store.setState({ status: `${poolName} 等待翻页... ${Math.ceil(delay / 1000)}s` });
      await sleep(delay);

      const nextBtn = document.querySelector(CONFIG.selectors.nextPageBtn) as HTMLElement | null;
      if (!nextBtn || nextBtn.hasAttribute('disabled') || nextBtn.classList.contains('next-disabled')) {
        break;
      }

      const page = state.pagesCollected + 1;
      store.setState({ status: `${poolName} 补充翻页 (${page}/${state.totalPages})...` });

      this.apiBridge.invalidateFreshness();
      const clickTime = Date.now();
      simulateClick(nextBtn);
      await sleep(CONFIG.clickRenderDelay);
      await this.waiter.waitForContentReady();

      try {
        const pageData = await this.apiBridge.waitForFreshResponse(clickTime, 10_000);
        state.requirements.push(...pageData.result.map(r => r.subject));
        state.pagesCollected++;
        log('CheckPool', 'PASS', `"${poolName}" 补充翻页 ${page} 完成`, `collected=${state.requirements.length}`);
      } catch {
        log('CheckPool', 'WARN', `"${poolName}" 补充翻页 ${page} 失败`);
        break;
      }
    }

    await this.finalizePool(poolName, state.totalCount, state.requirements);
    this.poolStates.delete(poolIndex);
  }

  // ── 分页回退：页面分页状态残留时回退到第 1 页 ──

  private async resetPagination(poolName: string): Promise<ApiResponseData | null> {
    // 优先查找分页列表中的"1"按钮（直接跳转第 1 页）
    const pagItems = document.querySelectorAll('.next-pagination-item');
    let targetBtn: HTMLElement | null = null;

    for (const item of pagItems) {
      const el = item as HTMLElement;
      const text = el.textContent?.trim();
      if (text === '1' && !el.classList.contains('next-next') && !el.classList.contains('next-prev')) {
        targetBtn = el;
        break;
      }
    }

    // 回退：使用"上一页"按钮
    if (!targetBtn) {
      targetBtn = document.querySelector(CONFIG.selectors.prevPageBtn) as HTMLElement | null;
    }

    if (!targetBtn) {
      log('CheckPool', 'WARN', `"${poolName}" 未找到分页回退按钮`);
      return null;
    }

    this.apiBridge.invalidateFreshness();
    const clickTime = Date.now();
    simulateClick(targetBtn);
    await sleep(CONFIG.clickRenderDelay);
    await this.waiter.waitForContentReady();

    try {
      const data = await this.apiBridge.waitForFreshResponse(clickTime, 10_000);
      if (data.toPage !== 1) {
        log('CheckPool', 'WARN', `"${poolName}" 回退后仍在第 ${data.toPage} 页`);
      }
      return data;
    } catch {
      return null;
    }
  }

  // ── 最终处理：快照比对 → 持久化 → 通知 ──

  private async finalizePool(poolName: string, totalCount: number, requirements: string[]) {
    // 去重：翻页期间数据变动可能导致同一需求出现在多页中
    const uniqueReqs = [...new Set(requirements)];
    if (uniqueReqs.length < requirements.length) {
      log('CheckPool', 'WARN', `"${poolName}" 翻页数据重复`,
        `collected=${requirements.length} unique=${uniqueReqs.length} duplicates=${requirements.length - uniqueReqs.length}`);
      requirements = uniqueReqs;
    }

    // 翻页数据完整性校验：collected !== totalCount 说明翻页期间后端数据发生了变化
    // 此时快照不可靠，跳过变化检测，保留上一轮的完整快照，等下一轮重新收集
    if (requirements.length !== totalCount) {
      log('CheckPool', 'WARN', `"${poolName}" 翻页数据不完整，跳过变化检测`,
        `collected=${requirements.length} totalCount=${totalCount}，保留上一轮快照`);
      store.setState({ status: `${poolName} 数据不一致，等待下轮`, statusType: 'warning' });
      return;
    }

    const newSnapshot: PoolSnapshot = { poolName, totalCount, requirements };
    const oldSnapshot = store.getState().poolSnapshots[poolName] ?? null;
    const change = detectChanges(oldSnapshot, newSnapshot);

    store.updatePoolSnapshot(poolName, newSnapshot);
    await db.saveSnapshot(newSnapshot);

    if (change) {
      log('CheckPool', 'WARN', `"${poolName}" 检测到变化`, formatChange(change));
      store.addChange(change);
      db.addChange(change).catch(() => {});
      await sendNotification(change);
      if (CONFIG.soundEnabled) playBeep();
    } else {
      log('CheckPool', 'PASS', `"${poolName}" 无变化`, `totalCount=${totalCount} requirements=${requirements.length}`);
    }

    store.setState({ status: `${poolName} 检测完成`, statusType: 'normal' });
  }

  // ── 轮次完成回调 ──

  private onRoundComplete() {
    const now = new Date();
    const pools: Record<string, number> = {};
    const snapshots = store.getState().poolSnapshots;

    for (const target of CONFIG.targets) {
      const snap = snapshots[target];
      if (snap) pools[target] = snap.totalCount;
    }

    if (Object.keys(pools).length > 0) {
      const record: HistoryRecord = {
        timestamp: now.getTime(),
        timeStr: formatTimestamp(now.getTime()),
        pools,
      };

      const poolSummary = Object.entries(pools).map(([k, v]) => `${k}:${v}`).join(' ');
      const mem = store.getState().memoryUsage;
      const memInfo = mem ? ` | memory=${mem.usedMB}MB(${mem.percent}%)` : '';
      log('Round', 'PASS', `第 ${store.getState().currentRound} 轮完成`, poolSummary + memInfo);

      store.addHistoryRecord(record);
      db.addHistory(record).catch(() => {});
    }

    if (isRefreshPending()) {
      log('Recovery', 'INFO', '当前轮次已完成，执行延迟刷新');
      safeRefresh();
      return;
    }

    this.startNextRound();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
