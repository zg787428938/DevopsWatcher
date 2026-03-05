// 根组件：管理展开/收起状态切换和位置持久化，作为 FloatingBall 与 Panel 的容器
// 展开状态和收起状态分别维护独立的位置坐标，拖拽位置变化实时写入 IndexedDB 持久化

import React, { useCallback, useEffect, useState } from 'react';
import { store } from '../../store';
import { db } from '../services/db';
import { useMonitorState } from './hooks';
import { DragWrapper } from './DragWrapper';
import { FloatingBall } from './FloatingBall';
import { Panel } from './Panel';
import type { Position } from '../../types';

export const App: React.FC = () => {
  // 订阅全局状态，任何字段变化都会触发重渲染
  const state = useMonitorState();
  const { isExpanded, collapsedPos, expandedPos } = state;

  const [vh, setVh] = useState(window.innerHeight);
  useEffect(() => {
    const onResize = () => setVh(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // 根据展开/收起状态选择对应的位置坐标
  const currentPos = isExpanded ? expandedPos : collapsedPos;

  // 面板最大高度：不超过 85vh，同时不超出视口底部（留 8px 边距）
  const panelMaxHeight = isExpanded
    ? Math.min(vh * 0.85, Math.max(200, vh - expandedPos.y - 8))
    : undefined;

  // 拖拽结束时更新 store 和 IndexedDB 中的位置，展开和收起状态独立存储
  const handlePositionChange = useCallback(
    (pos: Position) => {
      const type = isExpanded ? 'expanded' : 'collapsed';
      store.setPosition(type, pos);
      db.savePosition(type, pos).catch(() => {}); // 持久化失败不影响 UI
    },
    [isExpanded],
  );

  // 点击悬浮球时展开面板，仅在收起状态下绑定此回调
  const handleBallClick = useCallback(() => {
    store.setState({ isExpanded: true });
  }, []);

  return (
    <DragWrapper
      position={currentPos}
      onPositionChange={handlePositionChange}
      onClick={isExpanded ? undefined : handleBallClick}
    >
      {isExpanded ? <Panel state={state} maxHeight={panelMaxHeight} /> : <FloatingBall state={state} />}
    </DragWrapper>
  );
};
