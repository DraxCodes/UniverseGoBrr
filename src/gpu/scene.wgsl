// The star system: lit planets, an emissive star billboard, and the orbit rings.
//
// Coordinates arrive **camera-relative** in display units (1 unit = the outermost orbit). The
// CPU has already subtracted the camera in double precision — nothing absolute is uploadable here,
// which is the point of ADR-0008. The camera sits at the origin looking down -z.
//
// Depth is reverse-Z: 1 at the near plane, 0 at infinity, compared with `greater`.
//
// Lighting happens in the planet's **local** frame. The vertex shader rotates the light and view
// directions *into* that frame, so the fragment can perturb the surface normal in the same space
// the surface pattern lives in. Doing it in world space would need the rotation matrix in the
// fragment, and a gradient sampled in one frame applied to a normal in another is how bump maps
// end up pointing the wrong way.

struct Scene {
  view_proj: mat4x4f,
  // xyz: camera-relative star centre; w: the star's drawn radius (the glare quad).
  star_center: vec4f,
  // rgb: the star's linear colour; w: the radius of the opaque core, in the same units. The
  // core is the part that writes depth, so it is the part that occludes.
  star_color: vec4f,
  // The billboard basis, so the star quad always faces the camera.
  camera_right: vec4f,
  camera_up: vec4f,
  // x: seconds, y: planet count, z: near plane, w: aspect.
  frame_meta: vec4f,
  // x: the shared crossfade `lod` (issue 04 D4), y: focal pixels, z: star minimum px, w: reserved.
  lod_meta: vec4f,
};

@group(0) @binding(0) var<uniform> scene: Scene;

struct PlanetOut {
  @builtin(position) position: vec4f,
  @location(0) color: vec3f,
  @location(1) atmosphere: f32,
  // Unit-sphere position before rotation: pattern coordinates fixed to the planet's surface, so
  // surface features ride the spin instead of sliding across it.
  @location(2) surface: vec3f,
  // x: per-planet seed, y: surface class (0 rock, 1 super-earth, 2 ice, 3 gas, 4 ocean),
  // z: detail 0..1, how many pixels this world covers — drives relief strength.
  @location(3) extras: vec3f,
  // Light and eye directions, rotated into the local frame.
  @location(4) light: vec3f,
  @location(5) view: vec3f,
  // The crossfade's opacity for this body: 1 in the orrery, 0 once the system is one point.
  @location(6) fade: f32,
};

// Inverse of the surface rotation (spin about y, then tilt about x).
fn to_local(v: vec3f, spin: f32, tilt: f32) -> vec3f {
  let ct = cos(-tilt);
  let st = sin(-tilt);
  let untilted = vec3f(v.x, ct * v.y - st * v.z, st * v.y + ct * v.z);
  let cs = cos(-spin);
  let ss = sin(-spin);
  return vec3f(cs * untilted.x + ss * untilted.z, untilted.y, -ss * untilted.x + cs * untilted.z);
}

@vertex
fn vs_planet(
  @location(0) local: vec3f,
  @location(1) local_normal: vec3f,
  @location(2) center_radius: vec4f,
  @location(3) color_atmosphere: vec4f,
  // Per-instance: tilt (x), spin (y), seed (z), class (w).
  @location(4) tilt_spin: vec4f,
  // Per-instance: detail (x).
  @location(5) extra: vec4f,
) -> PlanetOut {
  let spin = tilt_spin.y;
  let c = cos(spin);
  let s = sin(spin);
  let spun = vec3f(c * local.x + s * local.z, local.y, -s * local.x + c * local.z);

  let tilt = tilt_spin.x;
  let ct = cos(tilt);
  let st = sin(tilt);
  let tilted = vec3f(spun.x, ct * spun.y - st * spun.z, st * spun.y + ct * spun.z);

  let world = tilted * center_radius.w + center_radius.xyz;

  var out: PlanetOut;
  out.position = scene.view_proj * vec4f(world, 1.0);
  out.color = color_atmosphere.rgb;
  out.atmosphere = color_atmosphere.w;
  out.surface = local;
  out.extras = vec3f(tilt_spin.z, tilt_spin.w, extra.x);
  out.light = to_local(normalize(scene.star_center.xyz - world), spin, tilt);
  out.view = to_local(normalize(-world), spin, tilt);
  // The system's geometry fades inside the crossfade band; the star's glare keeps going as the
  // identity impostor. Order matters: it is the planets that must collapse first.
  out.fade = 1.0 - smoothstep(0.15, 0.55, scene.lod_meta.x);
  return out;
}

