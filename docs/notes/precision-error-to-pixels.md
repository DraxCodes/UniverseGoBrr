# Turning a positional error into pixels

**Written against:** the Layer 1 precision probe (ADR-0008), 2026-11-23.
**Demonstrated by:** `src/frame/precision-probe.ts`, `src/frame/precision-probe.test.ts`.

## The trap

A positional error in metres is **not** an angular error. Converting it needs the distance from
the camera to the thing being displaced, and for a collapse there is no such distance — the
object has been moved *onto the camera*.

The first version of the spike did this:

```js
pixels = (error / markerDistance) * (width / fovRadians);   // wrong twice
```

Two independent mistakes:

1. `width / fovRadians` is a small-angle approximation. The exact factor is
   `width / (2 * tan(fov / 2))`, which is ~15% larger at a 70° field of view. Fine for an order
   of magnitude, wrong for a reported number.
2. It divided by the **marker's own distance**, not by the depth at which the marker is
   projected. For a marker 1 km from the camera that had collapsed onto the camera, that
   produced "3,140 px" — a number with no referent, quoted in an early draft of ADR-0008 and
   then retracted.

## The rule

- **Depth is the camera-to-marker distance along the view axis**, never the size of the error
  and never the marker's 3D distance.
- **A collapse is not a pixel offset.** When the relative position rounds to zero, the object
  is drawn at the camera's position (screen centre, or behind the near plane). Say that. Any px
  figure is an artefact of a formula that assumes a separate, non-zero depth.
- The shader and the readout must use **one** focal constant. `params.probe_meta.y` carries
  `1 / tan(fov / 2)` from `focalLength()` so the drawn position and the reported position cannot
  drift apart.

```js
const focal = 1 / Math.tan((fovDegrees * Math.PI) / 360);
const ndcX = (view.x / view.z) * focal / (width / height);
const pxX = (ndcX * 0.5 + 0.5) * width;
```

## Why the probe can report a 0 m error

At a 10¹³ m frame origin a **double's** step is 2⁻⁹ m ≈ 1.95 mm, while float32's step at a
123 km relative offset is 2⁻⁷ m. Every double near 10¹³ is already a multiple of the coarser
float32 grid, so `Math.fround(relative)` is often **exact** and the fixed-path error is zero.

This is not a bug and not a rounding to hide: it is why the reported floor is the double's
step, not float32's. A test that expects a non-zero fixed error must pick a relative value
where the two grids disagree — the probe uses a depth of `1_300_000.123`, which lands
2 mm off the float32 grid, and `position.test.ts` asserts that case explicitly.

## Checking it

```sh
npm test                              # the arithmetic, including the negative control
npm run build && npm run capture       # the pixels, in .scratch/captures/
```

The harness fails `layer1-precision-naive` if the markers ever separate there: a passing naive
shot means the control no longer detects the bug, not that the bug is gone.