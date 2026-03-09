// 工作项详情服务：监听 inject.ts 拦截的字段定义和字段值 API 响应
// 将两者合并为结构化的 WorkitemDetail，提供按名称/标识符查询字段值的方法
// 字段定义和字段值可能以任意顺序到达，两者齐全后自动合并并通知等待者

import type {
  WorkitemFieldDef,
  WorkitemFieldValue,
  WorkitemFieldValueItem,
  WorkitemField,
  WorkitemDetail,
} from '../../types';

interface CacheEntry {
  defs: WorkitemFieldDef[] | null;
  values: WorkitemFieldValue[] | null;
  detail: WorkitemDetail | null;
  timestamp: number;
}

interface DetailWaiter {
  resolve: (detail: WorkitemDetail) => void;
  timer: number;
}

const MAX_CACHE_SIZE = 50;

export class WorkitemDetailService {
  private cache = new Map<string, CacheEntry>();
  private waiters = new Map<string, DetailWaiter[]>();

  start() {
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      const { type } = event.data ?? {};
      if (type === 'DEVOPS_WATCHER_FIELD_DEFS') {
        this.handleFieldDefs(event.data.workitemId, event.data.data);
      } else if (type === 'DEVOPS_WATCHER_FIELD_VALUES') {
        this.handleFieldValues(event.data.workitemId, event.data.data);
      }
    });
  }

  private ensureEntry(workitemId: string): CacheEntry {
    let entry = this.cache.get(workitemId);
    if (!entry) {
      entry = { defs: null, values: null, detail: null, timestamp: 0 };
      this.cache.set(workitemId, entry);
      this.evictIfNeeded();
    }
    return entry;
  }

  private evictIfNeeded() {
    if (this.cache.size <= MAX_CACHE_SIZE) return;
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [key, entry] of this.cache) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }
    if (oldestKey) this.cache.delete(oldestKey);
  }

  private handleFieldDefs(workitemId: string, defs: WorkitemFieldDef[]) {
    const entry = this.ensureEntry(workitemId);
    entry.defs = defs;
    entry.timestamp = Date.now();
    this.tryBuildDetail(workitemId);
  }

  private handleFieldValues(workitemId: string, values: WorkitemFieldValue[]) {
    const entry = this.ensureEntry(workitemId);
    entry.values = values;
    entry.timestamp = Date.now();
    this.tryBuildDetail(workitemId);
  }

  private tryBuildDetail(workitemId: string) {
    const entry = this.cache.get(workitemId);
    if (!entry?.defs || !entry?.values) return;

    const defMap = new Map<string, WorkitemFieldDef>();
    for (const def of entry.defs) {
      defMap.set(def.identifier, def);
    }

    const fields: WorkitemField[] = [];
    const fieldMap: Record<string, WorkitemField> = {};

    for (const val of entry.values) {
      const def = defMap.get(val.fieldIdentifier);
      const displayValue = this.resolveDisplayValue(val.valueList, val.value);
      const field: WorkitemField = {
        identifier: val.fieldIdentifier,
        name: def?.name ?? val.fieldIdentifier,
        displayName: def?.displayName ?? def?.name ?? val.fieldIdentifier,
        type: def?.type ?? '',
        format: val.fieldFormat,
        className: val.fieldClassName,
        value: val.value ?? '',
        displayValue,
        valueList: val.valueList ?? [],
        options: def?.options ?? null,
      };
      fields.push(field);
      // fieldMap 支持按 name、displayName、identifier 三种方式查找
      if (!fieldMap[field.identifier]) fieldMap[field.identifier] = field;
      if (!fieldMap[field.name]) fieldMap[field.name] = field;
      if (field.displayName !== field.name && !fieldMap[field.displayName]) {
        fieldMap[field.displayName] = field;
      }
    }

    // 补充只有定义但没有值的字段（值为空）
    for (const def of entry.defs) {
      if (fieldMap[def.identifier]) continue;
      const field: WorkitemField = {
        identifier: def.identifier,
        name: def.name,
        displayName: def.displayName,
        type: def.type,
        format: def.format,
        className: def.className,
        value: '',
        displayValue: '',
        valueList: [],
        options: def.options,
      };
      fields.push(field);
      fieldMap[field.identifier] = field;
      if (!fieldMap[field.name]) fieldMap[field.name] = field;
      if (field.displayName !== field.name && !fieldMap[field.displayName]) {
        fieldMap[field.displayName] = field;
      }
    }

    fields.sort((a, b) => {
      const posA = defMap.get(a.identifier)?.position ?? 999;
      const posB = defMap.get(b.identifier)?.position ?? 999;
      return posA - posB;
    });

    const detail: WorkitemDetail = { workitemId, fields, fieldMap, timestamp: entry.timestamp };
    entry.detail = detail;

    const waiters = this.waiters.get(workitemId);
    if (waiters) {
      for (const w of waiters) {
        clearTimeout(w.timer);
        w.resolve(detail);
      }
      this.waiters.delete(workitemId);
    }
  }

  private resolveDisplayValue(valueList: WorkitemFieldValueItem[] | undefined, fallback: string): string {
    if (!valueList || valueList.length === 0) return fallback ?? '';
    if (valueList.length === 1) return valueList[0].displayValue ?? valueList[0].value ?? fallback;
    return valueList.map((v) => v.displayValue ?? v.value).join(', ');
  }

  /** 获取工作项完整详情，未就绪时返回 null */
  getDetail(workitemId: string): WorkitemDetail | null {
    return this.cache.get(workitemId)?.detail ?? null;
  }

  /** 按字段名称获取单个字段的展示值（支持 name / displayName / identifier） */
  getFieldValue(workitemId: string, fieldName: string): string | null {
    const detail = this.getDetail(workitemId);
    if (!detail) return null;
    const field = detail.fieldMap[fieldName];
    return field?.displayValue ?? null;
  }

  /** 按字段名称获取多值字段的所有展示值 */
  getFieldValues(workitemId: string, fieldName: string): string[] | null {
    const detail = this.getDetail(workitemId);
    if (!detail) return null;
    const field = detail.fieldMap[fieldName];
    if (!field) return null;
    if (field.valueList.length === 0) return field.value ? [field.value] : [];
    return field.valueList.map((v) => v.displayValue ?? v.value);
  }

  /** 获取完整的字段对象 */
  getField(workitemId: string, fieldName: string): WorkitemField | null {
    const detail = this.getDetail(workitemId);
    if (!detail) return null;
    return detail.fieldMap[fieldName] ?? null;
  }

  /** 是否已有完整详情数据 */
  hasDetail(workitemId: string): boolean {
    return this.cache.get(workitemId)?.detail != null;
  }

  /** 等待工作项详情就绪（字段定义和字段值均到达后 resolve） */
  waitForDetail(workitemId: string, timeoutMs = 15000): Promise<WorkitemDetail> {
    const existing = this.getDetail(workitemId);
    if (existing) return Promise.resolve(existing);

    return new Promise<WorkitemDetail>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        const list = this.waiters.get(workitemId);
        if (list) {
          this.waiters.set(workitemId, list.filter((w) => w !== waiter));
        }
        reject(new Error(`Workitem detail timeout: ${workitemId}`));
      }, timeoutMs);

      const waiter: DetailWaiter = { resolve, timer };
      const list = this.waiters.get(workitemId);
      if (list) {
        list.push(waiter);
      } else {
        this.waiters.set(workitemId, [waiter]);
      }
    });
  }

  /** 通过 inject.js 主动发起字段 API 请求（GET 同源，浏览器自动携带 cookie） */
  requestDetail(workitemId: string): void {
    window.postMessage({ type: 'DEVOPS_WATCHER_FETCH_DETAIL', workitemId }, '*');
  }

  /** 主动获取工作项详情：发起请求 + 等待结果 */
  async fetchDetail(workitemId: string, timeoutMs = 15000): Promise<WorkitemDetail> {
    const existing = this.getDetail(workitemId);
    if (existing) return existing;
    this.requestDetail(workitemId);
    return this.waitForDetail(workitemId, timeoutMs);
  }

  /** 清除指定工作项的缓存 */
  clearDetail(workitemId: string): void {
    this.cache.delete(workitemId);
  }

  /** 获取所有已缓存且完整的工作项 ID */
  getCachedIds(): string[] {
    const ids: string[] = [];
    for (const [id, entry] of this.cache) {
      if (entry.detail) ids.push(id);
    }
    return ids;
  }
}