// --- surface classes ---------------------------------------------------------------------
//
// These are *identities*, not simulations. At 8–30 px what reads is banding, albedo contrast and
// a couple of bright features; a 20-octave terrain would alias into noise. Layer 6 is where a
// planet surface stops being a pattern on a sphere.

fn surface_scale(surfaceClass: i32) -> f32 {
  if (surfaceClass == 4) {
    return 2.6; // continents are large features
  }
  if (surfaceClass == 2) {
    return 3.2;
  }
  return 3.8; // rock / super-earth
}

// One height field per world, shared by the albedo and the relief. A world whose colour says
// "mountain" and whose shading says "flat" is exactly what reads as a sticker.
fn world_height(dir: vec3f, seed: f32, scale: f32) -> f32 {
  return fbm3(dir * scale, seed * 5.7);
}

// A storm with internal structure: a pale collar, a bright core that is wound into two spiral
// arms, and a dark eye at the centre. The first pass was a smooth radial gradient, and at 6x it
// read as a decal — a storm on a gas giant is a flow, and the eye plus the shear is what says so.
fn storm_shape(dir: vec3f, center: vec3f) -> vec4f {
  let angle = acos(clamp(dot(dir, center), -1.0, 1.0));
  // A tangent frame around the storm centre gives the azimuth the spiral is wound on.
  let reference = select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(center.y) > 0.9);
  let t1 = normalize(cross(center, reference));
  let t2 = cross(center, t1);
  let azimuth = atan2(dot(dir, t2), dot(dir, t1));
  // The winding is distorted by noise, so the arms are cloud, not a drawn spiral: a perfect one
  // is as much a decal as the smooth oval it replaced.
  let ragged = (fbm3(dir * 11.0, 5.9) - 0.5) * 7.0;
  let spiral = 0.5 + 0.5 * sin(azimuth * 2.0 - angle * 42.0 + ragged);
  let collar = smoothstep(0.52, 0.22, angle);
  let core = smoothstep(0.31, 0.09, angle) * (0.30 + 0.70 * spiral);
  let eye = smoothstep(0.085, 0.012, angle);
  return vec4f(collar, core, eye, angle);
}

