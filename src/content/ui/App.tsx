import React, { useCallback, useEffect, useState } from 'react';
import { store } from '../../store';
import { db } from '../services/db';
import { useSelector } from './hooks';
import { DragWrapper } from './DragWrapper';
import { FloatingBall } from './FloatingBall';
import { Panel } from './Panel';
import type { Position } from '../../types';

export const App: React.FC = () => {
  const { isExpanded, collapsedPos, expandedPos } = useSelector((s) => ({
    isExpanded: s.isExpanded,
    collapsedPos: s.collapsedPos,
    expandedPos: s.expandedPos,
  }));

  const [vh, setVh] = useState(window.innerHeight);
  useEffect(() => {
    const onResize = () => setVh(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const currentPos = isExpanded ? expandedPos : collapsedPos;

  const panelMaxHeight = isExpanded
    ? Math.min(vh * 0.85, Math.max(200, vh - expandedPos.y - 8))
    : undefined;

  const handlePositionChange = useCallback(
    (pos: Position) => {
      const type = isExpanded ? 'expanded' : 'collapsed';
      store.setPosition(type, pos);
      db.savePosition(type, pos).catch(() => {});
    },
    [isExpanded],
  );

  const handleBallClick = useCallback(() => {
    store.setState({ isExpanded: true });
  }, []);

  return (
    <DragWrapper
      position={currentPos}
      onPositionChange={handlePositionChange}
      onClick={isExpanded ? undefined : handleBallClick}
    >
      {isExpanded ? <Panel maxHeight={panelMaxHeight} /> : <FloatingBall />}
    </DragWrapper>
  );
};
