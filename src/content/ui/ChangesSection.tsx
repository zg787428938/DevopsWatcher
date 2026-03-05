/**
 * ChangesSection.tsx - 需求变化区块组件，按池分组展示所有变化记录（含时间戳），支持按池清除
 */
import React from 'react';
import { CONFIG, formatTimestamp } from '../../config';
import { store } from '../../store';
import { db } from '../services/db';
import type { PoolChange } from '../../types';

interface Props {
  changes: PoolChange[];
  collapsed: boolean;
  onToggle: () => void;
}

export const ChangesSection: React.FC<Props> = ({ changes, collapsed, onToggle }) => {
  const activeChanges = changes.filter(c => CONFIG.targets.includes(c.poolName));
  const totalChanges = activeChanges.reduce((sum, c) => sum + c.added.length + c.removed.length, 0);

  // 按 poolName 分组，组内保持时间倒序（数组本身已按时间倒序排列）
  const grouped = new Map<string, PoolChange[]>();
  for (const c of activeChanges) {
    if (!grouped.has(c.poolName)) grouped.set(c.poolName, []);
    grouped.get(c.poolName)!.push(c);
  }

  const handleClear = (poolName: string) => {
    store.clearChange(poolName);
    db.clearChangesByPool(poolName).catch(() => {});
  };

  return (
    <div className="dw-section">
      <div className="dw-section-header" onClick={onToggle}>
        <span>
          需求变化
          {totalChanges > 0 && <span className="dw-section-badge">{totalChanges}</span>}
        </span>
        <svg className={`dw-section-arrow${collapsed ? '' : ' open'}`} width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M3.5 2L7 5L3.5 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
      {!collapsed && (
        <div className="dw-section-body" data-no-drag style={{ maxHeight: 300, overflowY: 'auto' }}>
          {grouped.size === 0 ? (
            <div className="dw-no-changes">暂无变化</div>
          ) : (
            Array.from(grouped.entries()).map(([poolName, poolChanges]) => (
              <div key={poolName} className="dw-changes-pool">
                <div className="dw-changes-pool-header">
                  <span className="dw-changes-pool-name">{poolName}</span>
                  <button
                    className="dw-changes-clear"
                    onClick={(e) => { e.stopPropagation(); handleClear(poolName); }}
                  >
                    清除
                  </button>
                </div>

                {poolChanges.map((change, idx) => (
                  <div key={change.id ?? `${change.timestamp}-${idx}`} className="dw-changes-entry">
                    <span className="dw-changes-time">{formatTimestamp(change.timestamp)}</span>

                    {change.added.length > 0 && (
                      <>
                        <span className="dw-changes-tag added">
                          + 新增 {change.added.length}
                        </span>
                        <ul className="dw-changes-list">
                          {change.added.map((name, i) => (
                            <li key={i} title={name}>
                              {name.length > 40 ? name.slice(0, 40) + '...' : name}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}

                    {change.removed.length > 0 && (
                      <>
                        <span className="dw-changes-tag removed">
                          - 移除 {change.removed.length}
                        </span>
                        <ul className="dw-changes-list removed">
                          {change.removed.map((name, i) => (
                            <li key={i} title={name}>
                              {name.length > 40 ? name.slice(0, 40) + '...' : name}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};