fn gas_albedo(dir: vec3f, base: vec3f, seed: f32, timeSeconds: f32) -> vec3f {
  let latitude = dir.y;

  // The warp is 3D noise on the unit direction: no meridian seam, no pole collapse. It evolves
  // slowly so a gas giant is never completely frozen. The amplitude is kept modest — a strong
  // warp turns belts into camouflage.
  let drift = vec3f(0.0, timeSeconds * 0.0015, 0.0);
  let warp = fbm3(dir * 2.2 + drift, seed * 3.1) - 0.5;
  let bands = sin(latitude * 15.0 + warp * 2.2);
  let streaks = fbm3(dir * vec3f(5.0, 22.0, 5.0) + drift, seed * 8.3) - 0.5;

  // Belts and zones, sharper and wider apart than the first pass: a 0.68–1.14 range through a
  // broad smoothstep read as one smeared stripe field at 155 px, with no edge for the eye to
  // land on. The streaks still break the sine up, so the bands are not painted stripes.
  let value = clamp(0.5 + 0.5 * bands + streaks * 0.34, 0.0, 1.0);
  var color = mix(base * 0.60, base * 1.20, smoothstep(0.24, 0.76, value));

  // Darker poles: the cheapest cue that the bands wrap a sphere rather than sit on a disc.
  let poles = smoothstep(0.74, 1.0, abs(latitude));
  color = mix(color, base * 0.62, poles * 0.6);

  // A long-lived storm, placed by direction rather than by longitude, so it has no seam to cross.
  let stormDir = normalize(vec3f(
    hash31(vec3f(seed, 1.7, 3.1)) - 0.5,
    (hash31(vec3f(seed, 9.2, 5.5)) - 0.5) * 0.7,
    hash31(vec3f(seed, 4.4, 7.9)) - 0.5,
  ));
  let stormA = storm_shape(dir, stormDir);
  // A pale blob on a pale zone was invisible; a saturated red-brown disc inside a bright collar is
  // how a storm reads at this scale, and the dark eye is what stops it reading as a decal.
  color = mix(color, base * 1.30, stormA.x * 0.55);
  color = mix(color, vec3f(base.r * 0.80 + 0.05, base.g * 0.46, base.b * 0.40), stormA.y * 0.85);
  color = mix(color, base * 0.38, stormA.z * 0.70);

  // A second storm 150° away in longitude. One hash-placed storm spends half its life behind the
  // terminator — in the first close-up it sat on the night side and the disc read as banded but
  // featureless. Two keep one in the lit hemisphere at almost any phase, and Jupiter-class worlds
  // do carry more than one.
  let stormDirB = vec3f(
    -0.866 * stormDir.x + 0.5 * stormDir.z,
    stormDir.y,
    -0.5 * stormDir.x - 0.866 * stormDir.z,
  );
  let stormB = storm_shape(dir, stormDirB);
  color = mix(color, base * 1.26, stormB.x * 0.5);
  color = mix(color, vec3f(base.r * 0.84 + 0.04, base.g * 0.52, base.b * 0.46), stormB.y * 0.80);
  color = mix(color, base * 0.40, stormB.z * 0.65);

  return color;
}

fn solid_albedo(dir: vec3f, base: vec3f, seed: f32, surfaceClass: i32, height: f32) -> vec3f {
  if (surfaceClass == 4) {
    // Ocean world: sea below the threshold, shelf in a narrow band, land above it. The same
    // height field drives the relief, so coasts sit exactly where the shading changes.
    let land = smoothstep(0.500, 0.532, height);

    // The shelf is the bright water just offshore. A constant width in a constant turquoise drew a
    // neon outline around every coast — a 1–2 px cyan line at 9 body radii — so both now wander
    // with a slow field: some coasts shelf out, others drop straight into deep water.
    let wander = fbm3(dir * 4.4, seed * 9.1) - 0.5;
    let shelf = smoothstep(0.410 + wander * 0.030, 0.500 + wander * 0.020, height);
    let deep = vec3f(0.017, 0.058, 0.16);
    let shallow = mix(
      vec3f(0.042, 0.19, 0.29),
      vec3f(0.026, 0.10, 0.19),
      smoothstep(0.30, 0.72, fbm3(dir * 2.6, seed * 4.2)),
    );
    let sea = mix(deep, shallow, shelf);
    let vegetation = mix(
      vec3f(0.13, 0.25, 0.10),
      vec3f(0.36, 0.31, 0.16),
      fbm3(dir * 5.5, seed * 6.1),
    );
    var color = mix(sea, vegetation, land);

    // Ice caps. The boundary is warped by 3D noise, so it meets the sea as a coastline rather than
    // as a perfect circle, and the surface is broken by a second, finer field into ice sheets
    // instead of one flat white — the first pass drew a smooth grey dome over a third of the disc,
    // and a two-tone mix at low frequency read as a hole in it.
    let capNoise = fbm3(dir * 5.2, seed * 7.9);
    let capEdge = 0.84 + 0.16 * (capNoise - 0.5);
    let cap = smoothstep(capEdge, capEdge + 0.085, abs(dir.y));
    let cracks = fbm3(dir * 14.0, seed * 3.3);
    let ice = mix(
      vec3f(0.62, 0.72, 0.85),
      vec3f(0.82, 0.88, 0.95),
      smoothstep(0.30, 0.72, cracks),
    );
    return mix(color, ice, cap);
  }

  if (surfaceClass == 2) {
    let lines = abs(fbm3(dir * 7.0, seed * 13.7) - 0.5);
    var color = mix(base * 0.70, vec3f(0.93, 0.96, 1.0), 0.22 + 0.75 * height);
    color = mix(color, vec3f(0.38, 0.48, 0.66), smoothstep(0.05, 0.0, lines) * 0.8);
    return color;
  }

  // Rock and super-earth. The relief and the albedo range are deliberately modest: an earlier
  // pass at 1.15 relief and a ~5:1 albedo range read as a crumpled walnut at 9 body radii. What
  // has to survive is the 20 px identity — a rust-to-grey world with a couple of darker maria —
  // not a full-detail terrain.
  let grit = fbm3(dir * 11.0, seed * 12.9);
  var color = base * (0.52 + 0.72 * height + 0.16 * (grit - 0.5));
  let maria = smoothstep(0.46, 0.70, height);
  color = mix(color, base * 0.55, maria * 0.38);
  let crater = smoothstep(0.62, 0.82, grit) * smoothstep(0.40, 0.60, height);
  color = color + vec3f(0.05, 0.048, 0.046) * crater;
  return color;
}

