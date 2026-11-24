# Judge small features on a 1:1 crop, not the downscaled capture

Written 2026-11-24, against `tools/capture.mjs` and the 1920×1080 captures in `.scratch/captures/`.

## What happened

The first `layer3-sol-1080p` capture showed a star and what looked like **six** of Sol's eight
planets. In the full 1920×1080 image, Mercury and Venus sit 43 and 60 px from the star centre,
while the star's glare quad has a 63 px radius. The arithmetic said both were inside the glow, so
the conclusion "the corona swallows the inner planets" was written down - and a change to the
star's presentation radius was drafted to fix it.

A 1:1 crop of the inner region (600×400 around the star, scaled ×2 nearest-neighbour) showed all
**eight** bodies: the four inner worlds are clearly separated from the glow.

## Why the arithmetic misled

`STAR_DISPLAY_RADIUS` (0.135 display units) is the **bounding radius of the glare quad**, not the
radius at which the glow is visible. The glow is additive with a falloff that is much narrower in
practice, and the only part of the star that writes depth - and therefore the only part that can
hide a body - is `STAR_CORE_RADIUS` (0.041), well inside Mercury's drawn orbit (0.091 units at
Sol's 78:1 span).

So "orbit radius < glare radius" is not the same claim as "planet is hidden". Only the core
occludes.

The second half of the trap is the viewer: a 1920×1080 PNG is downscaled to fit the reading
window, so a 10 px planet is shown at ~5 px and a 60 px glow at ~30 px. At that size a visible
planet and a washed-out one are indistinguishable.

## What to do instead

Before calling any feature under ~15 px a defect, crop it at 1:1 and scale with nearest-neighbour.
PowerShell on Windows, using the .NET `System.Drawing` assembly already present:

```powershell
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile((Resolve-Path '.scratch/captures/layer3-sol-1080p.png'))
$rect = New-Object System.Drawing.Rectangle(675, 333, 600, 400)
$dst = New-Object System.Drawing.Bitmap(1200, 800)
$g = [System.Drawing.Graphics]::FromImage($dst)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
$g.DrawImage($src, (New-Object System.Drawing.Rectangle(0, 0, 1200, 800)), $rect,
  [System.Drawing.GraphicsUnit]::Pixel)
$dst.Save((Join-Path (Get-Location) '.scratch/sol-inner.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $dst.Dispose(); $src.Dispose()
```

Crop into `.scratch/`, not into the capture manifest: the manifest is for shots worth re-running,
and a clip shot costs a full render pass. Use `clip` in `capture/shots.json` only when the crop is
itself evidence that should be regenerated (the `layer3-arm-edge-2160p` and `layer3-home-star-1080p`
shots exist for that reason).

## The general rule

Two different questions, two different answers:

- *Is the body inside the glow quad's bounding radius?* - arithmetic, cheap, and says nothing about
  visibility.
- *Can the eye see it?* - pixels, at 1:1.

Do not change a presentation constant on the first answer alone.