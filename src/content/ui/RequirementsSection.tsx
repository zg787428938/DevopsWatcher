import React, { useCallback, useMemo } from 'react';
import { CONFIG, getTargetColor } from '../../config';
import { store } from '../../store';
import type { PoolSnapshot, RequirementItem } from '../../types';

interface Props {
  snapshots: Record<string, PoolSnapshot>;
  collapsed: boolean;
  onToggle: () => void;
}

export const RequirementsSection: React.FC<Props> = React.memo(({ snapshots, collapsed, onToggle }) => {
  const totalRequirements = useMemo(() =>
    CONFIG.targets.reduce((sum, target) => sum + (snapshots[target]?.totalCount ?? 0), 0),
    [snapshots],
  );

  const handleItemClick = useCallback((item: RequirementItem) => {
    if (!item.identifier) return;
    store.setState({ detailView: { identifier: item.identifier, subject: item.subject } });
  }, []);

  return (
    <div className="dw-section">
      <div className="dw-section-header" onClick={onToggle}>
        <span>
          需求列表
          {totalRequirements > 0 && <span className="dw-section-badge">{totalRequirements}</span>}
        </span>
        <svg className={`dw-section-arrow${collapsed ? '' : ' open'}`} width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <path d="M3.5 2L7 5L3.5 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
      {!collapsed && (
        <div className="dw-section-body" data-no-drag style={{ maxHeight: 400, overflowY: 'auto' }}>
          {CONFIG.targets.map((poolName, poolIdx) => {
            const snap = snapshots[poolName];
            if (!snap) return null;
            const items = snap.items ?? snap.requirements.map(s => ({ subject: s, identifier: '' }));
            const poolColor = getTargetColor(poolIdx);

            return (
              <div key={poolName} className="dw-req-pool">
                <div className="dw-req-pool-header" style={{ borderLeft: `3px solid ${poolColor}` }}>
                  <span className="dw-pool-label">
                    <span className="dw-pool-dot" style={{ background: poolColor }} />
                    {poolName}
                    <span className="dw-section-badge">{snap.totalCount}</span>
                  </span>
                </div>

                <div className="dw-req-list">
                  {items.map((item, idx) => (
                    <div key={item.identifier || `${poolIdx}-${idx}`} className="dw-req-item-wrap">
                      <div
                        className={`dw-req-item${item.identifier ? '' : ' disabled'}`}
                        onClick={() => handleItemClick(item)}
                      >
                        <span className="dw-req-idx">{idx + 1}</span>
                        <span className="dw-req-name">{item.subject}</span>
                        {item.identifier && (
                          <svg className="dw-req-chevron" width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                            <path d="M3.5 2L7 5L3.5 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </div>
                    </div>
                  ))}
                  {items.length === 0 && (
                    <div className="dw-no-changes">暂无需求</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
