// 分页数据收集器：当需求池数量超过单页显示上限时，自动模拟点击"下一页"按钮逐页收集
// 每翻一页后复用 waiter 的三段等待策略确保数据加载完成，最终合并所有页的需求名称列表

import { CONFIG } from '../../config';
import { store } from '../../store';
import { simulateClick } from './click';
import type { ApiBridge } from '../services/api-bridge';
import type { Waiter } from './waiter';
import type { ApiResponseData, RequirementItem } from '../../types';

export interface CollectResult {
  requirements: string[];
  items: RequirementItem[];
}

// 从第一页数据出发，自动翻页收集所有需求名称和标识符
export async function collectAllPages(
  apiBridge: ApiBridge,
  waiter: Waiter,
  firstPageData: ApiResponseData,
): Promise<CollectResult> {
  const requirements = firstPageData.result.map((r) => r.subject);
  const items: RequirementItem[] = firstPageData.result.map((r) => ({
    subject: r.subject,
    identifier: r.identifier,
  }));
  const pageSize = firstPageData.pageSize || 100;
  const totalPages = Math.ceil(firstPageData.totalCount / pageSize);
  const maxPages = CONFIG.maxPages > 0 ? Math.min(totalPages, CONFIG.maxPages) : totalPages;

  if (maxPages <= 1) return { requirements, items };

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
      const pageData = await apiBridge.waitForFreshResponse(clickTime, 10_000);
      requirements.push(...pageData.result.map((r) => r.subject));
      items.push(...pageData.result.map((r) => ({
        subject: r.subject,
        identifier: r.identifier,
      })));
    } catch {
      console.warn(`[DevOps Watcher] Failed to get page ${page} data`);
      break;
    }
  }

  return { requirements, items };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
