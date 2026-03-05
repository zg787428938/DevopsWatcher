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
  user-select: none;
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
  padding: 12px 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
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
}
.dw-pool-card {
  background: #f8fafc;
  border-radius: 12px;
  padding: 14px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border: 1px solid #f1f5f9;
  transition: all 0.2s ease;
}
.dw-pool-card:hover {
  background: #f1f5f9;
  border-color: #e2e8f0;
}
.dw-pool-card-name {
  font-size: 12px;
  color: #64748b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 180px;
  font-weight: 500;
}
.dw-pool-card-count {
  font-size: 26px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.03em;
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
}
.dw-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
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
  margin-bottom: 12px;
}
.dw-changes-pool:last-child { margin-bottom: 0; }
.dw-changes-pool-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.dw-changes-pool-name {
  font-weight: 600;
  font-size: 13px;
  color: #1e293b;
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
}
.dw-changes-clear:hover {
  background: #f8fafc;
  border-color: #cbd5e1;
  color: #64748b;
}
.dw-changes-entry {
  padding: 8px 0;
  border-bottom: 1px solid #f1f5f9;
}
.dw-changes-entry:last-child { border-bottom: none; }
.dw-changes-time {
  display: block;
  font-size: 11px;
  color: #94a3b8;
  font-variant-numeric: tabular-nums;
  margin-bottom: 6px;
  font-weight: 500;
}
.dw-changes-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 6px;
  margin-bottom: 6px;
  letter-spacing: 0.01em;
}
.dw-changes-tag.added {
  background: #ecfdf5;
  color: #059669;
  border: 1px solid #a7f3d0;
}
.dw-changes-tag.removed {
  background: #fef2f2;
  color: #dc2626;
  border: 1px solid #fecaca;
}
.dw-changes-list {
  list-style: none;
  padding-left: 4px;
}
.dw-changes-list li {
  font-size: 12px;
  color: #475569;
  padding: 4px 8px;
  line-height: 1.4;
  border-radius: 6px;
  transition: background 0.1s ease;
}
.dw-changes-list li:hover {
  background: #f8fafc;
}
.dw-changes-list li::before {
  content: '';
  display: inline-block;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #cbd5e1;
  margin-right: 8px;
  vertical-align: middle;
}
.dw-changes-list.removed li {
  text-decoration: line-through;
  color: #94a3b8;
}
.dw-no-changes {
  color: #94a3b8;
  font-size: 12px;
  text-align: center;
  padding: 16px 8px;
}

/* ── 历史记录 ── */
.dw-history-item {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 7px 4px;
  border-bottom: 1px solid #f8fafc;
  font-size: 12px;
  border-radius: 4px;
  transition: background 0.1s ease;
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
}
.dw-history-pools {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  flex: 1;
}
.dw-history-pool {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.dw-history-pool-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  margin-right: 4px;
  vertical-align: middle;
  flex-shrink: 0;
}
.dw-history-pool-count {
  font-weight: 700;
  margin-left: 3px;
}
.dw-history-diff {
  font-size: 10px;
  font-weight: 600;
  margin-left: 2px;
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
  padding: 10px;
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

/* ── 通用工具类 ── */
.color-normal { color: #059669; }
.color-warning { color: #d97706; }
.color-danger { color: #dc2626; }
.color-white { color: #0f172a; }
`;
