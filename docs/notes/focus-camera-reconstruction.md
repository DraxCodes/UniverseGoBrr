# Rebuilding a close-up camera from a shot

Written 2026-11-23 against commit state at Layer 2 (`SYSTEM_VERSION` 2). The script that
originally generated the `layer2-closeup-*` cameras was a throwaway and is gone, so the numbers
in `capture/shots.json` had to be re-derived. Written for the next agent who needs to move a
close-up camera (to show a terminator, a different hemisphere, a different body).

## The formula

A focus camera is the **planet's drawn position** plus an offset of **nine drawn radii**:

```
camera = displayPosition(planet, system, t)
       + 9 * displayBodyRadius(planet, system) * outermost.semiMajorAxisM * offsetDir
```

Two traps, both of which cost time:

1. **It is the drawn radius, not `planet.radiusM`.** The orrery inflates bodies: the gas giant `j`
   has `radiusM` 5.94×10⁷ m but a drawn radius of 9.11×10¹⁰ m (×1532). Nine *real* radii would put
   the camera 5×10⁸ m out and the disc would fill the frame. Check the ratio
   `offsetLen / drawnRadiusM` — it comes out at exactly 9.0 for an unclamped planet.
2. **`displayPosition`, not `planetPosition`.** Orbits are compressed (`a^0.55`), so the rendered
   position is the compressed one. `planetPosition` returns the *real* orbital radius and will put
   the camera in the wrong place (and the planet off-frame).

`offsetDir` has `y = sin(|pitch|)` and a horizontal part along the **anti-sun** direction
`-normalize(displayPosition)`, scaled by `cos(pitch)`. The camera looks back at the planet, so
`yaw = atan2(offsetDir.x, offsetDir.z)` in the `cameraBasis` convention (forward is
`(-sin yaw·cos pitch, sin pitch, -cos yaw·cos pitch)`).

Reproduce it in a throwaway vitest file (the modules are plain TS, no GPU needed):

```ts
const system = generateSystem('ugb-0000', parseAddressOrThrow('v1/4.-2.7'));
const planet = system.planets[8]!;
const drawn = displayPosition(planet, system, 1200);
```

## What the phase angle means here

Every shot the original script produced was **17° from the anti-sun direction** (measured:
`phaseCos` 0.9553 for all four). That is why every close-up is fully lit and the gas giant "had no
terminator": the camera was almost straight down the light, so the terminator sat on the limb and
fell outside the visible disc.

To show a terminator, rotate the horizontal part of `offsetDir` away from the anti-sun direction.
The phase angle *from the anti-sun* is `acos(cos(pitch) · cos α)` where `α` is the rotation of the
horizontal vector away from the anti-sun direction — so **with pitch ≠ 0 the phase is always larger
than α**. `α = 60°` at `pitch = 0.3` gives a ~62° phase: about 30 % of the disc in shadow.

`layer2-closeup-gas` now uses exactly that (`α ≈ 69°`, `pitch = +0.3`, phase ~69°), with the pitch
sign flipped so the camera sits below the equatorial plane and the storm at 26° south latitude is
visible instead of edge-on.

## The storm's visibility is computable, so compute it

`gas_albedo` places its storm by direction, not longitude:

```wgsl
stormDir = normalize(vec3(h1 - 0.5, (h2 - 0.5) * 0.7, h3 - 0.5))
  with hN = hash31(vec3(seed, ...))
```

`hash31` is 12 lines of arithmetic; reimplement it in the throwaway test and the resulting
`stormDir` can be dotted with the camera direction. A storm is visible when the dot is positive and
reads as a vortex (not a sliver) when it is above ~0.5. For this world the storm sits at 26° south,
so a camera above the equator caps out at dot 0.41 no matter the yaw; flipping the pitch to +0.3
raised it to 0.55. Placing a storm by hash and then framing blind is a coin flip — compute it.