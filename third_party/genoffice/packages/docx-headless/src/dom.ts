let installed = false

/**
 * ProseMirror decides it is in a browser by sniffing globals at import time.
 * Install one DOM before the editor modules load.
 *
 * ponytail: one jsdom on globalThis. A second document opened while the first
 * editor is still alive shares that DOM. Give each open its own window if
 * calls start overlapping.
 */
export async function ensureDom(): Promise<void> {
  if (installed) return
  const { JSDOM, VirtualConsole } = await import('jsdom')
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    pretendToBeVisual: true,
    virtualConsole: new VirtualConsole(),
  })
  const w = dom.window as unknown as Record<string, unknown>
  const g = globalThis as unknown as Record<string, unknown>
  for (const key of ['window', 'document', 'navigator']) {
    const value = key === 'window' ? w : w[key]
    try {
      Object.defineProperty(g, key, { value, configurable: true, writable: true })
    } catch {
      g[key] = value
    }
  }
  for (const key of Object.getOwnPropertyNames(w)) {
    if (key in g) continue
    try {
      g[key] = w[key]
    } catch {
      // jsdom exposes a few non-copyable host objects
    }
  }
  g.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  const noMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  })
  g.matchMedia ??= noMedia
  w.matchMedia ??= noMedia
  g.requestAnimationFrame ??= (cb: (time: number) => void) => setTimeout(() => cb(Date.now()), 0)
  g.cancelAnimationFrame ??= (id: ReturnType<typeof setTimeout>) => clearTimeout(id)
  const range = (w.Range as { prototype: Record<string, unknown> }).prototype
  range.getClientRects ??= () => []
  range.getBoundingClientRect ??= () => ({
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
  })
  const doc = w.document as Record<string, unknown>
  doc.getSelection ??= () => null
  installed = true
}