fn ocean_clouds(dir: vec3f, seed: f32, timeSeconds: f32) -> f32 {
  // Two layers at different altitudes and different speeds. The parallax between them is what
  // reads as depth above the surface; one layer just slides.
  let high = fbm3(dir * 4.4 + vec3f(timeSeconds * 0.05, 0.0, timeSeconds * 0.012), seed * 9.4);
  let low = fbm3(dir * 8.5 + vec3f(timeSeconds * 0.085, timeSeconds * 0.02, 0.0), seed * 3.7);
  return smoothstep(0.55, 0.74, high) * 0.62 + smoothstep(0.58, 0.78, low) * 0.38;
}

@fragment
fn fs_planet(in: PlanetOut) -> @location(0) vec4f {
  if (in.fade <= 0.01) {
    discard;
  }
  let dir = normalize(in.surface);
  let light = normalize(in.light);
  let view = normalize(in.view);
  let seed = in.extras.x;
  let surfaceClass = i32(in.extras.y + 0.5);
  let detail = clamp(in.extras.z, 0.0, 1.0);
  let timeSeconds = scene.frame_meta.x;

  var albedo = in.color;
  var height = 0.0;
  var relief = 0.0;

  if (surfaceClass == 3) {
    albedo = gas_albedo(dir, in.color, seed, timeSeconds);
  } else {
    let scale = surface_scale(surfaceClass);
    height = world_height(dir, seed, scale);
    albedo = solid_albedo(dir, in.color, seed, surfaceClass, height);
    // Relief only matters once the world is big enough to see it; at thumbnail size it would
    // just add speckle.
    relief = detail;
  }

  // Sea is flat; land gets the relief. Without this the oceans would look like crumpled foil.
  // Solid worlds get a gentler bump than the ocean's land: 1.15 on a whole sphere was the
  // "too rocky" defect, and at 20 px the detail ramp already switches relief off.
  var bumpStrength = relief * 0.15;
  if (surfaceClass == 4) {
    bumpStrength = relief * 1.15 * smoothstep(0.48, 0.56, height) * (1.0 - smoothstep(0.70, 0.84, abs(dir.y)));
  }

  var normal = dir;
  if (bumpStrength > 0.02) {
    let pole = select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(dir.y) > 0.95);
    let tangent = normalize(cross(pole, dir));
    let bitangent = cross(dir, tangent);
    let e = 0.022;
    let h1 = world_height(normalize(dir + tangent * e), seed, surface_scale(surfaceClass));
    let h2 = world_height(normalize(dir + bitangent * e), seed, surface_scale(surfaceClass));
    let slope = vec2f((h1 - height) / e, (h2 - height) / e);
    normal = normalize(dir - tangent * slope.x * bumpStrength - bitangent * slope.y * bumpStrength);
  }

  // Soft terminator: real worlds do not have a hard day/night edge, and at this scale a hard one
  // reads as a cut-out disc.
  //
  // Small worlds need it softer still. A 20 px body that is 90% night is a 4 px lit crescent and
  // nothing else — that is why the inner planets were only findable by hunting. Wrapping the
  // terminator further around keeps the lit-to-unlit gradient (unlike a flat ambient floor, which
  // made them read as evenly lit discs at the wrong light angle) while bringing the whole body up
  // to a visible value. `detail` is the on-screen radius ramp (1 at ~42 px), so close-ups get none
  // of it.
  let smallWorld = 1.0 - clamp(detail, 0.0, 1.0);
  let wrap = 0.14 + 1.25 * smallWorld * smallWorld;
  let ndl = dot(normal, light);
  let diffuse = pow(clamp((ndl + wrap) / (1.0 + wrap), 0.0, 1.0), 0.9);

  // Gas giants have no ground to go black: their night side keeps a deep blue-grey cloud deck.
  // At 0.030 the night third measured the same value as empty space, which read as a disc with a
  // bite taken out of it rather than as a sphere turning away from the star.
  let ambient = select(0.030, 0.062, surfaceClass == 3) + 0.08 * smallWorld * smallWorld;
  var color = albedo * (ambient + diffuse * 1.85);

  // Limb darkening: the strongest cheap cue that this is a sphere and not a disc.
  let limb = pow(clamp(dot(normal, view), 0.0, 1.0), 0.45);
  color = color * mix(0.68, 1.0, limb);

  // Ocean glint: a view-dependent specular on the sea only. It is what makes water read as wet
  // rather than as blue paint.
  if (surfaceClass == 4) {
    let seaMask = (1.0 - smoothstep(0.480, 0.520, height)) * smoothstep(0.0, 0.2, detail);
    let reflected = reflect(-light, normal);
    // A 48-power highlight is a 2 px pinhole at 9 body radii: it read as a speck of dirt on the
    // sea rather than as a sun glint. Wider and dimmer, it reads as a sheen.
    let glint = pow(max(dot(reflected, view), 0.0), 26.0);
    color = color + vec3f(1.0, 0.97, 0.88) * glint * seaMask * 1.1;
  }

  // Clouds, lit by the same sun, above the surface and slightly brighter at the limb.
  if (surfaceClass == 4) {
    let cloud = ocean_clouds(dir, seed, timeSeconds) * in.atmosphere;
    let cloudLight = ambient + diffuse * 1.1;
    color = mix(color, vec3f(0.95, 0.96, 1.0) * cloudLight, cloud * 0.6);
  }

  // Atmosphere: a Fresnel rim plus a warm sunset band at the terminator. Animated by a slow noise
  // so the limb is never frozen.
  let fresnel = pow(1.0 - max(dot(normal, view), 0.0), 2.4);
  let rimTint = mix(vec3f(0.34, 0.56, 0.94), albedo * 2.0, 0.22);
  let rimPulse = 0.85 + 0.15 * fbm3(dir * 3.0 + vec3f(timeSeconds * 0.02, 0.0, 0.0), seed * 2.1);
  let rim = in.atmosphere * fresnel * (0.14 + 0.92 * diffuse) * rimPulse;
  color = color + rimTint * rim;

  let sunset = smoothstep(0.34, 0.0, abs(ndl - 0.10)) * in.atmosphere;
  color = color + vec3f(0.55, 0.22, 0.06) * sunset * 0.55;

  // Soft shoulder. Ice caps and cloud tops under direct light exceed 1.0 and clip to flat white,
  // which reads as a hole rather than as brightness. This compresses the top of the range while
  // leaving mid-tones almost untouched (0.3 -> 0.295).
  color = color / (vec3f(0.85) + color * 0.55);

  return vec4f(color, in.fade);
}

