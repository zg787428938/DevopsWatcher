/**
 * HistorySection.tsx - 历史记录区块组件，按时间倒序展示各目标池的数量快照，支持滚动加载更多记录并显示与上一条的差值
 */
import React, { useCallback, useRef, useEffect, useState } from 'react';
import { CONFIG, getTargetColor, formatTimestamp } from '../../config';
import { db } from '../services/db';
import type { HistoryRecord } from '../../types';

interface Props {
  history: HistoryRecord[];
  historyTotal: number;
  collapsed: boolean;
  onToggle: () => void;
}

export const HistorySection: React.FC<Props> = ({ history, historyTotal, collapsed, onToggle }) => {
  const [loadingMore, setLoadingMore] = useState(false);
  const [extraRecords, setExtraRecords] = useState<HistoryRecord[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 合并当前页历史与已加载的额外记录，用于完整列表展示
  const allRecords = [...history, ...extraRecords];

  // 加载更多历史记录，从 IndexedDB 分页获取，避免重复请求和超出总数
  const loadMore = useCallback(async () => {
    if (loadingMore || allRecords.length >= historyTotal) return;
    setLoadingMore(true);
    try {
      const more = await db.getHistory(allRecords.length, CONFIG.historyPageSize);
      setExtraRecords((prev) => [...prev, ...more]);
    } finally {
      setLoadingMore(false);
    }
  }, [allRecords.length, historyTotal, loadingMore]);

  // 滚动到底部附近（距底部 20px 内）时触发加载更多
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 20) {
      loadMore();
    }
  }, [loadMore]);

  // 当主历史数据条数变化时（如刷新），清空已加载的额外记录，避免数据错乱
  useEffect(() => {
    setExtraRecords([]);
  }, [history.length]);

  return (
    <div className="dw-section">
      <div className="dw-section-header" onClick={onToggle}>
        <span>
          历史记录
          <span className="dw-section-badge">{historyTotal}</span>
        </span>
        <svg className={`dw-section-arrow${collapsed ? '' : ' open'}`} width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M3.5 2L7 5L3.5 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
      {!collapsed && (
        <div
          className="dw-section-body"
          ref={scrollRef}
          onScroll={handleScroll}
          data-no-drag
          style={{ maxHeight: 300, overflowY: 'auto' }}
        >
          {allRecords.length === 0 ? (
            <div className="dw-no-changes">暂无历史记录</div>
          ) : (
            allRecords.map((record, idx) => {
              // 上一条记录用于计算差值（allRecords 为倒序，idx+1 为更早的记录）
              const prevRecord = allRecords[idx + 1];
              return (
                <div key={record.id != null ? `db-${record.id}` : `mem-${idx}`} className="dw-history-item">
                  <span className="dw-history-time">{formatTimestamp(record.timestamp)}</span>
                  <div className="dw-history-pools">
                    {CONFIG.targets.map((target, tIdx) => {
                      const count = record.pools[target];
                      if (count === undefined) return null;
                      const prevCount = prevRecord?.pools[target];
                      const diff = prevCount !== undefined ? count - prevCount : 0;
                      const color = getTargetColor(tIdx);
                      return (
                        <span key={target} className="dw-history-pool" title={target}>
                          <span className="dw-history-pool-dot" style={{ background: color }} />
                          <span className="dw-history-pool-count" style={{ color }}>
                            {count}
                          </span>
                          {diff !== 0 && (
                            <span
                              className={`dw-history-diff ${diff > 0 ? 'positive' : 'negative'}`}
                            >
                              {diff > 0 ? `+${diff}` : diff}
                            </span>
                          )}
                        </span>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
          {allRecords.length < historyTotal && (
            <div className="dw-history-load-more">
              {loadingMore ? '加载中...' : '滚动加载更多'}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
