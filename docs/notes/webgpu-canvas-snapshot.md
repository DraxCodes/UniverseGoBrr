# A WebGPU canvas reads back black through `createImageBitmap`

Written against Chrome 157, Layer 0 capture harness (2026-11-23).

## Symptom

`createImageBitmap(canvas)`, `drawImage(canvas, ...)` or `toDataURL()` on a canvas whose
context came from `canvas.getContext('webgpu')` returns an all-zero image. The page looks
correct and Playwright's `page.screenshot()` is fine, so only the "is it blank?" check fails.

## Cause

The compositor snapshot path does not see the WebGPU swap-chain contents the way it sees a
2D canvas. `context.getCurrentTexture()` is also not a durable snapshot: after presentation
the texture may be recycled or cleared. Sampling the canvas element is therefore not
evidence about what the render pass wrote.

## What to do instead

Read the pixels back on the GPU:

1. Render a deterministic frame into an offscreen texture with
   `GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC`.
2. `copyTextureToBuffer` with `bytesPerRow` rounded up to a multiple of **256**.
3. `mapAsync(GPUMapMode.READ)`, average only `width * 4` bytes of each row (skip the padding),
   then unmap and destroy both resources.

`sampleFrame()` in `src/gpu/renderer.ts` is the working version; the capture harness reaches
it through `window.__ugb.sampleCanvas()` and rejects a shot whose luminance `stdev` is too
low. Keep `page.screenshot()` for the actual image and the GPU readback for the blank check.