struct StarOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

// The star is one field evaluated twice. The opaque core pass draws the photosphere plus the
// glow that falls inside the disc; the additive pass draws only the glow outside it. Both call
// `star_glow`, and the surface falls to zero at the disc's rim, so the two passes meet with no
// seam and no double-brightening.
fn star_surface(r: f32) -> f32 {
  // 1 at the centre, 0 at the photosphere's rim. It must reach exactly 0 there: below zero the
  // opaque disc would end on a dark ring where the corona cannot add.
  return pow(max(0.0, 1.0 - r * r), 0.85);
}

fn star_glow(uv: vec2f) -> f32 {
  let d = length(uv);
  let theta = atan2(uv.y, uv.x);

  // Slow angular structure, so the corona is a field rather than a perfect circle; a power-law
  // corona and a wider, fainter halo; a faint horizontal streak. All three reach zero at the
  // quad's edge, which is why the quad is wider than the old glare.
  let structure = 0.86 + 0.14 * fbm3(vec3f(cos(theta), sin(theta), 0.5) * 2.4, 3.7);
  let corona = pow(max(0.0, 1.0 - d), 3.4) * 0.62 * structure;
  let halo = pow(max(0.0, 1.0 - d), 1.35) * 0.07;
  let streak = exp(-abs(uv.y) * 18.0) * pow(max(0.0, 1.0 - d), 2.2) * 0.05;
  return corona + halo + streak;
}

