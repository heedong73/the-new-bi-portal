import '@testing-library/jest-dom'

/** jsdom에는 레이아웃 엔진이 없어 Recharts ResponsiveContainer의 크기가 -1이 된다. */
class TestResizeObserver implements ResizeObserver {
  private readonly callback: ResizeObserverCallback

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
  }

  observe(target: Element): void {
    const contentRect: DOMRectReadOnly = {
      x: 0,
      y: 0,
      width: 1024,
      height: 768,
      top: 0,
      right: 1024,
      bottom: 768,
      left: 0,
      toJSON: () => ({}),
    }
    this.callback([
      {
        target,
        contentRect,
        borderBoxSize: [],
        contentBoxSize: [],
        devicePixelContentBoxSize: [],
      },
    ], this)
  }

  unobserve(): void {}

  disconnect(): void {}
}

globalThis.ResizeObserver = TestResizeObserver
