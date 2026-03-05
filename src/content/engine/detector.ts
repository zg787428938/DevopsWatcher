// 快照比对器：对比同一需求池前后两次检测的快照，找出新增和移除的需求
// 核心逻辑：精确字符串全匹配，若需求名称被修改则识别为"旧名移除 + 新名新增"

import type { PoolChange, PoolSnapshot } from '../../types';

// 对比新旧快照，返回 PoolChange（有变化时）或 null（无变化或首次检测时）
// oldSnapshot 为 null 表示该需求池首次检测：仅保存基准数据不触发通知（PRD 第 3.2 节）
export function detectChanges(
  oldSnapshot: PoolSnapshot | null,
  newSnapshot: PoolSnapshot,
): PoolChange | null {
  // 首次检测该需求池：无旧数据可比对，返回 null 让调用方跳过通知
  if (!oldSnapshot) {
    return null;
  }

  // 使用 Set 进行 O(n) 复杂度的差集运算
  const oldSet = new Set(oldSnapshot.requirements);
  const newSet = new Set(newSnapshot.requirements);

  // 新快照中有但旧快照中没有的 → 新增需求
  const added = newSnapshot.requirements.filter((r) => !oldSet.has(r));
  // 旧快照中有但新快照中没有的 → 移除需求
  const removed = oldSnapshot.requirements.filter((r) => !newSet.has(r));

  // 数量和名称列表都完全一致时视为无变化
  if (
    oldSnapshot.totalCount === newSnapshot.totalCount &&
    added.length === 0 &&
    removed.length === 0
  ) {
    return null;
  }

  return {
    poolName: newSnapshot.poolName,
    oldCount: oldSnapshot.totalCount,
    newCount: newSnapshot.totalCount,
    added,
    removed,
    timestamp: Date.now(),
  };
}
