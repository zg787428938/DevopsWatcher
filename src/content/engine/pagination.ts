// 分页数据收集器：当需求池数量超过单页显示上限时，自动模拟点击"下一页"按钮逐页收集
// 每翻一页后复用 waiter 的三段等待策略确保数据加载完成，最终合并所有页的需求名称列表

import { CONFIG } from '../../config';
import { store } from '../../store';
import { simulateClick } from './click';
import type { ApiBridge } from '../services/api-bridge';
import type { Waiter } from './waiter';
import type { ApiResponseData } from '../../types';

// 从第一页数据出发，自动翻页收集所有需求名称，返回合并后的完整列表
export async function collectAllPages(
  apiBridge: ApiBridge,
  waiter: Waiter,
  firstPageData: ApiResponseData,
): Promise<string[]> {
  // 第一页数据已由调用方获取，直接提取需求名称
  const allRequirements = firstPageData.result.map((r) => r.subject);
  const pageSize = firstPageData.pageSize || 100;
  const totalPages = Math.ceil(firstPageData.totalCount / pageSize);
  // 限制最大翻页数（默认 10），0 表示不限制
  const maxPages = CONFIG.maxPages > 0 ? Math.min(totalPages, CONFIG.maxPages) : totalPages;

  if (maxPages <= 1) return allRequirements;

  for (let page = 2; page <= maxPages; page++) {
    const delay = CONFIG.paginationDelayMin +
      Math.random() * (CONFIG.paginationDelayMax - CONFIG.paginationDelayMin);
    store.setState({
      status: `等待翻页 (${page}/${maxPages})... ${Math.ceil(delay / 1000)}s`,
    });
    await sleep(delay);

    const nextBtn = document.querySelector(CONFIG.selectors.nextPageBtn) as HTMLElement | null;
    if (!nextBtn || nextBtn.hasAttribute('disabled') || nextBtn.classList.contains('next-disabled')) {
      break;
    }

    store.setState({
      status: `正在翻页 (${page}/${maxPages})...`,
    });

    const clickTime = Date.now();
    simulateClick(nextBtn);

    await sleep(CONFIG.clickRenderDelay);
    await waiter.waitForContentReady();

    try {
      // 等待 clickTime 之后到达的新鲜 API 响应，确保获取的是当前页的数据
      const pageData = await apiBridge.waitForFreshResponse(clickTime, 10_000);
      allRequirements.push(...pageData.result.map((r) => r.subject));
    } catch {
      console.warn(`[DevOps Watcher] Failed to get page ${page} data`);
      break; // 某一页获取失败时停止翻页，返回已收集到的部分数据
    }
  }

  return allRequirements;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
