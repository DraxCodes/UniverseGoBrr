// One instanced additive impostor per star, accumulated into an offscreen HDR buffer and
// soft-shoulder tone-mapped onto the swapchain before the orrery renders.
//
// Positions arrive **camera-relative** in display units (1 unit = the orrery's outermost orbit).
// The CPU has already subtracted the camera in double precision (ADR-0008); nothing absolute is
// reachable from this shader. The quad is built from the camera's right/up basis, so every
// impostor faces the eye without a per-instance orientation buffer.
//
// The galaxy is static this layer (issue 04 D7), so `frame_info.w` carries time while `z` holds
// the per-seed apparent-area exposure compensation (`1.0` at `lod === 0`). Depth is untested and
// unwritten: the galaxy is behind the orrery and is drawn first.

struct Galaxy {
  view_proj: mat4x4f,
  camera_right: vec4f,
  camera_up: vec4f,
  // x: lod, y: gain, z: exposure (1.0 at lod 0), w: time.
  // (`meta` is a reserved word in WGSL, not just a name clash.)
  frame_info: vec4f,
};

@group(0) @binding(0) var<uniform> galaxy: Galaxy;
@group(1) @binding(0) var galaxy_hdr: texture_2d<f32>;

struct StarOut {
  @builtin(position) position: vec4f,
  // rgb: the star's linear colour; a: the crossfade's reveal for this star.
  @location(0) color: vec4f,
  // -1..1 corner of the billboard quad.
  @location(1) uv: vec2f,
};

@vertex
fn vs_star(
  @builtin(vertex_index) vertex_index: u32,
  // Per instance: camera-relative centre (display units) and the quad's world-space radius.
  @location(0) center: vec3f,
  @location(1) radius: f32,
  @location(2) color: vec4f,
) -> StarOut {
  var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  );
  let corner = corners[vertex_index];

  let world = center
    + galaxy.camera_right.xyz * corner.x * radius
    + galaxy.camera_up.xyz * corner.y * radius;

  var out: StarOut;
  out.position = galaxy.view_proj * vec4f(world, 1.0);
  out.color = color;
  out.uv = corner;
  return out;
}

@fragment
fn fs_star(in: StarOut) -> @location(0) vec4f {
  let d = length(in.uv);
  if (d > 1.0) {
    discard;
  }

  // Compact Gaussian-like luminous core with a C¹ smooth tail reaching zero slope at r = 1.
  // Moderately broadened mid-body (`3.2` core + `0.28` tail) lets neighbouring arm impostors
  // merge into a band of light while keeping individual bright stars crisp and lanes open.
  let r = clamp(d, 0.0, 1.0);
  let edge = 1.0 - r * r;
  let w = edge * edge;
  let core = exp(-r * r * 3.2) * w;
  let glow = w * 0.28;
  let shape = core * 0.72 + glow;

  // Additive into rgba16float HDR: alpha is the reveal, not opacity.
  let intensity = in.color.a * galaxy.frame_info.y * galaxy.frame_info.z;
  return vec4f(in.color.rgb * intensity * shape, 1.0);
}

@vertex
fn vs_composite(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  var corners = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f(3.0, -1.0),
    vec2f(-1.0, 3.0),
  );
  return vec4f(corners[index], 0.0, 1.0);
}

@fragment
fn fs_composite(@builtin(position) frag: vec4f) -> @location(0) vec4f {
  let hdr = textureLoad(galaxy_hdr, vec2i(frag.xy), 0).rgb;
  let lum = dot(hdr, vec3f(0.2126, 0.7152, 0.0722));
  if (lum <= 1e-6) {
    return vec4f(0.0, 0.0, 0.0, 0.0);
  }

  // Galaxy-only soft-shoulder HDR tone curve:
  // - Exact linear identity below `knee` (lanes, faint stars, and boot dust band untouched).
  // - C¹-continuous rational roll-off above `knee` toward `ceil_lum`, grading the nucleus without
  //   a flat white plateau while leaving headroom for the home star above the field.
  let knee = 0.38;
  let ceil_lum = 0.79;
  var mapped_lum = lum;
  if (lum > knee) {
    let excess = lum - knee;
    let headroom = ceil_lum - knee;
    mapped_lum = knee + headroom * (excess / (excess + headroom));
  }

  var color = hdr * (mapped_lum / lum);

  // Photographic warm-ivory highlight roll-off in the core only: avoids harsh per-channel
  // orange-to-yellow clipping while preserving arm/lane hue separation in mid-tones.
  let desat = smoothstep(0.75, 4.5, lum) * 0.55;
  let warm_core = vec3f(1.0, 0.94, 0.82) * mapped_lum;
  color = mix(color, warm_core, desat);

  // Keep every RGB channel below 8-bit saturation so no bright star/core pixel clips flat.
  let peak = max(color.r, max(color.g, color.b));
  if (peak > 0.93) {
    color = color * (0.93 / peak);
  }

  // Premultiplied-alpha optical depth gated by lod: at lod 0 or in dark lanes, alpha is 0
  // (pure additive over sky); in the dense luminous core at lod 1, background infinity stars
  // are occluded behind the bulge so they never poke clipped 1 px pinpricks through it.
  let core_alpha = smoothstep(0.08, 0.48, mapped_lum) * galaxy.frame_info.x;
  return vec4f(color, core_alpha);
}
