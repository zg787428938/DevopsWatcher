export const STYLES = `
:host {
  all: initial;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
  font-size: 13px;
  color: #334155;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

[data-drag-handle] { touch-action: none; }

/* ── 悬浮球 ── */
.dw-ball {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: linear-gradient(135deg, #ffffff, #f8fafc);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  box-shadow:
    0 4px 12px rgba(0, 0, 0, 0.08),
    0 1px 3px rgba(0, 0, 0, 0.06),
    0 0 0 1px rgba(0, 0, 0, 0.04);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  user-select: none;
}
.dw-ball:hover {
  box-shadow:
    0 8px 24px rgba(59, 130, 246, 0.15),
    0 2px 6px rgba(0, 0, 0, 0.06),
    0 0 0 1px rgba(59, 130, 246, 0.15);
  transform: scale(1.04);
}
.dw-ball.flashing {
  animation: dw-flash 1.2s ease-in-out infinite alternate;
}
@keyframes dw-flash {
  from { box-shadow: 0 0 6px 2px rgba(59, 130, 246, 0.12), 0 0 0 1px rgba(59, 130, 246, 0.1); }
  to   { box-shadow: 0 0 24px 8px rgba(59, 130, 246, 0.25), 0 0 0 1px rgba(59, 130, 246, 0.2); }
}
.dw-ball svg {
  position: absolute;
  top: 0; left: 0;
}
.dw-ball .countdown-text {
  font-size: 15px;
  font-weight: 700;
  z-index: 1;
  letter-spacing: -0.02em;
}

/* ── 展开面板 ── */
.dw-panel {
  width: 360px;
  max-height: 85vh;
  background: linear-gradient(180deg, #ffffff 0%, #fafbfc 100%);
  border-radius: 16px;
  box-shadow:
    0 24px 48px -12px rgba(0, 0, 0, 0.12),
    0 8px 16px -4px rgba(0, 0, 0, 0.06),
    0 0 0 1px rgba(0, 0, 0, 0.05);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ── 标题栏 ── */
.dw-titlebar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  background: #ffffff;
  cursor: grab;
  border-bottom: 1px solid #f1f5f9;
  flex-shrink: 0;
  user-select: none;
}
.dw-titlebar:active { cursor: grabbing; }
.dw-titlebar-left {
  display: flex;
  align-items: center;
  gap: 10px;
}
.dw-titlebar-title {
  font-size: 14px;
  font-weight: 600;
  color: #0f172a;
  letter-spacing: -0.01em;
}
.dw-badge {
  background: linear-gradient(135deg, #3b82f6, #2563eb);
  color: white;
  font-size: 10px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 10px;
  min-width: 18px;
  text-align: center;
  letter-spacing: 0.02em;
  box-shadow: 0 1px 3px rgba(37, 99, 235, 0.3);
}
.dw-titlebar-right {
  display: flex;
  align-items: center;
  gap: 12px;
}
.dw-titlebar-countdown {
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
}
.dw-close-btn {
  background: none;
  border: none;
  color: #94a3b8;
  cursor: pointer;
  font-size: 16px;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  transition: all 0.15s ease;
  line-height: 1;
}
.dw-close-btn:hover {
  background: #f1f5f9;
  color: #475569;
}

/* ── 可滚动内容区 ── */
.dw-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-gutter: stable;
  padding: 12px 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  user-select: text;
}
.dw-content::-webkit-scrollbar { width: 5px; }
.dw-content::-webkit-scrollbar-track { background: transparent; }
.dw-content::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.08);
  border-radius: 4px;
}
.dw-content:hover::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.14); }
.dw-content::-webkit-scrollbar-thumb:hover { background: rgba(0, 0, 0, 0.22); }

/* ── 需求池卡片 ── */
.dw-pool-grid {
  display: grid;
  gap: 8px;
  flex-shrink: 0;
}
.dw-pool-card {
  background: #f8fafc;
  border-radius: 12px;
  padding: 12px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border: 1px solid #f1f5f9;
  transition: all 0.2s ease;
  user-select: none;
}
.dw-pool-card:hover {
  background: #f1f5f9;
  border-color: #e2e8f0;
}
.dw-pool-card-left {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
}
.dw-pool-card-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.dw-pool-card-name {
  font-size: 12px;
  color: #64748b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 500;
}
.dw-pool-card-count {
  font-size: 26px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.03em;
  flex-shrink: 0;
}

/* ── 状态栏 ── */
.dw-status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: #f8fafc;
  border-radius: 10px;
  font-size: 12px;
  border: 1px solid #f1f5f9;
  flex-shrink: 0;
  user-select: none;
}
.dw-status-text {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-right: 8px;
  font-weight: 500;
}
.dw-memory-text {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  color: #94a3b8;
  font-size: 11px;
}

/* ── 折叠区域 ── */
.dw-section {
  border: 1px solid #f1f5f9;
  border-radius: 12px;
  overflow: hidden;
  background: #ffffff;
  flex-shrink: 0;
}
.dw-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 11px 14px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  color: #475569;
  user-select: none;
  transition: background 0.15s ease;
}
.dw-section-header:hover {
  background: #f8fafc;
}
.dw-section-badge {
  background: #eef2ff;
  color: #6366f1;
  font-size: 10px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 8px;
  margin-left: 8px;
  letter-spacing: 0.02em;
}
.dw-section-arrow {
  color: #94a3b8;
  font-size: 9px;
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}
.dw-section-arrow.open { transform: rotate(90deg); }
.dw-section-body {
  padding: 10px 14px 14px;
  border-top: 1px solid #f1f5f9;
  scrollbar-gutter: stable;
}

/* ── 趋势图表 ── */
.dw-chart-container {
  height: 180px;
  position: relative;
}
.dw-chart-container canvas {
  width: 100% !important;
  height: 100% !important;
}

/* ── 需求变化 ── */
.dw-changes-pool {
  margin-bottom: 14px;
}
.dw-changes-pool:last-child { margin-bottom: 0; }
.dw-changes-pool-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  padding: 7px 10px;
  background: #f8fafc;
  border-radius: 8px;
  position: sticky;
  top: 0;
  z-index: 1;
  user-select: none;
}
.dw-changes-pool-name {
  font-weight: 600;
  font-size: 13px;
  color: #1e293b;
  display: flex;
  align-items: center;
  gap: 6px;
}
.dw-changes-clear {
  background: none;
  border: 1px solid #e2e8f0;
  color: #94a3b8;
  cursor: pointer;
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 6px;
  transition: all 0.15s ease;
  user-select: none;
}
.dw-changes-clear:hover {
  background: #fff;
  border-color: #cbd5e1;
  color: #64748b;
}
.dw-changes-entry {
  padding: 10px 0;
  border-bottom: 1px solid #f1f5f9;
}
.dw-changes-entry:last-child { border-bottom: none; }
.dw-changes-entry-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  user-select: none;
}
.dw-changes-time {
  font-size: 11px;
  color: #94a3b8;
  font-variant-numeric: tabular-nums;
  font-weight: 500;
  white-space: nowrap;
}
.dw-changes-count-diff {
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: #64748b;
  padding: 1px 8px;
  background: #f1f5f9;
  border-radius: 4px;
  white-space: nowrap;
}
.dw-changes-block {
  border-radius: 8px;
  padding: 8px 10px;
  margin-bottom: 6px;
}
.dw-changes-block:last-child { margin-bottom: 0; }
.dw-changes-block.added {
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
}
.dw-changes-block.removed {
  background: #fef2f2;
  border: 1px solid #fecaca;
}
.dw-changes-block-title {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 600;
  margin-bottom: 6px;
  user-select: none;
}
.dw-changes-block.added .dw-changes-block-title { color: #16a34a; }
.dw-changes-block.removed .dw-changes-block-title { color: #dc2626; }
.dw-changes-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.dw-changes-list li {
  font-size: 12px;
  color: #334155;
  padding: 3px 0 3px 14px;
  line-height: 1.5;
  word-break: break-all;
  position: relative;
  cursor: text;
}
.dw-changes-list li::before {
  content: '';
  position: absolute;
  left: 3px;
  top: 10px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
}
.dw-changes-block.added .dw-changes-list li::before {
  background: #86efac;
}
.dw-changes-block.removed .dw-changes-list li::before {
  background: #fca5a5;
}
.dw-changes-list li:hover {
  background: rgba(0, 0, 0, 0.02);
  border-radius: 4px;
}
.dw-changes-block.removed .dw-changes-list li {
  color: #64748b;
  text-decoration: line-through;
  text-decoration-color: #d4d4d8;
}
.dw-no-changes {
  color: #94a3b8;
  font-size: 12px;
  text-align: center;
  padding: 20px 8px;
}

/* ── 历史记录 ── */
.dw-history-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 6px;
  border-bottom: 1px solid #f8fafc;
  font-size: 12px;
  border-radius: 6px;
  transition: background 0.1s ease;
  user-select: none;
}
.dw-history-item:hover {
  background: #f8fafc;
}
.dw-history-item:last-child { border-bottom: none; }
.dw-history-time {
  color: #94a3b8;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 500;
  flex-shrink: 0;
}
.dw-history-pools {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
  flex: 1;
}
.dw-history-pool {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.dw-history-pool-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}
.dw-history-pool-count {
  font-weight: 700;
  margin-left: 1px;
}
.dw-history-diff {
  font-size: 10px;
  font-weight: 600;
  padding: 0 4px;
  border-radius: 4px;
}
.dw-history-diff.positive {
  color: #059669;
  background: #ecfdf5;
}
.dw-history-diff.negative {
  color: #dc2626;
  background: #fef2f2;
}
.dw-history-load-more {
  text-align: center;
  padding: 12px;
  color: #94a3b8;
  font-size: 12px;
}

/* ── 滚动条（历史记录内部） ── */
.dw-section-body::-webkit-scrollbar { width: 4px; }
.dw-section-body::-webkit-scrollbar-track { background: transparent; }
.dw-section-body::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.06);
  border-radius: 4px;
}
.dw-section-body:hover::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.14); }

/* ── 需求列表 ── */
.dw-req-pool {
  margin-bottom: 14px;
}
.dw-req-pool:last-child { margin-bottom: 0; }
.dw-req-pool-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
  padding: 7px 10px;
  background: #f8fafc;
  border-radius: 8px;
  position: sticky;
  top: 0;
  z-index: 1;
  user-select: none;
}
.dw-req-list {
  padding: 0;
}
.dw-req-item-wrap {
  border-bottom: 1px solid #f8fafc;
}
.dw-req-item-wrap:last-child { border-bottom: none; }
.dw-req-item-wrap.expanded {
  background: #f8fafc;
  border-radius: 8px;
  border-bottom-color: transparent;
  margin-bottom: 4px;
}
.dw-req-item {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  padding: 6px 8px;
  border-radius: 6px;
  font-size: 12px;
  color: #334155;
  line-height: 1.5;
  cursor: pointer;
  transition: background 0.12s ease;
  user-select: text;
}
.dw-req-item:hover {
  background: #f1f5f9;
}
.dw-req-item-wrap.expanded > .dw-req-item {
  background: transparent;
}
.dw-req-item-wrap.expanded > .dw-req-item:hover {
  background: rgba(0,0,0,0.02);
}
.dw-req-idx {
  flex-shrink: 0;
  width: 18px;
  text-align: right;
  font-size: 10px;
  font-weight: 600;
  color: #c0c8d4;
  line-height: 1.5;
  margin-top: 1px;
  font-variant-numeric: tabular-nums;
}
.dw-req-name {
  flex: 1;
  word-break: break-all;
}
.dw-req-chevron {
  color: #c0c8d4;
  flex-shrink: 0;
  margin-top: 3px;
  transition: transform 0.2s ease, color 0.15s ease;
}
.dw-req-item:hover .dw-req-chevron {
  color: #94a3b8;
}
.dw-req-chevron.open {
  transform: rotate(90deg);
  color: #6366f1;
}
.dw-req-detail {
  padding: 2px 10px 10px 33px;
}
.dw-req-detail-msg {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #94a3b8;
  padding: 4px 0;
}
.dw-req-detail-msg.error {
  color: #dc2626;
}
.dw-req-spinner {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 2px solid #e0e7ff;
  border-top-color: #6366f1;
  border-radius: 50%;
  animation: dw-spin 0.6s linear infinite;
}
@keyframes dw-spin {
  to { transform: rotate(360deg); }
}
.dw-req-retry {
  background: none;
  border: 1px solid #fecaca;
  color: #dc2626;
  cursor: pointer;
  font-size: 10px;
  padding: 1px 8px;
  border-radius: 4px;
  margin-left: 4px;
  transition: all 0.15s ease;
}
.dw-req-retry:hover {
  background: #fef2f2;
}
.dw-req-detail-fields {
  display: flex;
  flex-direction: column;
  gap: 1px;
  background: #ffffff;
  border: 1px solid #f1f5f9;
  border-radius: 8px;
  padding: 6px 0;
  overflow: hidden;
}
.dw-req-field {
  display: flex;
  gap: 8px;
  font-size: 11px;
  line-height: 1.5;
  padding: 3px 10px;
  transition: background 0.1s ease;
}
.dw-req-field:hover {
  background: #f8fafc;
}
.dw-req-field-label {
  color: #94a3b8;
  white-space: nowrap;
  flex-shrink: 0;
  min-width: 56px;
  text-align: right;
  font-weight: 500;
}
.dw-req-field-value {
  color: #334155;
  word-break: break-all;
}

/* ── 通用工具类 ── */
.color-normal { color: #059669; }
.color-warning { color: #d97706; }
.color-danger { color: #dc2626; }
.color-white { color: #0f172a; }
`;
