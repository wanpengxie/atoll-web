// jsdom 没有实现编辑器用于光标定位的几何 API。浏览器原生具备这些能力；
// 测试里提供最小只读几何结果，避免 ProseMirror 的选择区同步产生异步错误。
if (typeof document !== 'undefined' && !document.elementFromPoint) {
  document.elementFromPoint = () => document.body;
}

const emptyRect = () => ({
  bottom: 0,
  height: 0,
  left: 0,
  right: 0,
  top: 0,
  width: 0,
  x: 0,
  y: 0,
  toJSON: () => ({}),
});

if (typeof Range !== 'undefined') {
  Range.prototype.getBoundingClientRect ||= emptyRect;
  Range.prototype.getClientRects ||= () => [];
}

if (typeof Text !== 'undefined') {
  Text.prototype.getClientRects ||= () => [];
}

// Virtuoso still constructs its measurement hook when a deterministic testing
// context is supplied; the context supplies sizes, this inert observer only
// satisfies the browser capability check.
globalThis.ResizeObserver ||= class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Anchor compensation after a prepend uses scrollBy. Browsers provide it;
// jsdom does not, so model its only stateful effect for virtual-list tests.
if (typeof HTMLElement !== 'undefined' && !HTMLElement.prototype.scrollBy) {
  HTMLElement.prototype.scrollBy = function scrollBy(optionsOrX, y) {
    const delta = typeof optionsOrX === 'object' ? Number(optionsOrX.top || 0) : Number(y || 0);
    this.scrollTop = Number(this.scrollTop || 0) + delta;
  };
}

// The owned timeline uses the browser's actual DOM boxes, with no test-only
// runtime branch. Legacy rendering tests get a deterministic surface here;
// geometry regressions supply heterogeneous data-test-height values per row.
if (typeof HTMLElement !== 'undefined') {
  const rect = HTMLElement.prototype.getBoundingClientRect;
  const height = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight');
  const width = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth');
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() {
    return this.classList.contains('timeline-message-list') ? 720 : height?.get?.call(this) || 0;
  } });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() {
    return this.classList.contains('timeline-message-list') ? 800 : width?.get?.call(this) || 0;
  } });
  HTMLElement.prototype.getBoundingClientRect = function () {
    if (!this.classList.contains('presentation-row')) return rect.call(this);
    const rowHeight = Number(this.dataset.testHeight || 96);
    let top = -(this.parentElement?.scrollTop || 0);
    for (let node = this.previousElementSibling; node; node = node.previousElementSibling) {
      top += node.classList.contains('presentation-row') ? Number(node.dataset.testHeight || 96) : parseFloat(node.style.height) || 0;
    }
    return { ...emptyRect(), top, bottom: top + rowHeight, height: rowHeight, width: 800, right: 800 };
  };
}
