/**
 * One GPUDevice for the lifetime of the tab, cached on `import.meta.hot.data`.
 *
 * A hot update must never request a second adapter/device: that is how a dev session ends
 * up with duplicated work, misleading performance numbers and GPU pressure. The cache lives
 * on the module's HMR data because that object survives the module being re-executed.
 */

export interface GpuContext {
  adapter: GPUAdapter;
  device: GPUDevice;
  info: GPUAdapterInfo | null;
  /** Random id for this device, so a dev-loop check can prove it was reused. */
  deviceId: string;
}

interface DeviceHotData {
  gpu?: Promise<GpuContext>;
}

function hotData(): DeviceHotData | undefined {
  return import.meta.hot?.data as DeviceHotData | undefined;
}

let pending: Promise<GpuContext> | undefined;

export function initDevice(): Promise<GpuContext> {
  const data = hotData();
  if (data?.gpu) return data.gpu;
  if (pending) return pending;

  const acquired = acquireGpu();
  pending = acquired;

  // Cache the *promise* immediately, so an update that lands mid-acquisition still reuses it.
  if (data) data.gpu = acquired;

  acquired.catch(() => {
    if (pending === acquired) pending = undefined;
    if (data?.gpu === acquired) delete data.gpu;
  });

  return acquired;
}

async function acquireGpu(): Promise<GpuContext> {
  if (!('gpu' in navigator) || !navigator.gpu) {
    // State the condition only. The recovery instruction lives in the fatal panel's hint, so a
    // user never reads the same sentence twice (the Layer 2 gate recorded that duplication).
    throw new Error('WebGPU is not available in this browser.');
  }

  const adapter =
    (await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })) ??
    (await navigator.gpu.requestAdapter());

  if (!adapter) {
    // As above: the fact here, the fix in the panel's hint.
    throw new Error('No WebGPU adapter was found for this GPU.');
  }

  const device = await adapter.requestDevice({ label: 'ugb-device' });

  device.addEventListener('uncapturederror', (event) => {
    const gpuError = (event as GPUUncapturedErrorEvent).error;
    console.error('[ugb] uncaptured GPU error:', gpuError.message);
  });

  void device.lost.then((info) => {
    if (info.reason === 'destroyed') return;
    console.error(`[ugb] GPU device lost (${info.reason}): ${info.message}`);
    window.dispatchEvent(new CustomEvent('ugb:device-lost', { detail: info }));
  });

  const info = (adapter.info as GPUAdapterInfo | undefined) ?? null;

  return {
    adapter,
    device,
    info,
    deviceId: newId(),
  };
}

export function describeAdapter(info: GPUAdapterInfo | null): string {
  if (!info) return 'GPU adapter';

  const parts = [info.vendor, info.architecture, info.device, info.description]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(' ') : 'GPU adapter';
}

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `dev-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}