# 0022 — A light you can resolve is a place you can go

**Status:** accepted (2026-11-25, owner's model; the rule follows from coverage)
**Context:** ADR-0011 says *a drawn light is a rendered address* — every light the user can see is
somewhere they can go. That was written when the sky was the local star field. The owner's picture of
the universe makes the sky much deeper: distant galaxies are **legitimately indistinguishable from
stars**, because at sufficient distance a galaxy *is* a point source. Some of the brightest dots in a
night sky are galaxies; most of the faint ones are too, and you cannot tell which is which until you
look.

That is a feature, not a compromise: the ambiguity is what makes a sky read as deep rather than
painted. But it collides with ADR-0011 in a specific way, because the current background sky
(`stage0.wgsl`) draws **three discrete point layers at infinity** which have no address and cannot be
travelled to. A user cannot tell those dots from a reachable star, so tapping one and getting nothing
teaches them the sky is fake.

## Decision

**One object class, three appearances by distance — and every appearance you can resolve is a real,
reachable place.**

| Appearance | What the viewer sees | What it is |
| --- | --- | --- |
| **Resolved** | spiral arms, a bar, an elliptical glow — unmistakably a galaxy | a galaxy, close enough to show structure (the Andromeda tier) |
| **Smudge** | a small elongated blob; "is that a galaxy?" | a galaxy, mid-distance |
| **Point** | an ordinary dot, indistinguishable from a star | *either* a star *or* a distant galaxy — identity is unresolved |

The point tier is deliberately **ambiguous**, and it is the largest tier. Many of the dots overhead
are galaxies. Resolving one — by approaching it, or by hovering it — is the reward, and it is the
mechanism that makes the sky feel deep rather than finite.

**The exception is the diffuse backdrop, and it must stay diffuse.** A procedural infinity field may
exist as texture — faint wash, unresolved grain — but it may **not** draw discrete, clickable-looking
points, because those are promises the world cannot keep. If a dot is distinct enough to notice as an
object, it is an addressed object with a distance and a price.

## Consequences

- **The distant-galaxy population cannot live in the infinity sky.** `stage0.wgsl` is orientation-only
  by design (a position term breaks float precision and prints banding — documented in the shader), so
  anything placed there is permanently unreachable. Distant galaxies must therefore be **real addressed
  objects at real distances**, rendered as points when far. That is a population, not a texture.
- **The current background sky has a latent ADR-0011 inconsistency.** Its `far`/`middle`/`near` star
  layers are discrete points with no address. Either they are demoted to diffuse texture, or the ones
  bright enough to notice become real objects. Ticket 06 owns the decision; it is cheap now and
  expensive after a user has clicked one.
- **Identity becomes a first-class verb.** "What is that?" must have an answer — from the popup the
  owner asked for ("Galaxy X"), the compass, and eventually a click. A dot that cannot answer is a
  defect under this ADR.
- **The tone-curve ceiling applies only to the resolved tier.** ADR-0015's 0.79 cap exists so nothing
  outshines the home star; a resolved neighbour is a bright glow and must respect it. A point-tier
  galaxy is a *dot* at star brightness, so the ceiling is not the constraint there — being one pixel of
  honest light is.
- **Composition gets a job.** At galaxy zoom-out the frame holds a lot of free space around the disc.
  That space is not filler: it is where the smudge and point tiers live, and how densely it is
  populated is a direct lever on perceived scale (ADR-0020).