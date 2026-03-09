/**
 * RequirementsSection.tsx - 需求列表区块组件
 * 按需求池分组展示所有需求，点击单条需求主动获取并展示该工作项的字段详情
 */
import React, { useState, useCallback } from 'react';
import { CONFIG, getTargetColor } from '../../config';
import type { PoolSnapshot, WorkitemDetail, WorkitemField, RequirementItem } from '../../types';
import { workitemDetailService } from '../index';

interface Props {
  snapshots: Record<string, PoolSnapshot>;
  collapsed: boolean;
  onToggle: () => void;
}

interface DetailState {
  loading: boolean;
  detail: WorkitemDetail | null;
  error: string | null;
}

export const RequirementsSection: React.FC<Props> = ({ snapshots, collapsed, onToggle }) => {
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [detailStates, setDetailStates] = useState<Record<string, DetailState>>({});

  const totalRequirements = CONFIG.targets.reduce((sum, target) => {
    return sum + (snapshots[target]?.totalCount ?? 0);
  }, 0);

  const itemKey = (item: RequirementItem, poolIdx: number, idx: number) =>
    item.identifier || `${poolIdx}-${idx}`;

  const handleItemClick = useCallback(async (item: RequirementItem, key: string) => {
    if (expandedItem === key) {
      setExpandedItem(null);
      return;
    }
    setExpandedItem(key);

    if (!item.identifier) return;
    if (detailStates[key]?.detail) return;

    setDetailStates(prev => ({
      ...prev,
      [key]: { loading: true, detail: null, error: null },
    }));

    try {
      const detail = await workitemDetailService.fetchDetail(item.identifier);
      setDetailStates(prev => ({
        ...prev,
        [key]: { loading: false, detail, error: null },
      }));
    } catch {
      setDetailStates(prev => ({
        ...prev,
        [key]: { loading: false, detail: null, error: '获取详情失败' },
      }));
    }
  }, [expandedItem, detailStates]);

  const handleRetry = useCallback(async (item: RequirementItem, key: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!item.identifier) return;

    workitemDetailService.clearDetail(item.identifier);
    setDetailStates(prev => ({
      ...prev,
      [key]: { loading: true, detail: null, error: null },
    }));

    try {
      const detail = await workitemDetailService.fetchDetail(item.identifier);
      setDetailStates(prev => ({
        ...prev,
        [key]: { loading: false, detail, error: null },
      }));
    } catch {
      setDetailStates(prev => ({
        ...prev,
        [key]: { loading: false, detail: null, error: '获取详情失败' },
      }));
    }
  }, []);

  const getDisplayFields = (detail: WorkitemDetail): WorkitemField[] => {
    return detail.fields.filter(f =>
      f.displayValue &&
      f.identifier !== 'subject' &&
      f.className !== 'richText'
    );
  };

  return (
    <div className="dw-section">
      <div className="dw-section-header" onClick={onToggle}>
        <span>
          需求列表
          {totalRequirements > 0 && <span className="dw-section-badge">{totalRequirements}</span>}
        </span>
        <svg className={`dw-section-arrow${collapsed ? '' : ' open'}`} width="10" height="10" viewBox="0 0 10 10" fill="none">
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
                <div className="dw-req-pool-header" style={{ borderLeft: `3px solid ${poolColor}`, paddingLeft: 10 }}>
                  <span className="dw-changes-pool-name">
                    <span className="dw-history-pool-dot" style={{ background: poolColor }} />
                    {poolName}
                    <span className="dw-section-badge" style={{ marginLeft: 4 }}>{snap.totalCount}</span>
                  </span>
                </div>

                <div className="dw-req-list">
                  {items.map((item, idx) => {
                    const key = itemKey(item, poolIdx, idx);
                    const isExpanded = expandedItem === key;
                    const state = detailStates[key];

                    return (
                      <div key={key} className={`dw-req-item-wrap${isExpanded ? ' expanded' : ''}`}>
                        <div
                          className="dw-req-item"
                          onClick={() => handleItemClick(item, key)}
                        >
                          <span className="dw-req-idx">{idx + 1}</span>
                          <span className="dw-req-name">{item.subject}</span>
                          <svg className={`dw-req-chevron${isExpanded ? ' open' : ''}`} width="10" height="10" viewBox="0 0 10 10" fill="none">
                            <path d="M3.5 2L7 5L3.5 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </div>

                        {isExpanded && (
                          <div className="dw-req-detail">
                            {state?.loading && (
                              <div className="dw-req-detail-msg">
                                <span className="dw-req-spinner" />
                                加载中...
                              </div>
                            )}
                            {state?.error && (
                              <div className="dw-req-detail-msg error">
                                {state.error}
                                <button className="dw-req-retry" onClick={(e) => handleRetry(item, key, e)}>
                                  重试
                                </button>
                              </div>
                            )}
                            {!item.identifier && !state?.loading && (
                              <div className="dw-req-detail-msg">暂无详情数据</div>
                            )}
                            {state?.detail && (
                              <div className="dw-req-detail-fields">
                                {getDisplayFields(state.detail).map(field => (
                                  <div key={field.identifier} className="dw-req-field">
                                    <span className="dw-req-field-label">{field.displayName}</span>
                                    <span className="dw-req-field-value">{field.displayValue}</span>
                                  </div>
                                ))}
                                {getDisplayFields(state.detail).length === 0 && (
                                  <div className="dw-req-detail-msg">暂无字段数据</div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
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
};
