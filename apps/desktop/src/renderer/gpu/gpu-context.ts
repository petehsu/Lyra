// ─── GPU 设备管理（全局单例） ────────────────────────────────────────────────
// 封装 navigator.gpu → adapter → device 链路。
// 跨所有 editor 共享同一个 GPUDevice，避免多 device 的资源开销。
// device.lost 时调用 onLost 回调，由上层决定回退策略。

export type GpuContextState = {
  readonly device: GPUDevice;
  readonly format: GPUTextureFormat;
};

export type GpuContextOptions = {
  readonly onLost?: (reason: string) => void;
};

export type GpuContext = {
  readonly state: GpuContextState;
  readonly dispose: () => void;
};

let activeContext: GpuContext | null = null;
let activeInitPromise: Promise<GpuContext | null> | null = null;

const isWebGpuAvailable = (): boolean =>
  typeof navigator !== "undefined" && typeof navigator.gpu !== "undefined";

/**
 * 获取或创建全局 GPUContext。
 * WebGPU 不可用时返回 null，由上层回退到 DOM 渲染。
 * 并发调用只初始化一次。
 */
export const getGpuContext = (
  options: GpuContextOptions = {}
): Promise<GpuContext | null> => {
  if (activeContext !== null) {
    return Promise.resolve(activeContext);
  }
  if (activeInitPromise !== null) {
    return activeInitPromise;
  }

  activeInitPromise = (async (): Promise<GpuContext | null> => {
    if (!isWebGpuAvailable()) {
      return null;
    }

    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: "high-performance"
    });
    if (adapter === null) {
      return null;
    }

    const device = await adapter.requestDevice({
      requiredFeatures: [],
      requiredLimits: {
        maxTextureDimension2D: 4096,
        maxTextureArrayLayers: 1
      }
    });

    const format = navigator.gpu.getPreferredCanvasFormat();
    const dispose = (): void => {
      if (activeContext === null) {
        return;
      }
      activeContext = null;
      device.destroy();
    };

    // device.lost 是 Promise，resolve 时表示设备丢失。
    // ponytail: Chrome 中 lostInfo.reason 可能是 "unknown"（驱动崩溃）或 "destroyed"（主动销毁）。
    void device.lost.then((info) => {
      if (activeContext !== null) {
        activeContext = null;
        options.onLost?.(info.reason);
      }
    });

    activeContext = { state: { device, format }, dispose };
    return activeContext;
  })();

  // 初始化完成后清除 init promise，后续调用走 fast path
  void activeInitPromise.then(() => {
    activeInitPromise = null;
  });

  return activeInitPromise;
};

/**
 * 测试辅助：重置全局状态。仅用于单元测试。
 */
export const resetGpuContextForTest = (): void => {
  activeContext = null;
  activeInitPromise = null;
};