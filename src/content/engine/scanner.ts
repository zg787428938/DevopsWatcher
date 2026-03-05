import { CONFIG } from '../../config';

interface CachedCoordinate {
  element: HTMLElement;
  timestamp: number;
}

const coordinateCache = new Map<string, CachedCoordinate>();

// 按长度降序排列的 targets 副本，确保更具体的名称（如 "iOS 需求池"）优先于通用名称（如 "需求池"）匹配
const targetsBySpecificity = [...CONFIG.targets].sort((a, b) => b.length - a.length);

export class Scanner {
  findMenuItem(poolName: string): HTMLElement | null {
    const cached = coordinateCache.get(poolName);
    if (cached && Date.now() - cached.timestamp < CONFIG.coordinateCacheTTL) {
      if (document.contains(cached.element)) {
        return cached.element;
      }
      coordinateCache.delete(poolName);
    }

    const items = document.querySelectorAll(CONFIG.selectors.sidebarMenuItem);

    // 优先精确匹配
    for (const item of items) {
      const text = (item as HTMLElement).textContent?.trim() ?? '';
      if (text === poolName) {
        const el = item as HTMLElement;
        coordinateCache.set(poolName, { element: el, timestamp: Date.now() });
        return el;
      }
    }

    // 回退到子串匹配，但排除那些能被更具体 target 匹配的菜单项
    for (const item of items) {
      const text = (item as HTMLElement).textContent?.trim() ?? '';
      if (text.includes(poolName)) {
        const moreSpecific = targetsBySpecificity.find(
          t => t !== poolName && t.length > poolName.length && text.includes(t),
        );
        if (!moreSpecific) {
          const el = item as HTMLElement;
          coordinateCache.set(poolName, { element: el, timestamp: Date.now() });
          return el;
        }
      }
    }

    return null;
  }

  getCurrentPoolName(): string | null {
    const el = document.querySelector(CONFIG.selectors.activeCategory);
    if (!el) return null;

    const text = el.textContent?.trim() ?? '';
    // 按特异性降序匹配，最长的 target 名称优先命中
    for (const target of targetsBySpecificity) {
      if (text.includes(target)) return target;
    }
    return null;
  }

  invalidateCache() {
    coordinateCache.clear();
  }
}
