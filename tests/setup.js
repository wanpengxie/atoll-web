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

// jsdom has no ResizeObserver. Component tests only need its lifecycle shape;
// real sizing and anchor behavior are verified in Chromium.
globalThis.ResizeObserver ||= class ResizeObserver {
  constructor(callback) { this.callback = callback; }
  observe(target) {
    queueMicrotask(() => this.callback?.([{ target, contentRect: target.getBoundingClientRect() }], this));
  }
  unobserve() {}
  disconnect() {}
};

// Browsers provide scrollBy; jsdom does not.
if (typeof HTMLElement !== 'undefined' && !HTMLElement.prototype.scrollBy) {
  HTMLElement.prototype.scrollBy = function scrollBy(optionsOrX, y) {
    const delta = typeof optionsOrX === 'object' ? Number(optionsOrX.top || 0) : Number(y || 0);
    this.scrollTop = Number(this.scrollTop || 0) + delta;
  };
}

if (typeof HTMLElement !== 'undefined' && !HTMLElement.prototype.scrollTo) {
  HTMLElement.prototype.scrollTo = function scrollTo(optionsOrX, y) {
    this.scrollTop = typeof optionsOrX === 'object'
      ? Number(optionsOrX.top || 0)
      : Number(y || 0);
    this.dispatchEvent(new Event('scroll'));
  };
}
