// 展开面板主组件：包含可拖拽标题栏、需求池卡片网格、状态栏、以及趋势图表/需求变化/历史记录三个折叠区域
// 标题栏标记 data-drag-handle 使其可拖拽移动，内容区标记 data-no-drag 防止滚动时误触拖拽

import React from 'react';
import { CONFIG } from '../../config';
import { store } from '../../store';
import type { MonitorState } from '../../types';
import { PoolCards } from './PoolCards';
import { StatusBar } from './StatusBar';
import { TrendChart } from './TrendChart';
import { ChangesSection } from './ChangesSection';
import { HistorySection } from './HistorySection';

interface Props {
  state: MonitorState;
  maxHeight?: number;
}

export const Panel: React.FC<Props> = ({ state, maxHeight }) => {
  const { countdown } = state;

  let countdownColor = '#334155';
  if (countdown <= CONFIG.dangerThreshold) {
    countdownColor = '#dc2626';
  } else if (countdown <= CONFIG.warningThreshold) {
    countdownColor = '#d97706';
  }

  return (
    <div className="dw-panel" style={maxHeight ? { maxHeight } : undefined}>
      <div className="dw-titlebar" data-drag-handle>
        <div className="dw-titlebar-left">
          <span className="dw-titlebar-title">DevOps Watcher</span>
          <span className="dw-badge">{CONFIG.targets.length}</span>
        </div>
        <div className="dw-titlebar-right">
          <span className="dw-titlebar-countdown" style={{ color: countdownColor }}>
            {countdown}s
          </span>
          <button
            className="dw-close-btn"
            onClick={() => store.setState({ isExpanded: false })}
            title="收起"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M11 3L3 11M3 3l8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      </div>

      <div className="dw-content" data-no-drag>
        <PoolCards snapshots={state.poolSnapshots} />

        <StatusBar
          status={state.status}
          statusType={state.statusType}
          memoryUsage={state.memoryUsage}
        />

        <TrendChart
          history={state.history}
          collapsed={state.chartCollapsed}
          onToggle={() => store.setState({
            chartCollapsed: !state.chartCollapsed,
            ...(!state.chartCollapsed ? {} : { changesCollapsed: true, historyCollapsed: true }),
          })}
        />

        <ChangesSection
          changes={state.changes}
          collapsed={state.changesCollapsed}
          onToggle={() => store.setState({
            changesCollapsed: !state.changesCollapsed,
            ...(!state.changesCollapsed ? {} : { chartCollapsed: true, historyCollapsed: true }),
          })}
        />

        <HistorySection
          history={state.history}
          historyTotal={state.historyTotal}
          collapsed={state.historyCollapsed}
          onToggle={() => store.setState({
            historyCollapsed: !state.historyCollapsed,
            ...(!state.historyCollapsed ? {} : { chartCollapsed: true, changesCollapsed: true }),
          })}
        />
      </div>
    </div>
  );
};
