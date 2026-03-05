// 模拟真实用户点击：发送完整的 Pointer + Mouse 事件序列
// 云效使用 React 17+ / Fusion Design / Teamix，这些框架优先监听 PointerEvent
// 浏览器真实点击的事件顺序：pointerdown → mousedown → pointerup → mouseup → click
// 必须构造带真实坐标、bubbles:true 的事件才能被框架的合成事件系统捕获

export function simulateClick(element: HTMLElement): void {
  // 优先点击元素内部最深层的可见文本节点父元素，部分框架在内层绑定事件
  const target = findDeepestVisibleChild(element) || element;

  target.scrollIntoView({ block: 'nearest', behavior: 'instant' as ScrollBehavior });

  const rect = target.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;

  const commonOpts = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: x,
    clientY: y,
    screenX: x + window.screenX,
    screenY: y + window.screenY,
  };

  const pointerOpts: PointerEventInit = {
    ...commonOpts,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    width: 1,
    height: 1,
    pressure: 0.5,
    button: 0,
    buttons: 1,
  };

  const mouseOpts: MouseEventInit = {
    ...commonOpts,
    button: 0,
    buttons: 1,
  };

  // 完整事件序列：与浏览器原生点击一致
  target.dispatchEvent(new PointerEvent('pointerover', pointerOpts));
  target.dispatchEvent(new PointerEvent('pointerenter', { ...pointerOpts, bubbles: false }));
  target.dispatchEvent(new MouseEvent('mouseover', mouseOpts));
  target.dispatchEvent(new MouseEvent('mouseenter', { ...mouseOpts, bubbles: false }));

  target.dispatchEvent(new PointerEvent('pointerdown', pointerOpts));
  target.dispatchEvent(new MouseEvent('mousedown', mouseOpts));

  // focus 事件（部分框架依赖 focus 状态切换触发 handler）
  if (typeof target.focus === 'function') target.focus();

  target.dispatchEvent(new PointerEvent('pointerup', { ...pointerOpts, pressure: 0, buttons: 0 }));
  target.dispatchEvent(new MouseEvent('mouseup', { ...mouseOpts, buttons: 0 }));
  target.dispatchEvent(new MouseEvent('click', { ...mouseOpts, buttons: 0 }));
}

// 查找元素内部最深层的、有尺寸的子元素（通常是文本所在的 span/a/div）
// 某些 UI 框架在内层节点上绑定点击事件，直接点击外层容器不会触发
function findDeepestVisibleChild(el: HTMLElement): HTMLElement | null {
  let current: HTMLElement = el;
  while (current.children.length > 0) {
    let found = false;
    for (let i = 0; i < current.children.length; i++) {
      const child = current.children[i] as HTMLElement;
      const rect = child.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        current = child;
        found = true;
        break;
      }
    }
    if (!found) break;
  }
  return current === el ? null : current;
}
