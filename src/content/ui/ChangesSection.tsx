/**
 * ChangesSection.tsx - 需求变化区块组件，按池分组展示所有变化记录（含时间戳），支持按池清除
 */
import React from 'react';
import { CONFIG, formatTimestamp, getTargetColor } from '../../config';
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
        <div className="dw-section-body" data-no-drag style={{ maxHeight: 340, overflowY: 'auto' }}>
          {grouped.size === 0 ? (
            <div className="dw-no-changes">暂无变化</div>
          ) : (
            Array.from(grouped.entries()).map(([poolName, poolChanges]) => {
              const colorIdx = CONFIG.targets.indexOf(poolName);
              const poolColor = colorIdx >= 0 ? getTargetColor(colorIdx) : '#64748b';
              return (
                <div key={poolName} className="dw-changes-pool">
                  <div className="dw-changes-pool-header" style={{ borderLeft: `3px solid ${poolColor}`, paddingLeft: 10 }}>
                    <span className="dw-changes-pool-name">
                      <span className="dw-history-pool-dot" style={{ background: poolColor }} />
                      {poolName}
                      <span className="dw-section-badge" style={{ marginLeft: 4 }}>
                        {poolChanges.length}
                      </span>
                    </span>
                    <button
                      className="dw-changes-clear"
                      onClick={(e) => { e.stopPropagation(); handleClear(poolName); }}
                    >
                      清除
                    </button>
                  </div>

                  {poolChanges.map((change, idx) => {
                    const diff = change.newCount - change.oldCount;
                    const diffStr = diff > 0 ? `+${diff}` : `${diff}`;
                    return (
                      <div key={change.id ?? `${change.timestamp}-${idx}`} className="dw-changes-entry">
                        <div className="dw-changes-entry-header">
                          <span className="dw-changes-time">{formatTimestamp(change.timestamp)}</span>
                          <span className="dw-changes-count-diff">
                            {change.oldCount} → {change.newCount}
                            {diff !== 0 && ` (${diffStr})`}
                          </span>
                        </div>

                        {change.added.length > 0 && (
                          <div className="dw-changes-block added">
                            <div className="dw-changes-block-title">
                              <span>+ 新增 {change.added.length}</span>
                            </div>
                            <ul className="dw-changes-list">
                              {change.added.map((name, i) => (
                                <li key={i}>{name}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {change.removed.length > 0 && (
                          <div className="dw-changes-block removed">
                            <div className="dw-changes-block-title">
                              <span>- 移除 {change.removed.length}</span>
                            </div>
                            <ul className="dw-changes-list">
                              {change.removed.map((name, i) => (
                                <li key={i}>{name}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
