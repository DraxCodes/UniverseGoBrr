// One instanced additive impostor per star.
//
// Positions arrive **camera-relative** in display units (1 unit = the orrery's outermost orbit).
// The CPU has already subtracted the camera in double precision (ADR-0008); nothing absolute is
// reachable from this shader. The quad is built from the camera's right/up basis, so every
// impostor faces the eye without a per-instance orientation buffer.
//
// The galaxy is static this layer (issue 04 D7), so `meta.z` is reserved rather than carrying a
// rotation. Depth is untested and unwritten: the galaxy is behind the orrery and is drawn first.

struct Galaxy {
  view_proj: mat4x4f,
  camera_right: vec4f,
  camera_up: vec4f,
  // x: lod (unused in the fragment today), y: gain, z: reserved, w: reserved.
  // (`meta` is a reserved word in WGSL, not just a name clash.)
  frame_info: vec4f,
};

@group(0) @binding(0) var<uniform> galaxy: Galaxy;

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

  // A compact core with a wide, soft tail. Both terms reach zero at the quad's edge, so the
  // impostor has no square and neighbouring stars can overlap without a visible tile. The tail
  // used to carry most of the area (0.7 core + 0.3 halo), which merged sprites into bands but
  // also veiled the inter-arm lane shut: gate iteration 1 read a mottled oval because a 4–5 px
  // halo fills a 40 px lane. The lane is the signal, so the tail gives ground to the core.
  let core = pow(max(0.0, 1.0 - d), 2.2);
  let halo = pow(max(0.0, 1.0 - d), 1.0) * 0.14;
  let shape = core * 0.86 + halo;

  // Additive: alpha is the reveal, not opacity. `frame_info.y` is the population gain.
  let intensity = in.color.a * galaxy.frame_info.y;
  return vec4f(in.color.rgb * intensity * shape, 1.0);
}