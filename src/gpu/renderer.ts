import stage0Source from './stage0.wgsl?raw';
import sceneSource from './scene.wgsl?raw';
import galaxySource from './galaxy.wgsl?raw';
import noiseSource from './noise.wgsl?raw';
import { seedUnit } from '../lib/hash';
import {
  focalLength,
  precisionReport,
  type PrecisionMode,
  type PrecisionProbe,
  type PrecisionReport,
} from '../frame/precision-probe';
import type { Camera } from '../state/url-state';
import type {
  Galaxy,
  GalaxyTier,
} from '../universe/galaxy';
import type { StarSystem } from '../universe/system';
import { displayOrbitRadius } from '../universe/system';
import { cameraBasis, FOV_Y_RAD } from '../render/camera';
import { buildSceneFrame, displayScaleM, type SceneFrame } from '../render/system-scene';
import {
  GALAXY_GAIN,
  GALAXY_INSTANCE_FLOATS,
  GALAXY_MAX_INSTANCES,
  WATCHDOG_FRAME_MS,
  galaxyLegibility,
  nextQualityTier,
  writeGalaxyFrame,
  type GalaxyFrame,
} from '../render/galaxy-scene';
import { createOrbitRing, createSphere } from './mesh';

export interface RenderStats {
  fps: number;
  /** Seconds since the epoch, as used by the shader this frame. */
  time: number;
  frame: number;
}

export interface RenderSample {
  mean: number;
  stdev: number;
  samples: number;
}

export interface RendererOptions {
  device: GPUDevice;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
  canvas: HTMLCanvasElement;
  seed: string;
  camera: Camera;
  /** The scene drawn when no probe is active. */
  system: StarSystem | null;
  /** The galaxy drawn behind the system. Null in probe mode or when there is no system. */
  galaxy: Galaxy | null;
  /** The initial impostor budget; the watchdog may drop it. */
  galaxyTier: GalaxyTier;
  /** When set, the frame draws the precision probe instead of the starfield. */
  precision: PrecisionProbe | null;
  /** Which path the probe uses to build its camera-relative positions. */
  precisionMode: PrecisionMode;
  getTime(): number;
  onFirstFrame(): void;
  onStats(stats: RenderStats): void;
  onPipeline(generation: number, error: string | null): void;
  /** The watchdog gave up a tier; the UI can say so once. */
  onTierDrop?(tier: GalaxyTier): void;
}

export interface RendererHandle {
  readonly frame: number;
  readonly pipelineGeneration: number;
  readonly fps: number;
  /** The impostor budget in use; the watchdog may lower it. */
  readonly galaxyTier: GalaxyTier;
  /** Marker pixels and positional error for both precision paths, at the current CSS size. */
  precisionReport(): PrecisionReport | null;
  /** The last scene frame, for the HUD's scale readout. Null in probe mode. */
  sceneFrame(): SceneFrame | null;
  /** The last galaxy frame's crossfade, count and measured contrast, for evidence. */
  galaxyFrame(): GalaxyFrame | null;
  /** Render one deterministic frame offscreen and read it back. Used as capture evidence. */
  sampleFrame(): Promise<RenderSample>;
  /** Debug only: stall the next N frames so the watchdog's tier drop can be observed. */
  forceSlowFrames(frames: number): void;
  dispose(): void;
}

/** 28 floats: header (12), three probe markers (12), probe meta (4). */
const PARAMS_BYTES = 112;
const PARAMS_FLOATS = PARAMS_BYTES / 4;

/** 48 floats: view-projection (16), star (8), billboard basis (8), meta (4), lod meta (4). */
const SCENE_FLOATS = 48;
const SCENE_BYTES = SCENE_FLOATS * 4;

/** 28 floats: view-projection (16), camera basis (8), meta (4). */
const GALAXY_FLOATS = 28;
const GALAXY_BYTES = GALAXY_FLOATS * 4;

/** Per planet: centre+radius, colour+atmosphere, tilt+spin+seed+class, detail. */
const INSTANCE_FLOATS = 16;
const MAX_PLANETS = 16;
const DEPTH_FORMAT: GPUTextureFormat = 'depth32float';
/** Straight alpha for the two system passes the crossfade fades out. */
const ALPHA_BLEND: GPUBlendState = {
  color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
  alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
};
const ORBIT_SEGMENTS = 160;
const SAMPLE_WIDTH = 640;
const GALAXY_HDR_FORMAT: GPUTextureFormat = 'rgba16float';

type Reload = {
  sky?: (source: string) => Promise<void>;
  scene?: (source: string) => Promise<void>;
  galaxy?: (source: string) => Promise<void>;
};

let activeReload: Reload | null = null;

