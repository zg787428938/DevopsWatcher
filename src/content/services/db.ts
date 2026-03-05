// IndexedDB 持久化层：管理历史记录、需求池快照、需求变化、面板位置四类数据
// 数据库版本 2：新增 changes store 用于需求变化持久化

import { CONFIG } from '../../config';
import type { HistoryRecord, PoolSnapshot, PoolChange, Position } from '../../types';

const DB_NAME = 'devops-watcher';
const DB_VERSION = 2;

let database: IDBDatabase | null = null;

// 打开数据库连接（单例模式），首次打开时自动创建三个 object store
function open(): Promise<IDBDatabase> {
  if (database) return Promise.resolve(database);

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('history')) {
        const store = db.createObjectStore('history', { keyPath: 'id', autoIncrement: true });
        store.createIndex('timestamp', 'timestamp');
      }
      if (!db.objectStoreNames.contains('snapshots')) {
        db.createObjectStore('snapshots', { keyPath: 'poolName' });
      }
      if (!db.objectStoreNames.contains('positions')) {
        db.createObjectStore('positions', { keyPath: 'type' });
      }
      // v2: 需求变化持久化，自增 id + timestamp/poolName 索引
      if (!db.objectStoreNames.contains('changes')) {
        const changesStore = db.createObjectStore('changes', { keyPath: 'id', autoIncrement: true });
        changesStore.createIndex('timestamp', 'timestamp');
        changesStore.createIndex('poolName', 'poolName');
      }
    };

    req.onsuccess = () => {
      database = req.result;
      resolve(database);
    };
    req.onerror = () => reject(req.error);
  });
}

// 便捷方法：在指定 store 上创建新事务并返回 object store 引用
function tx(storeName: string, mode: IDBTransactionMode = 'readonly'): IDBObjectStore {
  return database!.transaction(storeName, mode).objectStore(storeName);
}

// 将 IDBRequest 包装为 Promise，统一异步处理方式
function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const db = {
  // 初始化数据库连接，必须在使用任何其他方法之前调用
  async init() {
    await open();
  },

  // 按时间倒序获取历史记录，支持分页（offset + limit），用于 UI 列表和无限滚动加载
  async getHistory(offset: number, limit: number): Promise<HistoryRecord[]> {
    const store = tx('history');
    const index = store.index('timestamp');
    const results: HistoryRecord[] = [];

    return new Promise((resolve, reject) => {
      // 使用 prev 方向游标实现倒序遍历
      const cursorReq = index.openCursor(null, 'prev');
      let skipped = 0;

      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor || results.length >= limit) {
          resolve(results);
          return;
        }
        // 跳过 offset 条记录实现分页偏移
        if (skipped < offset) {
          skipped++;
          cursor.continue();
          return;
        }
        results.push(cursor.value);
        cursor.continue();
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    });
  },

  // 获取历史记录总条数，用于 UI 展示和判断是否还有更多数据可加载
  async getHistoryCount(): Promise<number> {
    return request(tx('history').count());
  },

  // 添加历史记录：先 await add 确保写入完成，再检查总数是否超限并删除最旧记录
  async addHistory(record: HistoryRecord): Promise<void> {
    const st = tx('history', 'readwrite');
    const copy = { ...record };
    delete copy.id; // 移除 id 让 IndexedDB 自动生成自增主键
    await request(st.add(copy));

    // 检查是否超过最大保留条数，超出部分从最旧的记录开始删除
    const count = await this.getHistoryCount();
    if (count > CONFIG.maxHistoryRecords) {
      const trimCount = count - CONFIG.maxHistoryRecords;
      const trimStore = tx('history', 'readwrite');
      const index = trimStore.index('timestamp');
      let deleted = 0;
      // 使用 next（正序）游标从最旧记录开始删除
      const cursorReq = index.openCursor(null, 'next');
      await new Promise<void>((resolve) => {
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor || deleted >= trimCount) {
            resolve();
            return;
          }
          cursor.delete();
          deleted++;
          cursor.continue();
        };
      });
    }
  },

  // 获取所有需求池快照，用于 monitor.ts 启动时恢复上次检测状态
  async getAllSnapshots(): Promise<PoolSnapshot[]> {
    return request(tx('snapshots').getAll());
  },

  // 获取指定需求池的快照，用于 detector.ts 比对前获取旧数据
  async getSnapshot(poolName: string): Promise<PoolSnapshot | undefined> {
    return request(tx('snapshots').get(poolName));
  },

  // 保存需求池快照：使用 put 实现 upsert（有则更新，无则插入）
  async saveSnapshot(snapshot: PoolSnapshot): Promise<void> {
    tx('snapshots', 'readwrite').put(snapshot);
  },

  // ── 需求变化 CRUD ──

  // 按时间倒序获取最近的变化记录
  async getRecentChanges(limit: number): Promise<PoolChange[]> {
    const store = tx('changes');
    const index = store.index('timestamp');
    const results: PoolChange[] = [];
    return new Promise((resolve, reject) => {
      const cursorReq = index.openCursor(null, 'prev');
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor || results.length >= limit) { resolve(results); return; }
        results.push(cursor.value);
        cursor.continue();
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    });
  },

  async addChange(change: PoolChange): Promise<void> {
    const st = tx('changes', 'readwrite');
    const copy = { ...change };
    delete copy.id;
    await request(st.add(copy));

    const count = await this.getChangesCount();
    if (count > CONFIG.maxChangesRecords) {
      const trimCount = count - CONFIG.maxChangesRecords;
      const trimStore = tx('changes', 'readwrite');
      const index = trimStore.index('timestamp');
      let deleted = 0;
      const cursorReq = index.openCursor(null, 'next');
      await new Promise<void>((resolve) => {
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor || deleted >= trimCount) { resolve(); return; }
          cursor.delete();
          deleted++;
          cursor.continue();
        };
      });
    }
  },

  async getChangesCount(): Promise<number> {
    return request(tx('changes').count());
  },

  // 删除指定需求池的所有变化记录
  async clearChangesByPool(poolName: string): Promise<void> {
    const store = tx('changes', 'readwrite');
    const index = store.index('poolName');
    return new Promise((resolve, reject) => {
      const cursorReq = index.openCursor(IDBKeyRange.only(poolName));
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) { resolve(); return; }
        cursor.delete();
        cursor.continue();
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    });
  },

  // 获取面板位置（collapsed 或 expanded），返回 undefined 表示使用默认位置
  async getPosition(type: 'collapsed' | 'expanded'): Promise<Position | undefined> {
    const result = await request(tx('positions').get(type));
    return result ? { x: result.x, y: result.y } : undefined;
  },

  // 保存面板位置到 IndexedDB，关闭页面后再打开能恢复到上次位置
  async savePosition(type: 'collapsed' | 'expanded', pos: Position): Promise<void> {
    tx('positions', 'readwrite').put({ type, x: pos.x, y: pos.y });
  },
};
