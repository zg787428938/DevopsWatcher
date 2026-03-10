import React, { useRef, useEffect } from 'react';
import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { CONFIG, getTargetColor } from '../../config';
import type { HistoryRecord } from '../../types';

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Legend, Filler);

interface Props {
  history: HistoryRecord[];
  collapsed: boolean;
  onToggle: () => void;
}

export const TrendChart: React.FC<Props> = React.memo(({ history, collapsed, onToggle }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    // 折叠状态下销毁图表实例并提前返回，避免占用资源
    if (collapsed) {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
      return;
    }

    if (!canvasRef.current) return;

    // 将历史记录反转后取最近 N 条（由 CONFIG.chartMaxPoints 控制），保证时间轴从左到右递增
    const data = [...history]
      .reverse()
      .slice(-CONFIG.chartMaxPoints);

    // 提取时间字符串作为 X 轴标签
    const labels = data.map((r) => r.timeStr);

    // 为每个目标池构建一条折线数据集，包含标签、数值、颜色、样式等
    const datasets = CONFIG.targets.map((target, idx) => ({
      label: target,
      data: data.map((r) => r.pools[target] ?? null),
      borderColor: getTargetColor(idx),
      backgroundColor: getTargetColor(idx) + '20',
      borderWidth: 2,
      pointRadius: data.length > 50 ? 0 : 2,
      pointHoverRadius: 4,
      tension: 0.3,
      fill: false,
      spanGaps: true,
    }));

    if (chartRef.current) {
      const oldCount = chartRef.current.data.datasets.length;
      if (oldCount !== datasets.length) {
        chartRef.current.destroy();
        chartRef.current = null;
      } else {
        chartRef.current.data.labels = labels;
        chartRef.current.data.datasets = datasets;
        chartRef.current.update('none');
        return;
      }
    }

    const timer = setTimeout(() => {
      if (!canvasRef.current) return;
      chartRef.current = new Chart(canvasRef.current, {
        type: 'line',
        data: { labels, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            tooltip: {
              backgroundColor: '#ffffff',
              titleColor: '#1e293b',
              bodyColor: '#64748b',
              borderColor: '#e2e8f0',
              borderWidth: 1,
              padding: 10,
              cornerRadius: 8,
              bodyFont: { size: 12 },
              titleFont: { size: 12, weight: '600' as const },
              boxPadding: 4,
            },
            legend: {
              display: CONFIG.targets.length > 1,
              position: 'bottom' as const,
              labels: {
                color: '#64748b',
                font: { size: 11 },
                boxWidth: 12,
                boxHeight: 2,
                padding: 12,
                usePointStyle: false,
              },
            },
          },
          scales: {
            x: {
              ticks: { color: '#94a3b8', font: { size: 10 }, maxTicksLimit: 8 },
              grid: { color: 'rgba(0, 0, 0, 0.04)' },
            },
            y: {
              ticks: { color: '#94a3b8', font: { size: 10 }, precision: 0 },
              grid: { color: 'rgba(0, 0, 0, 0.04)' },
              beginAtZero: true,
            },
          },
        },
      });
    }, CONFIG.chartRedrawDelay);

    return () => {
      clearTimeout(timer);
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [history, collapsed]);

  return (
    <div className="dw-section">
      <div className="dw-section-header" onClick={onToggle}>
        <span>
          趋势图表
          <span className="dw-section-badge">{Math.min(history.length, CONFIG.chartMaxPoints)}</span>
        </span>
        <svg className={`dw-section-arrow${collapsed ? '' : ' open'}`} width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <path d="M3.5 2L7 5L3.5 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
      {!collapsed && (
        <div className="dw-section-body">
          <div className="dw-chart-container" data-no-drag>
            <canvas ref={canvasRef} />
          </div>
        </div>
      )}
    </div>
  );
});