fn star_shade(raw: f32, surface: f32) -> vec4f {
  // A soft shoulder: the old field summed to ~3× the star's colour and clipped to flat white.
  // This maps a bright centre to ~1.0 while leaving the corona's tail almost untouched.
  let mapped = raw / (0.70 + 0.60 * raw);
  // The photosphere is nearly white; the corona keeps the star's own colour. `surface` is zero
  // everywhere in the corona, so the two passes share this expression without a colour step.
  let tint = mix(scene.star_color.rgb, vec3f(1.0, 0.98, 0.95), 0.55 * surface);
  return vec4f(tint * mapped, 1.0);
}

fn star_quad(corner: vec2f, radius: f32) -> vec4f {
  let world = scene.star_center.xyz
    + scene.camera_right.xyz * corner.x * radius
    + scene.camera_up.xyz * corner.y * radius;
  return scene.view_proj * vec4f(world, 1.0);
}

@vertex
fn vs_star(@builtin(vertex_index) index: u32) -> StarOut {
  var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  );
  let corner = corners[index];

  var out: StarOut;
  out.position = star_quad(corner, scene.star_center.w);
  out.uv = corner;
  return out;
}

@vertex
fn vs_star_core(@builtin(vertex_index) index: u32) -> StarOut {
  var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  );
  let corner = corners[index];

  var out: StarOut;
  out.position = star_quad(corner, scene.star_color.w);
  out.uv = corner;
  return out;
}

// The core is opaque and writes depth, so it is the star's occluder: anything behind the star's
// plane inside this radius fails the depth test before it can paint over the glare. It is drawn
// as a quad, so the occluder is the billboard plane, not a sphere — at this scale the difference
// is far below the drawn size.
@fragment
fn fs_star_core(in: StarOut) -> @location(0) vec4f {
  let r = length(in.uv);
  let fade = 1.0 - smoothstep(0.45, 0.75, scene.lod_meta.x);
  if (r > 1.0 || fade <= 0.01) {
    discard;
  }
  // The core's own UV is mapped into the glare quad's units, so its rim evaluates to exactly the
  // corona's value at that radius.
  let ratio = scene.star_color.w / scene.star_center.w;
  let surface = star_surface(r);
  let shade = star_shade(surface + star_glow(in.uv * ratio), surface);
  return vec4f(shade.rgb, fade);
}

