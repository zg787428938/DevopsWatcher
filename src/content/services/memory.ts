// 内存监控服务：定期轮询 Chrome 专有的 performance.memory API 并更新 store
// 数据用于状态栏展示（正常/偏高/危险三色）和 recovery.ts 的内存超限刷新判断
// 注意：performance.memory 仅在 Chromium 内核浏览器中可用，其他浏览器静默跳过

import { CONFIG } from '../../config';
import { store } from '../../store';

interface PerformanceMemory {
  usedJSHeapSize: number; // 当前已使用的 JS 堆大小（字节）
  totalJSHeapSize: number; // 当前分配给 JS 堆的总大小（字节）
  jsHeapSizeLimit: number; // JS 堆的最大可用大小（字节）
}

// 启动内存监控：立即执行一次检测，然后按 memoryCheckInterval（默认 2秒）周期轮询
export function startMemoryMonitor(): void {
  const perf = performance as any;
  if (!perf.memory) return; // 非 Chromium 浏览器无此 API，静默退出

  const check = () => {
    const mem: PerformanceMemory = perf.memory;
    const usedMB = Math.round(mem.usedJSHeapSize / 1048576);
    const limitMB = Math.round(mem.jsHeapSizeLimit / 1048576);
    const percent = Math.round((mem.usedJSHeapSize / mem.jsHeapSizeLimit) * 100);

    store.setState({
      memoryUsage: { usedMB, limitMB, percent },
    });
  };

  check();
  setInterval(check, CONFIG.memoryCheckInterval);
}
