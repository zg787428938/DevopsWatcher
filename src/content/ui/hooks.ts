import { useState, useEffect, useRef, useCallback } from 'react';
import { store } from '../../store';
import type { MonitorState } from '../../types';

function shallowEqual<T extends Record<string, unknown>>(a: T, b: T): boolean {
  if (a === b) return true;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

/** 订阅 store 中由 selector 选取的状态切片，仅在切片浅比较变化时触发重渲染 */
export function useSelector<T extends Record<string, unknown>>(
  selector: (state: MonitorState) => T,
): T {
  const [slice, setSlice] = useState(() => selector(store.getState()));
  const sliceRef = useRef(slice);
  sliceRef.current = slice;

  const selectorRef = useRef(selector);
  selectorRef.current = selector;

  useEffect(() => {
    return store.subscribe(() => {
      const next = selectorRef.current(store.getState());
      if (!shallowEqual(sliceRef.current, next)) {
        setSlice(next);
      }
    });
  }, []);

  return slice;
}

/** 订阅全局 store 的完整 MonitorState（仅供 App 顶层使用，子组件应使用 useSelector） */
export function useMonitorState(): MonitorState {
  const [state, setState] = useState(store.getState());

  useEffect(() => {
    return store.subscribe(() => setState(store.getState()));
  }, []);

  return state;
}