@fragment
fn fs_star(in: StarOut) -> @location(0) vec4f {
  let d = length(in.uv);
  // The core pass already draws this radius; adding it here as well would double-brighten the
  // centre.
  if (d < scene.star_color.w / scene.star_center.w) {
    discard;
  }
  // As the opaque core fades out, the corona takes over the same brightness (issue 04 D4/D5).
  // Without it the star arrives as a small dim dot while brighter disc impostors surround it, and
  // the one point the viewer is supposed to find is lost in the field it belongs to. At orrery
  // scale this is exactly 1.0, so Layer 2's star is untouched.
  //
  // Gate iteration 1 measured the corona at peak 0.56 against a field reaching 0.99 in the same
  // warm hue: the boost was too small, and `scene.star_color` is the same amber family as every
  // disc impostor. Three levers, all gated on `handoff` so lod 0 is bit-identical:
  //   - a larger peak, so the point clears the graded nucleus instead of tying with it;
  //   - a cool tint outside the disc's warm palette, so the eye separates it by hue at no cost;
  //   - the 2–3 px clear gap is the CPU pass's job (see `writeGalaxyFrame`).
  let handoff = smoothstep(0.45, 0.85, scene.lod_meta.x);
  let shade = star_shade(star_glow(in.uv), 0.0);
  let identity = vec3f(0.82, 0.93, 1.0);
  let tinted = mix(shade.rgb, identity * (shade.r + shade.g + shade.b) / 3.0, 0.72 * handoff);
  return vec4f(tinted * mix(1.0, 3.4, handoff), 1.0);
}

struct OrbitOut {
  @builtin(position) position: vec4f,
  // 0 when this ring's fragment should not be drawn: the eye is inside it, inside the system,
  // or so close to it that it would read as a line across the frame.
  @location(0) opacity: f32,
};

// Rings are a diagram of the system, read from outside it. Once the camera drops inside the
// orbit, the enclosing rings become wide arcs sweeping the frame — the close-up shots showed
// seven of them reading as scanlines — so a ring is only drawn when the eye is clearly outside
// it, and none are drawn until the eye is outside the system.
@vertex
fn vs_orbit(@location(0) local: vec3f, @location(1) radius: f32) -> OrbitOut {
  let world = scene.star_center.xyz + local;
  let eye = length(scene.star_center.xyz);

  var out: OrbitOut;
  out.position = scene.view_proj * vec4f(world, 1.0);

  // The fade has to be long enough to read: at 12.7% per wheel notch the old 1.02-1.20 band was
  // ~1.4 notches, so the last faint line could vanish in a single step (Layer 2 gate nit). This
  // band spans ~4 notches at the same notch size, and is unchanged wherever the eye is well
  // outside the ring (~2.2 units at the default framing, where the ring is already at full
  // opacity).
  let outside = smoothstep(radius * 1.04, radius * 1.55, eye);
  let inSystem = smoothstep(0.88, 1.02, eye);
  // The part of a ring passing near the eye projects to a near-straight line across the middle
  // of the frame; fade it out there so the close-ups read as a world, not a plot.
  let nearClip = smoothstep(0.25, 0.80, length(world));

  // Rings write no depth, so a near-side arc would cut across the star. Fade it over the disc
  // itself, not the whole glare: the halo is ~3x the disc, and fading over it swallowed the four
  // innermost orbits, leaving five traceable rings against a HUD that claims nine planets.
  var sunFade = 1.0;
  let starClip = scene.view_proj * vec4f(scene.star_center.xyz, 1.0);
  let edgeClip = scene.view_proj
    * vec4f(scene.star_center.xyz + scene.camera_up.xyz * scene.star_color.w, 1.0);
  if (out.position.w > 0.0 && starClip.w > 0.0) {
    let centre = starClip.xy / starClip.w;
    let edge = edgeClip.xy / edgeClip.w;
    let discRadius = length(edge - centre);
    let distance = length(out.position.xy / out.position.w - centre);
    sunFade = smoothstep(0.98, 1.18, distance / max(discRadius, 1e-6));
  }

  out.opacity = outside * inSystem * nearClip * sunFade;
  return out;
}

@fragment
fn fs_orbit(in: OrbitOut) -> @location(0) vec4f {
  // Faint on purpose — the rings are a diagram, not scenery — but they were too faint to read at
  // 1080p, which made the planets look scattered rather than orbiting.
  //
  // Rings are the first thing the crossfade gives up: a diagram above the orrery is exactly the
  // astrolabe frame the council named.
  let fade = 1.0 - smoothstep(0.0, 0.25, scene.lod_meta.x);
  return vec4f(0.44, 0.56, 0.74, 0.42 * in.opacity * fade);
}