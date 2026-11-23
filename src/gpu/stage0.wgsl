// Layer 0 stage shader.
//
// This is deliberately not the universe: it is a deterministic placeholder that exercises
// the whole dev loop — seed, pinned t, camera and a pipeline that can be rebuilt on its own
// while the page and GPUDevice survive. Layer 2 replaces it with the first star system.

struct Params {
  resolution: vec2f,
  time: f32,
  seed: f32,
  camera_pos: vec4f,
  camera_ori: vec4f,
  // Camera-relative, float32, computed on the CPU in double precision. The GPU never sees an
  // absolute coordinate (ADR-0008).
  probe_a: vec4f,
  probe_b: vec4f,
  probe_c: vec4f,
  // x: 1 = draw the precision probe, y: focal length (1 / tan(fov / 2)), z: device pixel
  // ratio so marker rings stay the same CSS size on a 2× display.
  probe_meta: vec4f,
};

@group(0) @binding(0) var<uniform> params: Params;

@vertex
fn vs(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  var corners = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f(3.0, -1.0),
    vec2f(-1.0, 3.0),
  );
  return vec4f(corners[index], 0.0, 1.0);
}

// --- precision probe -------------------------------------------------------------------
//
// Three markers at one depth, projected with a plain perspective divide. The only difference
// between the fixed and naive captures is the camera-relative position the CPU uploaded, so
// anything visible here is a coordinate bug and not a projection one.

fn probe_screen(position: vec3f, resolution: vec2f) -> vec2f {
  let depth = max(position.z, 0.000001);
  let aspect = resolution.x / max(resolution.y, 1.0);
  let ndc = vec2f(
    (position.x / depth) * params.probe_meta.y / aspect,
    (position.y / depth) * params.probe_meta.y,
  );
  return vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5) * resolution;
}

fn probe_ring(at: vec2f, centre: vec2f, radius: f32, colour: vec3f) -> vec3f {
  let d = distance(at, centre);
  // A thin ring plus a small core: overlapping markers read as concentric rings, which is
  // what the naive path must produce.
  let ring = 1.0 - smoothstep(0.5, 1.5, abs(d - radius));
  let core = 1.0 - smoothstep(0.0, 1.5, d);
  return colour * max(ring, core * 0.6);
}

fn star_layer(p: vec2f, density: f32, seed: f32) -> f32 {
  let cell = floor(p);
  let local = fract(p);
  var sum = 0.0;

  for (var y = -1; y <= 1; y = y + 1) {
    for (var x = -1; x <= 1; x = x + 1) {
      let offset = vec2f(f32(x), f32(y));
      let id = cell + offset;
      let presence = hash21(id + vec2f(seed * 17.0, seed * 31.0));
      if (presence > density) {
        continue;
      }

      let jitter = vec2f(
        hash21(id + vec2f(1.7, 3.1)),
        hash21(id + vec2f(9.2, 5.3)),
      );
      let distance = length(local - (offset + jitter));
      let radius = 0.02 + 0.06 * hash21(id + vec2f(4.4, 8.8));
      let brightness = mix(0.25, 1.0, hash21(id + vec2f(7.7, 2.2)));
      let twinkle = 0.75 + 0.25 * sin(params.time * (0.2 + presence) + presence * 60.0);

      sum = sum + (1.0 - smoothstep(0.0, radius, distance)) * brightness * twinkle;
    }
  }

  return sum;
}

@fragment
fn fs(@builtin(position) frag: vec4f) -> @location(0) vec4f {
  let resolution = max(params.resolution, vec2f(1.0));

  if (params.probe_meta.x > 0.5) {
    let a = probe_screen(params.probe_a.xyz, resolution);
    let b = probe_screen(params.probe_b.xyz, resolution);
    let c = probe_screen(params.probe_c.xyz, resolution);

    var probe = vec3f(0.010, 0.013, 0.020);
    let scale = max(params.probe_meta.z, 1.0);
    probe = probe + probe_ring(frag.xy, a, 20.0 * scale, vec3f(0.30, 0.65, 1.00));
    probe = probe + probe_ring(frag.xy, b, 14.0 * scale, vec3f(1.00, 0.72, 0.30));
    probe = probe + probe_ring(frag.xy, c, 8.0 * scale, vec3f(0.90, 0.95, 1.00));
    return vec4f(probe, 1.0);
  }

  var uv = (frag.xy / resolution) * 2.0 - 1.0;
  uv.x = uv.x * (resolution.x / resolution.y);

  // The sky is at infinity: it answers to orientation only. Adding a camera *position* term was
// fine at 40 m and is not fine at 10¹² m — `camera_pos.xz * 0.002` becomes ~10⁹, which swamps the
// noise coordinate's float precision and prints full-height vertical bands.
  let yaw = params.camera_ori.x;
  let pitch = params.camera_ori.y;
  let sky = uv + vec2f(yaw * 0.6, -pitch * 0.6);

  var nebula = 0.0;
  var q = sky * 1.4 + vec2f(params.seed * 3.1, params.seed * 5.7);
  var amplitude = 0.5;
  for (var octave = 0; octave < 4; octave = octave + 1) {
    nebula = nebula + value_noise(q) * amplitude;
    q = q * 2.03 + vec2f(1.7, 9.2);
    amplitude = amplitude * 0.5;
  }
  nebula = smoothstep(0.35, 1.0, nebula);

  let warm = vec3f(0.18, 0.06, 0.16);
  let cool = vec3f(0.05, 0.12, 0.20);
  let tint = mix(cool, warm, value_noise(sky * 0.7 + vec2f(4.0, 2.0)));
  var color = vec3f(0.012, 0.016, 0.028) + tint * nebula * 0.5;

  let far = star_layer(sky * 35.0 + vec2f(3.0, 41.0), 0.18, params.seed + 0.71);
  let middle = star_layer(sky * 70.0 + vec2f(19.0, 7.0), 0.28, params.seed + 0.37);
  let near = star_layer(sky * 140.0, 0.42, params.seed);

  color = color
    + vec3f(0.80, 0.90, 1.00) * far * 0.55
    + vec3f(1.00, 0.92, 0.80) * middle * 0.75
    + vec3f(0.88, 0.92, 1.00) * near * 0.95;

  let vignette = 1.0 - 0.55 * dot(uv * 0.55, uv * 0.55);
  color = color * max(vignette, 0.0);

  return vec4f(color, 1.0);
}