export async function createRenderer(options: RendererOptions): Promise<RendererHandle> {
  const { device, context, format, canvas, camera } = options;
  const seed = seedUnit(options.seed);

  const params = new Float32Array(PARAMS_FLOATS);
  const uniformBuffer = device.createBuffer({
    label: 'stage0 params',
    size: PARAMS_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const sceneParams = new Float32Array(SCENE_FLOATS);
  const sceneUniform = device.createBuffer({
    label: 'scene params',
    size: SCENE_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // ---- Galaxy (impostor field) ---------------------------------------------
  const galaxyParams = new Float32Array(GALAXY_FLOATS);
  const galaxyUniform = device.createBuffer({
    label: 'galaxy params',
    size: GALAXY_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const galaxyInstanceData = new Float32Array(GALAXY_MAX_INSTANCES * GALAXY_INSTANCE_FLOATS);
  const galaxyInstanceBuffer = device.createBuffer({
    label: 'galaxy instances',
    size: Math.max(4, galaxyInstanceData.byteLength),
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });

  // ---- Sky (starfield) ------------------------------------------------------
  let skyPipeline = await buildSkyPipeline(device, format, stage0Source);
  let skyBindGroup = createBindGroup(device, skyPipeline, uniformBuffer);

  // ---- Scene (system) -------------------------------------------------------
  const sceneModule = await compileModule(device, 'scene', noiseSource + sceneSource);
  const sphere = createSphere(48, 24);
  const sphereVertexBuffer = device.createBuffer({
    label: 'sphere vertices',
    size: sphere.vertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(sphereVertexBuffer, 0, sphere.vertices);
  const sphereIndexBuffer = device.createBuffer({
    label: 'sphere indices',
    size: sphere.indices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(sphereIndexBuffer, 0, sphere.indices);

  const instanceData = new Float32Array(MAX_PLANETS * INSTANCE_FLOATS);
  const instanceBuffer = device.createBuffer({
    label: 'planet instances',
    size: instanceData.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });

  const system = options.system;
  const orbitData = system ? buildOrbitVertices(system) : new Float32Array(0);
  // Four floats per vertex: xyz plus the ring radius the shader uses for visibility.
  const orbitVertexCount = orbitData.length / 4;
  const orbitBuffer = device.createBuffer({
    label: 'orbit rings',
    size: Math.max(4, orbitData.byteLength),
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  if (orbitData.byteLength > 0) device.queue.writeBuffer(orbitBuffer, 0, orbitData);

  const sceneLayout = device.createBindGroupLayout({
    label: 'scene layout',
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' },
      },
    ],
  });
  const scenePipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [sceneLayout] });
  const sceneBindGroup = device.createBindGroup({
    label: 'scene params',
    layout: sceneLayout,
    entries: [{ binding: 0, resource: { buffer: sceneUniform } }],
  });

  let planetPipeline = await buildPlanetPipeline(device, format, sceneModule, scenePipelineLayout);
  let starPipeline = await buildStarPipeline(device, format, sceneModule, scenePipelineLayout);
  let starCorePipeline = await buildStarCorePipeline(device, format, sceneModule, scenePipelineLayout);
  let orbitPipeline = await buildOrbitPipeline(device, format, sceneModule, scenePipelineLayout);

  // The galaxy accumulates additively into an offscreen rgba16float buffer, then composites onto
  // the swapchain with a soft-shoulder tone curve so Layer 1/2 scenes and the orrery are untouched.
  const galaxyLayout = device.createBindGroupLayout({
    label: 'galaxy layout',
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' },
      },
    ],
  });
  const galaxyCompositeTexLayout = device.createBindGroupLayout({
    label: 'galaxy hdr texture layout',
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'unfilterable-float' },
      },
    ],
  });
  const galaxyPipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [galaxyLayout],
  });
  const galaxyCompositePipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [galaxyLayout, galaxyCompositeTexLayout],
  });
  const galaxyBindGroup = device.createBindGroup({
    label: 'galaxy params',
    layout: galaxyLayout,
    entries: [{ binding: 0, resource: { buffer: galaxyUniform } }],
  });
  let { galaxyPipeline, galaxyCompositePipeline } = await buildGalaxyPipelines(
    device,
    format,
    galaxySource,
    galaxyPipelineLayout,
    galaxyCompositePipelineLayout,
  );

  let depth: GPUTexture | null = null;
  let galaxyHdr: GPUTexture | null = null;
  let galaxyHdrBindGroup: GPUBindGroup | null = null;
  let generation = 1;
  let frame = 0;
  let fps = 0;
  let framesSinceStats = 0;
  let lastStatsAt = performance.now();
  let disposed = false;
  let raf = 0;
  let reloadToken = 0;
  let lastScene: SceneFrame | null = null;
  let lastGalaxy: GalaxyFrame | null = null;
  let lastGalaxyKey = '';
  let qualityTier = options.galaxyTier;
  let debugSlowFrames = 0;
  let lastFrameAt = 0;
  let frameMsEma = 0;
  let longFrameCount = 0;

  options.onPipeline(generation, null);

  function writeParams(time: number, width: number, height: number): void {
    params[0] = width;
    params[1] = height;
    params[2] = time;
    params[3] = seed;
    params[4] = camera.x;
    params[5] = camera.y;
    params[6] = camera.z;
    params[7] = 0;
    params[8] = camera.yaw;
    params[9] = camera.pitch;
    params[10] = 0;
    params[11] = 0;

    // Probe markers arrive as camera-relative float32: the CPU has already done the double
    // subtraction. Nothing absolute is written here, and nothing in this file can write one.
    const probe = options.precision;
    const view = probe ? probe.paths[options.precisionMode].view : [];
    for (let index = 0; index < 3; index += 1) {
      const point = view[index];
      params[12 + index * 4] = point?.x ?? 0;
      params[13 + index * 4] = point?.y ?? 0;
      params[14 + index * 4] = point?.z ?? 0;
      params[15 + index * 4] = 0;
    }
    params[24] = probe ? 1 : 0;
    params[25] = focalLength();
    // Rings are drawn in device pixels; scaling by DPR keeps them the same CSS size on a
    // 2× display, where the reported spread is measured.
    params[26] = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
    params[27] = 0;

    device.queue.writeBuffer(uniformBuffer, 0, params);
  }

  function writeGalaxy(time: number, width: number, height: number): GalaxyFrame | null {
    const galaxy = options.galaxy;
    if (!galaxy) {
      lastGalaxy = null;
      lastGalaxyKey = '';
      return null;
    }

    // The galaxy is static; the buffer only changes when the camera, viewport or budget does.
    // Repacking it every idle frame would be wasted upload bandwidth and CPU.
    const key = `${camera.x},${camera.y},${camera.z},${camera.yaw},${camera.pitch},${width},${height},${qualityTier}`;
    if (key !== lastGalaxyKey || !lastGalaxy) {
      const aspect = width / Math.max(1, height);
      const scaleM = system ? displayScaleM(system) : 1;
      const legibility = galaxyLegibility(galaxy, camera, height);
      const next = writeGalaxyFrame(
        galaxyInstanceData,
        galaxy,
        qualityTier,
        camera,
        scaleM,
        height,
        aspect,
        legibility,
      );

      galaxyParams.set(next.viewProjection, 0);
      galaxyParams[16] = next.cameraRight.x;
      galaxyParams[17] = next.cameraRight.y;
      galaxyParams[18] = next.cameraRight.z;
      galaxyParams[19] = 0;
      galaxyParams[20] = next.cameraUp.x;
      galaxyParams[21] = next.cameraUp.y;
      galaxyParams[22] = next.cameraUp.z;
      galaxyParams[23] = 0;
      galaxyParams[24] = next.lod;
      galaxyParams[25] = GALAXY_GAIN;
      galaxyParams[26] = next.exposure;
      galaxyParams[27] = time;
      device.queue.writeBuffer(galaxyUniform, 0, galaxyParams);
      if (next.count > 0) {
        device.queue.writeBuffer(
          galaxyInstanceBuffer,
          0,
          next.instances,
          0,
          next.count * GALAXY_INSTANCE_FLOATS,
        );
      }

      lastGalaxy = next;
      lastGalaxyKey = key;
    }

    return lastGalaxy;
  }

  function writeScene(
    time: number,
    width: number,
    height: number,
    lod: number,
  ): SceneFrame | null {
    if (!system) return null;
    const aspect = width / Math.max(1, height);
    const scene = buildSceneFrame(system, camera, time, aspect, height, lod);
    lastScene = scene;

    sceneParams.set(scene.viewProjection, 0);
    sceneParams[16] = scene.starCenter.x;
    sceneParams[17] = scene.starCenter.y;
    sceneParams[18] = scene.starCenter.z;
    sceneParams[19] = scene.starRadius;
    sceneParams[20] = scene.starColor[0];
    sceneParams[21] = scene.starColor[1];
    sceneParams[22] = scene.starColor[2];
    // The opaque core's radius; the shader uses it both to size the occluding disc and to keep
    // the additive corona from double-brightening it.
    sceneParams[23] = scene.starCoreRadius;

    const basis = cameraBasis(camera.yaw, camera.pitch);
    sceneParams[24] = basis.right.x;
    sceneParams[25] = basis.right.y;
    sceneParams[26] = basis.right.z;
    sceneParams[27] = 0;
    sceneParams[28] = basis.up.x;
    sceneParams[29] = basis.up.y;
    sceneParams[30] = basis.up.z;
    sceneParams[31] = 0;

    sceneParams[32] = time;
    sceneParams[33] = scene.planets.length;
    sceneParams[34] = scene.nearUnits;
    sceneParams[35] = aspect;
    // The one crossfade value every pipeline consumes (issue 04 D4).
    sceneParams[36] = scene.lod;
    sceneParams[37] = height / (2 * Math.tan(FOV_Y_RAD / 2));
    sceneParams[38] = 0;
    sceneParams[39] = 0;
    device.queue.writeBuffer(sceneUniform, 0, sceneParams);

    const count = Math.min(scene.planets.length, MAX_PLANETS);
    instanceData.fill(0);
    // Pixels per display unit at distance 1, so a body's on-screen radius is a division away.
    const focalPx = height / (2 * Math.tan(FOV_Y_RAD / 2));
    for (let index = 0; index < count; index += 1) {
      const planet = scene.planets[index]!;
      const base = index * INSTANCE_FLOATS;
      instanceData[base + 0] = planet.center.x;
      instanceData[base + 1] = planet.center.y;
      instanceData[base + 2] = planet.center.z;
      instanceData[base + 3] = planet.radius;
      instanceData[base + 4] = planet.color[0];
      instanceData[base + 5] = planet.color[1];
      instanceData[base + 6] = planet.color[2];
      instanceData[base + 7] = planet.atmosphere;
      instanceData[base + 8] = planet.tiltRad;
      instanceData[base + 9] = planet.spinRad;
      instanceData[base + 10] = planet.surfaceSeed;
      instanceData[base + 11] = planet.surfaceClass;
      // Detail: how many pixels this world covers. Relief shading scales with it — little at
      // thumbnail size, where it would only add speckle, and full strength at ~42 px of radius.
      const distance = Math.max(1e-9, Math.hypot(planet.center.x, planet.center.y, planet.center.z));
      const radiusPx = (planet.radius / distance) * focalPx;
      instanceData[base + 12] = Math.min(1, Math.max(0, radiusPx / 42));
    }
    if (count > 0) device.queue.writeBuffer(instanceBuffer, 0, instanceData, 0, count * INSTANCE_FLOATS);

    return scene;
  }

  function ensureDepth(width: number, height: number): GPUTexture {
    if (!depth || depth.width !== width || depth.height !== height) {
      depth?.destroy();
      depth = device.createTexture({
        label: 'depth',
        size: [width, height],
        format: DEPTH_FORMAT,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
    }
    return depth;
  }

  function ensureGalaxyHdr(
    width: number,
    height: number,
  ): { texture: GPUTexture; bindGroup: GPUBindGroup } {
    if (!galaxyHdr || !galaxyHdrBindGroup || galaxyHdr.width !== width || galaxyHdr.height !== height) {
      galaxyHdr?.destroy();
      galaxyHdr = device.createTexture({
        label: 'galaxy hdr',
        size: [width, height],
        format: GALAXY_HDR_FORMAT,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      galaxyHdrBindGroup = device.createBindGroup({
        label: 'galaxy hdr view',
        layout: galaxyCompositeTexLayout,
        entries: [{ binding: 0, resource: galaxyHdr.createView() }],
      });
    }
    return { texture: galaxyHdr, bindGroup: galaxyHdrBindGroup };
  }

  function encodePass(
    encoder: GPUCommandEncoder,
    view: GPUTextureView,
    depthView: GPUTextureView,
    hdrView: GPUTextureView | null,
    hdrBindGroup: GPUBindGroup | null,
  ): void {
    if (lastGalaxy && lastGalaxy.count > 0 && hdrView) {
      const hdrPass = encoder.beginRenderPass({
        label: 'galaxy hdr pass',
        colorAttachments: [
          {
            view: hdrView,
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      });
      hdrPass.setPipeline(galaxyPipeline);
      hdrPass.setBindGroup(0, galaxyBindGroup);
      hdrPass.setVertexBuffer(0, galaxyInstanceBuffer);
      hdrPass.draw(6, lastGalaxy.count);
      hdrPass.end();
    }

    const pass = encoder.beginRenderPass({
      label: 'stage0 pass',
      colorAttachments: [
        {
          view,
          clearValue: { r: 0.012, g: 0.016, b: 0.028, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
      // Reverse-Z: clear to 0 (infinity) and keep what is nearer.
      depthStencilAttachment: {
        view: depthView,
        depthClearValue: 0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });

    pass.setPipeline(skyPipeline);
    pass.setBindGroup(0, skyBindGroup);
    pass.draw(3);

    // Composite the tone-mapped galaxy HDR buffer additively over the sky before the orrery.
    if (lastGalaxy && lastGalaxy.count > 0 && hdrBindGroup) {
      pass.setPipeline(galaxyCompositePipeline);
      pass.setBindGroup(0, galaxyBindGroup);
      pass.setBindGroup(1, hdrBindGroup);
      pass.draw(3);
    }

    if (system && lastScene) {
      // Orbits first, so the star's glare sits over them and the planets occlude both.
      if (orbitVertexCount > 0) {
        pass.setPipeline(orbitPipeline);
        pass.setBindGroup(0, sceneBindGroup);
        pass.setVertexBuffer(0, orbitBuffer);
        pass.draw(orbitVertexCount);
      }

      // The opaque core first: it writes depth, so it is the star's occluder. The additive
      // corona is drawn second and skips the core's radius in the fragment shader.
      pass.setPipeline(starCorePipeline);
      pass.setBindGroup(0, sceneBindGroup);
      pass.draw(6);

      pass.setPipeline(starPipeline);
      pass.setBindGroup(0, sceneBindGroup);
      pass.draw(6);

      pass.setPipeline(planetPipeline);
      pass.setBindGroup(0, sceneBindGroup);
      pass.setVertexBuffer(0, sphereVertexBuffer);
      pass.setIndexBuffer(sphereIndexBuffer, 'uint16');
      pass.setVertexBuffer(1, instanceBuffer);
      pass.drawIndexed(sphere.indexCount, Math.min(lastScene.planets.length, MAX_PLANETS));
    }

    pass.end();
  }

  function resize(): void {
    const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
    const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  window.addEventListener('resize', resize);
  resize();

  async function reloadSky(source: string): Promise<void> {
    const token = ++reloadToken;
    try {
      const next = await buildSkyPipeline(device, format, source);
      if (disposed || token !== reloadToken) return;
      skyPipeline = next;
      skyBindGroup = createBindGroup(device, skyPipeline, uniformBuffer);
      generation += 1;
      options.onPipeline(generation, null);
      console.info(`[ugb] stage0 rebuilt → pipeline generation ${generation}`);
    } catch (error) {
      if (disposed || token !== reloadToken) return;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[ugb] stage0 rebuild failed; previous pipeline is still live.\n${message}`);
      options.onPipeline(generation, message);
    }
  }

  async function reloadScene(source: string): Promise<void> {
    const token = ++reloadToken;
    try {
      const module = await compileModule(device, 'scene', noiseSource + source);
      const nextPlanet = await buildPlanetPipeline(device, format, module, scenePipelineLayout);
      const nextStar = await buildStarPipeline(device, format, module, scenePipelineLayout);
      const nextStarCore = await buildStarCorePipeline(device, format, module, scenePipelineLayout);
      const nextOrbit = await buildOrbitPipeline(device, format, module, scenePipelineLayout);
      if (disposed || token !== reloadToken) return;
      planetPipeline = nextPlanet;
      starPipeline = nextStar;
      starCorePipeline = nextStarCore;
      orbitPipeline = nextOrbit;
      generation += 1;
      options.onPipeline(generation, null);
      console.info(`[ugb] scene rebuilt → pipeline generation ${generation}`);
    } catch (error) {
      if (disposed || token !== reloadToken) return;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[ugb] scene rebuild failed; previous pipeline is still live.\n${message}`);
      options.onPipeline(generation, message);
    }
  }

  async function reloadGalaxy(source: string): Promise<void> {
    const token = ++reloadToken;
    try {
      const next = await buildGalaxyPipelines(
        device,
        format,
        source,
        galaxyPipelineLayout,
        galaxyCompositePipelineLayout,
      );
      if (disposed || token !== reloadToken) return;
      galaxyPipeline = next.galaxyPipeline;
      galaxyCompositePipeline = next.galaxyCompositePipeline;
      generation += 1;
      options.onPipeline(generation, null);
      console.info(`[ugb] galaxy rebuilt → pipeline generation ${generation}`);
    } catch (error) {
      if (disposed || token !== reloadToken) return;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[ugb] galaxy rebuild failed; previous pipeline is still live.\n${message}`);
      options.onPipeline(generation, message);
    }
  }

  activeReload = { sky: reloadSky, scene: reloadScene, galaxy: reloadGalaxy };

  function render(now: number): void {
    if (disposed) return;
    raf = requestAnimationFrame(render);

    // Frame-time watchdog (issue 04 D6): a sustained long frame costs the rich tier instead of
    // stalling into a TDR. The EMA ignores the one huge gap a backgrounded tab produces.
    if (lastFrameAt > 0) {
      const delta = now - lastFrameAt;
      if (delta > 0 && delta < 500) {
        frameMsEma = frameMsEma === 0 ? delta : frameMsEma * 0.9 + delta * 0.1;
      }
    }
    lastFrameAt = now;
    if (frameMsEma > WATCHDOG_FRAME_MS) longFrameCount += 1;
    else longFrameCount = 0;
    const dropped = nextQualityTier(qualityTier, frameMsEma, longFrameCount);
    if (dropped) {
      qualityTier = dropped;
      longFrameCount = 0;
      // Force the next frame to repack at the smaller, prefix-only count.
      lastGalaxyKey = '';
      options.onTierDrop?.(dropped);
    }

    if (debugSlowFrames > 0) {
      // Debug evidence only: make this frame cost ~45 ms so the watchdog has something to see.
      const until = performance.now() + 45;
      while (performance.now() < until) {
        // busy-wait, deliberately
      }
      debugSlowFrames -= 1;
    }

    const time = options.getTime();
    writeParams(time, canvas.width, canvas.height);
    const galaxyFrame = writeGalaxy(time, canvas.width, canvas.height);
    writeScene(time, canvas.width, canvas.height, galaxyFrame?.lod ?? 0);

    const encoder = device.createCommandEncoder({ label: 'stage0 frame' });
    const depthTexture = ensureDepth(canvas.width, canvas.height);
    const hdr = galaxyFrame && galaxyFrame.count > 0 ? ensureGalaxyHdr(canvas.width, canvas.height) : null;
    encodePass(
      encoder,
      context.getCurrentTexture().createView(),
      depthTexture.createView(),
      hdr ? hdr.texture.createView() : null,
      hdr ? hdr.bindGroup : null,
    );
    device.queue.submit([encoder.finish()]);

    frame += 1;
    if (frame === 1) options.onFirstFrame();

    framesSinceStats += 1;
    const elapsed = now - lastStatsAt;
    if (elapsed >= 250) {
      fps = (framesSinceStats * 1000) / elapsed;
      framesSinceStats = 0;
      lastStatsAt = now;
      options.onStats({ fps, time, frame });
    }
  }

  function precisionReportAt(): PrecisionReport | null {
    const probe = options.precision;
    if (!probe) return null;
    return precisionReport(probe, canvas.clientWidth, canvas.clientHeight);
  }

  async function sampleFrame(): Promise<RenderSample> {
    if (disposed) throw new Error('The renderer has been disposed.');

    const width = Math.max(1, Math.min(canvas.width, SAMPLE_WIDTH));
    const height = Math.max(1, Math.round((width * canvas.height) / Math.max(1, canvas.width)));
    const bytesPerRow = Math.ceil((width * 4) / 256) * 256;

    // Every resource is created inside the try: a failure anywhere below (a lost device, a
    // validation error in encodePass or submit) then still reaches the finally and releases
    // whatever had already been allocated.
    let texture: GPUTexture | undefined;
    let sampleDepth: GPUTexture | undefined;
    let sampleGalaxyHdr: GPUTexture | undefined;
    let readback: GPUBuffer | undefined;

    try {
      texture = device.createTexture({
        label: 'stage0 sample',
        size: [width, height],
        format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });
      sampleDepth = device.createTexture({
        label: 'sample depth',
        size: [width, height],
        format: DEPTH_FORMAT,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
      sampleGalaxyHdr = device.createTexture({
        label: 'sample galaxy hdr',
        size: [width, height],
        format: GALAXY_HDR_FORMAT,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      const sampleGalaxyBindGroup = device.createBindGroup({
        label: 'sample galaxy hdr view',
        layout: galaxyCompositeTexLayout,
        entries: [{ binding: 0, resource: sampleGalaxyHdr.createView() }],
      });
      readback = device.createBuffer({
        label: 'stage0 readback',
        size: bytesPerRow * height,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });

      const encoder = device.createCommandEncoder({ label: 'stage0 sample' });
      const time = options.getTime();
      writeParams(time, width, height);
      const galaxyFrame = writeGalaxy(time, width, height);
      writeScene(time, width, height, galaxyFrame?.lod ?? 0);
      encodePass(
        encoder,
        texture.createView(),
        sampleDepth.createView(),
        sampleGalaxyHdr.createView(),
        sampleGalaxyBindGroup,
      );
      encoder.copyTextureToBuffer(
        { texture },
        { buffer: readback, bytesPerRow },
        { width, height },
      );
      device.queue.submit([encoder.finish()]);

      await readback.mapAsync(GPUMapMode.READ);
      const bytes = new Uint8Array(readback.getMappedRange());
      const bgra = format.startsWith('bgra');

      let sum = 0;
      let sumSquares = 0;
      let samples = 0;
      for (let y = 0; y < height; y += 1) {
        const rowStart = y * bytesPerRow;
        for (let x = 0; x < width; x += 1) {
          const offset = rowStart + x * 4;
          const c0 = bytes[offset] ?? 0;
          const c1 = bytes[offset + 1] ?? 0;
          const c2 = bytes[offset + 2] ?? 0;
          const red = bgra ? c2 : c0;
          const blue = bgra ? c0 : c2;
          const luminance = (red * 0.2126 + c1 * 0.7152 + blue * 0.0722) / 255;
          sum += luminance;
          sumSquares += luminance * luminance;
          samples += 1;
        }
      }

      const mean = samples > 0 ? sum / samples : 0;
      const variance = samples > 0 ? Math.max(0, sumSquares / samples - mean * mean) : 0;
      return { mean, stdev: Math.sqrt(variance), samples };
    } finally {
      readback?.unmap();
      readback?.destroy();
      texture?.destroy();
      sampleDepth?.destroy();
      sampleGalaxyHdr?.destroy();
    }
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(raf);
    resizeObserver.disconnect();
    window.removeEventListener('resize', resize);
    depth?.destroy();
    galaxyHdr?.destroy();
    uniformBuffer.destroy();
    sceneUniform.destroy();
    galaxyUniform.destroy();
    galaxyInstanceBuffer.destroy();
    sphereVertexBuffer.destroy();
    sphereIndexBuffer.destroy();
    instanceBuffer.destroy();
    orbitBuffer.destroy();
    if (activeReload && activeReload.sky === reloadSky) activeReload = null;
  }

  raf = requestAnimationFrame(render);

  return {
    get frame() {
      return frame;
    },
    get pipelineGeneration() {
      return generation;
    },
    get fps() {
      return fps;
    },
    get galaxyTier() {
      return qualityTier;
    },
    precisionReport: precisionReportAt,
    sceneFrame: () => lastScene,
    galaxyFrame: () => lastGalaxy,
    forceSlowFrames(frames: number) {
      debugSlowFrames = Math.max(0, Math.floor(frames));
    },
    sampleFrame,
    dispose,
  };
}

function buildOrbitVertices(system: StarSystem): Float32Array {
  const rings = system.planets.map((planet) =>
    createOrbitRing(displayOrbitRadius(planet, system), ORBIT_SEGMENTS),
  );
  const total = rings.reduce((sum, ring) => sum + ring.length, 0);
  const data = new Float32Array(total);
  let offset = 0;
  for (const ring of rings) {
    data.set(ring, offset);
    offset += ring.length;
  }
  return data;
}

function createBindGroup(
  device: GPUDevice,
  pipeline: GPURenderPipeline,
  uniformBuffer: GPUBuffer,
): GPUBindGroup {
  return device.createBindGroup({
    label: 'stage0 params',
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });
}

async function compileModule(
  device: GPUDevice,
  label: string,
  source: string,
): Promise<GPUShaderModule> {
  device.pushErrorScope('validation');
  const module = device.createShaderModule({ label, code: source });
  const moduleError = await device.popErrorScope();
  if (moduleError) throw new Error(`WGSL compilation failed:\n${moduleError.message}`);

  const info = await module.getCompilationInfo();
  const errors = info.messages.filter((message) => message.type === 'error');
  if (errors.length > 0) {
    const detail = errors
      .map((message) => `line ${message.lineNum}:${message.linePos} — ${message.message}`)
      .join('\n');
    throw new Error(`WGSL compilation failed:\n${detail}`);
  }
  return module;
}

async function guardPipeline(
  device: GPUDevice,
  what: string,
  build: () => Promise<GPURenderPipeline>,
): Promise<GPURenderPipeline> {
  device.pushErrorScope('validation');
  try {
    const pipeline = await build();
    const error = await device.popErrorScope();
    if (error) throw new Error(`Pipeline creation failed (${what}):\n${error.message}`);
    return pipeline;
  } catch (error) {
    await device.popErrorScope().catch(() => null);
    throw error;
  }
}

async function buildSkyPipeline(
  device: GPUDevice,
  format: GPUTextureFormat,
  source: string,
): Promise<GPURenderPipeline> {
  const module = await compileModule(device, 'stage0', noiseSource + source);
  return guardPipeline(device, 'sky', () =>
    device.createRenderPipelineAsync({
      label: 'stage0',
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
      // The sky is behind everything: it writes no depth, and tests nothing.
      depthStencil: {
        format: DEPTH_FORMAT,
        depthWriteEnabled: false,
        depthCompare: 'always',
      },
    }),
  );
}

/**
 * One instanced additive pass for the whole galaxy. There is no vertex buffer: the six corners
 * are generated in the shader from the camera basis, and each instance carries only a
 * camera-relative centre, a world-space radius and a colour/reveal. The pass writes no depth and
 * tests none, because it is behind the orrery and is drawn before it.
 */
/**
 * Two-stage galaxy pass: accumulate instanced additive impostors into an `rgba16float` HDR
 * texture, then composite additively onto the swapchain through a soft-shoulder tone curve.
 */
async function buildGalaxyPipelines(
  device: GPUDevice,
  format: GPUTextureFormat,
  source: string,
  layout: GPUPipelineLayout,
  compositeLayout: GPUPipelineLayout,
): Promise<{ galaxyPipeline: GPURenderPipeline; galaxyCompositePipeline: GPURenderPipeline }> {
  const module = await compileModule(device, 'galaxy', source);
  const galaxyPipeline = await guardPipeline(device, 'galaxy', () =>
    device.createRenderPipelineAsync({
      label: 'galaxy impostors',
      layout,
      vertex: {
        module,
        entryPoint: 'vs_star',
        buffers: [
          {
            arrayStride: GALAXY_INSTANCE_FLOATS * 4,
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              { shaderLocation: 1, offset: 3 * 4, format: 'float32' },
              { shaderLocation: 2, offset: 4 * 4, format: 'float32x4' },
            ],
          },
        ],
      },
      fragment: {
        module,
        entryPoint: 'fs_star',
        targets: [
          {
            format: GALAXY_HDR_FORMAT,
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
    }),
  );
  const galaxyCompositePipeline = await guardPipeline(device, 'galaxy composite', () =>
    device.createRenderPipelineAsync({
      label: 'galaxy composite',
      layout: compositeLayout,
      vertex: { module, entryPoint: 'vs_composite' },
      fragment: {
        module,
        entryPoint: 'fs_composite',
        targets: [
          {
            format,
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: false, depthCompare: 'always' },
    }),
  );
  return { galaxyPipeline, galaxyCompositePipeline };
}

async function buildPlanetPipeline(
  device: GPUDevice,
  format: GPUTextureFormat,
  module: GPUShaderModule,
  layout: GPUPipelineLayout,
): Promise<GPURenderPipeline> {
  return guardPipeline(device, 'planet', () =>
    device.createRenderPipelineAsync({
      label: 'planet',
      layout,
      vertex: {
        module,
        entryPoint: 'vs_planet',
        buffers: [
          {
            arrayStride: 6 * 4,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              { shaderLocation: 1, offset: 3 * 4, format: 'float32x3' },
            ],
          },
          {
            arrayStride: INSTANCE_FLOATS * 4,
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 2, offset: 0, format: 'float32x4' },
              { shaderLocation: 3, offset: 4 * 4, format: 'float32x4' },
              { shaderLocation: 4, offset: 8 * 4, format: 'float32x4' },
              { shaderLocation: 5, offset: 12 * 4, format: 'float32x4' },
            ],
          },
        ],
      },
      fragment: { module, entryPoint: 'fs_planet', targets: [{ format, blend: ALPHA_BLEND }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      // Reverse-Z: nearer means a larger depth value.
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'greater' },
    }),
  );
}

async function buildStarPipeline(
  device: GPUDevice,
  format: GPUTextureFormat,
  module: GPUShaderModule,
  layout: GPUPipelineLayout,
): Promise<GPURenderPipeline> {
  return guardPipeline(device, 'star', () =>
    device.createRenderPipelineAsync({
      label: 'star corona',
      layout,
      vertex: { module, entryPoint: 'vs_star' },
      fragment: {
        module,
        entryPoint: 'fs_star',
        targets: [
          {
            format,
            // Additive: the corona is glare. The opaque part is the core pass below.
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: false, depthCompare: 'always' },
    }),
  );
}

/**
 * The star's opaque core. It is drawn before the corona and the planets, and it is the only part
 * of the star that touches the depth buffer — that is what stops a planet behind the sun from
 * painting over it. It is deliberately a smaller quad than the glare: a depth-writing billboard
 * at the full glare radius would also clip anything nearer than the star's plane, and the dim
 * outer halo is not opaque to begin with.
 */
async function buildStarCorePipeline(
  device: GPUDevice,
  format: GPUTextureFormat,
  module: GPUShaderModule,
  layout: GPUPipelineLayout,
): Promise<GPURenderPipeline> {
  return guardPipeline(device, 'star core', () =>
    device.createRenderPipelineAsync({
      label: 'star core',
      layout,
      vertex: { module, entryPoint: 'vs_star_core' },
      fragment: { module, entryPoint: 'fs_star_core', targets: [{ format, blend: ALPHA_BLEND }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'greater' },
    }),
  );
}

async function buildOrbitPipeline(
  device: GPUDevice,
  format: GPUTextureFormat,
  module: GPUShaderModule,
  layout: GPUPipelineLayout,
): Promise<GPURenderPipeline> {
  return guardPipeline(device, 'orbit', () =>
    device.createRenderPipelineAsync({
      label: 'orbit',
      layout,
      vertex: {
        module,
        entryPoint: 'vs_orbit',
        buffers: [
          {
            arrayStride: 4 * 4,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              // The ring's radius, for the "is the eye outside this ring?" test.
              { shaderLocation: 1, offset: 3 * 4, format: 'float32' },
            ],
          },
        ],
      },
      fragment: {
        module,
        entryPoint: 'fs_orbit',
        targets: [
          {
            format,
            blend: {
              color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            },
          },
        ],
      },
      primitive: { topology: 'line-list' },
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: false, depthCompare: 'greater' },
    }),
  );
}

if (import.meta.hot) {
  // Shader edits rebuild the pipeline only. The page, canvas and GPUDevice are untouched,
  // so a hot reload is cheaper than a page reload and cannot duplicate the device.
  import.meta.hot.accept('./stage0.wgsl?raw', (module) => {
    const source = (module as { default?: unknown } | undefined)?.default;
    if (typeof source === 'string') void activeReload?.sky?.(source);
  });
  import.meta.hot.accept('./scene.wgsl?raw', (module) => {
    const source = (module as { default?: unknown } | undefined)?.default;
    if (typeof source === 'string') void activeReload?.scene?.(source);
  });
  import.meta.hot.accept('./galaxy.wgsl?raw', (module) => {
    const source = (module as { default?: unknown } | undefined)?.default;
    if (typeof source === 'string') void activeReload?.galaxy?.(source);
  });
  // The noise module is shared, so an edit to it invalidates both pipelines.
  import.meta.hot.accept('./noise.wgsl?raw', () => {
    if (typeof stage0Source === 'string') void activeReload?.sky?.(stage0Source);
    if (typeof sceneSource === 'string') void activeReload?.scene?.(sceneSource);
  });
}