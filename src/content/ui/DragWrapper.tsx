/**
 * DragWrapper 模块：可拖拽容器组件，用于包裹浮动 UI 元素，支持拖拽移动、惯性滑动以及点击与拖拽的区分
 */

import React, { useRef, useCallback, useEffect } from 'react';
import type { Position } from '../../types';

interface Props {
  position: Position;
  onPositionChange: (pos: Position) => void;
  onClick?: () => void;
  children: React.ReactNode;
}

// 点击与拖拽的位移阈值（像素），小于此值视为点击
const CLICK_THRESHOLD = 5;
// 惯性滑动的摩擦系数，用于模拟阻力使速度逐渐衰减
const FRICTION = 0.92;
// 速度低于此值时停止惯性动画
const MIN_VELOCITY = 0.5;

export const DragWrapper: React.FC<Props> = ({ position, onPositionChange, onClick, children }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const didDrag = useRef(false);
  const startPos = useRef({ x: 0, y: 0 });
  const startElPos = useRef({ x: 0, y: 0 });
  const velocity = useRef({ x: 0, y: 0 });
  const lastMovePos = useRef({ x: 0, y: 0 });
  const lastMoveTime = useRef(0);
  const rafId = useRef(0);

  // 以元素中心为锚点进行边界检测，中心不超出视口即可，元素可部分露出边缘
  const clampPosition = useCallback((x: number, y: number): Position => {
    const el = containerRef.current;
    if (!el) return { x, y };
    const rect = el.getBoundingClientRect();
    const halfW = rect.width / 2;
    const halfH = rect.height / 2;
    return {
      x: Math.max(-halfW, Math.min(x, window.innerWidth - halfW)),
      y: Math.max(-halfH, Math.min(y, window.innerHeight - halfH)),
    };
  }, []);

  // 指针按下：仅在 data-drag-handle 区域内且非交互元素上时开始拖拽
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    const handle = target.closest('[data-drag-handle]');
    if (!handle) return;
    if (target.closest('button, input, select, textarea, [data-no-drag]')) return;

    e.preventDefault();
    dragging.current = true;
    didDrag.current = false;
    startPos.current = { x: e.clientX, y: e.clientY };
    startElPos.current = { ...position };
    lastMovePos.current = { x: e.clientX, y: e.clientY };
    lastMoveTime.current = Date.now();
    velocity.current = { x: 0, y: 0 };

    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [position]);

  // 指针移动：计算瞬时速度用于惯性，并更新元素位置
  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;

    const dx = e.clientX - startPos.current.x;
    const dy = e.clientY - startPos.current.y;

    if (!didDrag.current && Math.abs(dx) + Math.abs(dy) < CLICK_THRESHOLD) return;
    didDrag.current = true;

    const now = Date.now();
    const dt = Math.max(1, now - lastMoveTime.current);
    velocity.current = {
      x: (e.clientX - lastMovePos.current.x) / dt * 16,
      y: (e.clientY - lastMovePos.current.y) / dt * 16,
    };
    lastMovePos.current = { x: e.clientX, y: e.clientY };
    lastMoveTime.current = now;

    const newPos = clampPosition(startElPos.current.x + dx, startElPos.current.y + dy);
    onPositionChange(newPos);
  }, [clampPosition, onPositionChange]);

  // 指针释放：若未发生拖拽则触发点击回调，否则启动惯性滑动动画
  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);

    if (!didDrag.current) {
      onClick?.();
      return;
    }

    let vx = velocity.current.x;
    let vy = velocity.current.y;
    let currentPos = { ...position };

    const animate = () => {
      vx *= FRICTION;
      vy *= FRICTION;

      if (Math.abs(vx) < MIN_VELOCITY && Math.abs(vy) < MIN_VELOCITY) return;

      currentPos = clampPosition(currentPos.x + vx, currentPos.y + vy);
      onPositionChange(currentPos);
      rafId.current = requestAnimationFrame(animate);
    };

    cancelAnimationFrame(rafId.current);
    rafId.current = requestAnimationFrame(animate);
  }, [position, clampPosition, onPositionChange, onClick]);

  // 组件卸载时取消未完成的惯性动画
  useEffect(() => {
    return () => cancelAnimationFrame(rafId.current);
  }, []);

  return (
    <div
      ref={containerRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        zIndex: 2147483647,
      }}
    >
      {children}
    </div>
  );
};
