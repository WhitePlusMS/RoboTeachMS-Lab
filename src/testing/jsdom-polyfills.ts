/**
 * jsdom 未实现 Range.getClientRects / getBoundingClientRect，CodeMirror 的
 * 文本测量在异步渲染中会抛出未处理异常。这里补空实现：测试只断言逻辑，
 * 不依赖真实布局尺寸。仅在 jsdom（存在 Range 全局）环境下生效。
 */
if (typeof Range !== 'undefined') {
  const emptyRectList = (): DOMRectList => {
    const rects: DOMRect[] = []
    return {
      length: 0,
      item: (index: number) => rects[index] ?? null,
      [Symbol.iterator]: rects[Symbol.iterator].bind(rects),
    } as DOMRectList
  }
  Range.prototype.getClientRects = emptyRectList
  Range.prototype.getBoundingClientRect = () =>
    ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect
}
export {}
