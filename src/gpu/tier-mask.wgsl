// Layer 4 tier masks: procedural HDR warp star streaks and transwarp slipstream tunnel,
// composited over the departure snapshot and live destination scene (ADR-0003, ADR-0015).
//
// `noise.wgsl` is prepended at compile time, providing `hash21`, `hash31`, `fbm`, and `fbm3`.

struct MaskParams {
  // x: width, y: height, z: aspect (width / height), w: seed (0..1)
  viewport: vec4f,
  // x: progress (0..1), y: method (0 = warp, 1 = transwarp), z: elapsed_s, w: reserved
  timing: vec4f,
  // x: departWeight, y: destWeight, z: effectIntensity, w: departPull
  envelope: vec4f,
  // x: focusUv.x, y: focusUv.y, z: destSettle, w: reserved
  focus: vec4f,
  // rgb: destination star linear colour, w: reserved
  star_color: vec4f,
};

@group(0) @binding(0) var<uniform> mask: MaskParams;

@group(1) @binding(0) var mask_hdr: texture_2d<f32>;
@group(1) @binding(1) var depart_tex: texture_2d<f32>;
@group(1) @binding(2) var dest_tex: texture_2d<f32>;
@group(1) @binding(3) var mask_sampler: sampler;

const PI: f32 = 3.14159265;
const TWO_PI: f32 = 6.28318530;

@vertex
fn vs_mask(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  var corners = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f(3.0, -1.0),
    vec2f(-1.0, 3.0),
  );
  return vec4f(corners[index], 0.0, 1.0);
}

fn aperture_radius(progress: f32) -> f32 {
  let u = clamp(progress, 0.0, 1.0);
  let open_t = smoothstep(0.42, 0.98, u);
  return mix(0.055, 2.40, open_t * open_t);
}

fn star_palette(hue_sample: f32, doppler: f32) -> vec3f {
  var col = vec3f(0.96, 0.95, 0.91);
  if (hue_sample < 0.42) {
    col = mix(vec3f(0.58, 0.78, 1.00), vec3f(0.84, 0.92, 1.00), hue_sample / 0.42);
  } else if (hue_sample < 0.78) {
    col = mix(vec3f(0.94, 0.95, 0.98), vec3f(1.00, 0.95, 0.86), (hue_sample - 0.42) / 0.36);
  } else {
    col = mix(vec3f(1.00, 0.86, 0.68), vec3f(1.00, 0.74, 0.48), (hue_sample - 0.78) / 0.22);
  }
  return mix(col, vec3f(0.72, 0.88, 1.00), doppler * 0.32);
}

fn eval_warp_hdr(p: vec2f) -> vec3f {
  let r = length(p);
  let theta = atan2(p.y, p.x);
  let u = clamp(mask.timing.x, 0.0, 1.0);
  let intensity = mask.envelope.z;
  let seed = mask.viewport.w;

  // Smooth C-infinity integral phase: velocity is zero at u = 0 and u = 1, peaking at midpoint.
  let phase = u - sin(TWO_PI * u) / TWO_PI;
  let log_r = log(max(r, 0.008));

  // Suppress dense angular overlap right at the focal singularity; replace it with a clean
  // relativistic convergence glow so the destination star resolves out of the focal point.
  let center_guard = smoothstep(0.028, 0.095, r);
  var accum = vec3f(0.0);

  for (var layer: i32 = 0; layer < 4; layer = layer + 1) {
    let lf = f32(layer);
    let n_ang_i = 44 + layer * 22;
    let n_ang = f32(n_ang_i);
    let radial_freq = 1.65 + lf * 0.55;
    let speed = 5.4 + lf * 2.1;
    let flow = phase * speed;

    let ang_coord = ((theta + PI) / TWO_PI) * n_ang;
    let rad_coord = log_r * radial_freq - flow;
    let cell_a = i32(floor(ang_coord));
    let cell_r = i32(floor(rad_coord));

    let tail_len = (0.28 + 1.25 * intensity) * (0.85 + lf * 0.14);
    let layer_weight = 1.05 - lf * 0.17;

    for (var da: i32 = -1; da <= 1; da = da + 1) {
      let ia = ((cell_a + da) % n_ang_i + n_ang_i) % n_ang_i;
      let fa = f32(ia);
      for (var dr: i32 = -1; dr <= 1; dr = dr + 1) {
        let ir = cell_r + dr;
        let fr = f32(ir);
        let key = vec3f(fa * 0.73 + lf * 19.1, fr * 1.37 + lf * 7.3, seed * 31.7 + lf * 5.1);

        let occ = hash31(key);
        if (occ > 0.34) {
          continue;
        }

        let j_ang = hash31(key + vec3f(3.1, 7.7, 1.9));
        let j_rad = hash31(key + vec3f(9.4, 2.3, 5.8));
        let hue = hash31(key + vec3f(4.2, 6.1, 8.3));
        let lum_seed = hash31(key + vec3f(1.3, 8.9, 2.7));

        let star_theta = ((fa + 0.15 + 0.70 * j_ang) / n_ang) * TWO_PI - PI;
        var dtheta = theta - star_theta;
        if (dtheta > PI) {
          dtheta = dtheta - TWO_PI;
        } else if (dtheta < -PI) {
          dtheta = dtheta + TWO_PI;
        }

        // Physical screen-space perpendicular distance keeps streaks crisp at every radius.
        let perp = abs(dtheta) * r;
        let bright = 0.45 + 0.85 * lum_seed * lum_seed;
        let width = (0.0018 + 0.0014 * bright) * (1.0 + 0.30 * r);
        if (perp > width * 3.5) {
          continue;
        }

        let star_rad = fr + j_rad;
        let tail = star_rad - rad_coord;
        if (tail < -0.14 || tail > tail_len * 3.6) {
          continue;
        }

        let perp_profile = exp(-pow(perp / width, 2.0) * 1.4);
        let head = exp(-tail * tail * 55.0) * 1.15;
        let trail = select(0.0, exp(-tail / max(tail_len, 0.05)), tail >= 0.0) * 0.85;
        let radial_profile = max(head, trail) * smoothstep(-0.14, 0.0, tail);

        let col = star_palette(hue, intensity);
        accum = accum + col * (perp_profile * radial_profile * bright * layer_weight * 0.72);
      }
    }
  }

  accum = accum * center_guard;

  // Subtle focal convergence glow tinted toward the destination star at the focal point.
  let focal_tint = mix(vec3f(0.65, 0.85, 1.00), mask.star_color.rgb, 0.45);
  let core_glow = exp(-r * r * 220.0) * 0.36 + exp(-r * r * 45.0) * 0.08;
  accum = accum + focal_tint * core_glow * intensity;

  return accum * intensity;
}

fn eval_transwarp_hdr(p: vec2f) -> vec3f {
  let u = clamp(mask.timing.x, 0.0, 1.0);
  let intensity = mask.envelope.z;
  let seed = mask.viewport.w;

  let phase = u - sin(TWO_PI * u) / TWO_PI;
  let flow = phase * 11.5;

  // Gentle depth-modulated tunnel curvature that settles straight before exit.
  let sway_amp = 0.045 * intensity * (1.0 - smoothstep(0.55, 0.92, u));
  let sway = vec2f(
    sin(flow * 0.45 + seed * TWO_PI),
    cos(flow * 0.37 + seed * 3.14),
  ) * sway_amp;
  let q = p - sway * smoothstep(0.04, 0.42, length(p));

  let r = length(q);
  let theta = atan2(q.y, q.x);
  let z = 1.25 / max(r, 0.042);

  // Helical cylindrical coordinates avoid any atan2 meridian seam by construction.
  let twist = theta + z * 0.24 - flow * 0.36;
  let c1 = cos(twist);
  let s1 = sin(twist);
  let c2 = cos(twist * 2.0 + 0.85);
  let s2 = sin(twist * 2.0 + 0.85);

  let sample_a = vec3f(c1 * 1.55, s1 * 1.55, z * 0.48 - flow * 0.95);
  let sample_b = vec3f(c2 * 2.25, s2 * 2.25, z * 0.85 - flow * 1.45);
  let sample_c = vec3f(c1 * 3.60, s1 * 3.60, z * 1.35 - flow * 2.15);

  let veil_noise = fbm3(sample_a, 1.3 + seed * 7.0);
  let rib_raw = fbm3(sample_b, 4.9 + seed * 5.0);
  let rib = pow(clamp(1.0 - abs(rib_raw * 2.0 - 1.0), 0.0, 1.0), 4.2);
  let streak_noise = fbm3(sample_c, 8.7 + seed * 3.0);
  let streak = pow(smoothstep(0.52, 0.86, streak_noise), 2.2);

  let deep_cobalt = vec3f(0.05, 0.14, 0.42);
  let slip_teal = vec3f(0.22, 0.72, 0.98);
  let ivory = mix(vec3f(0.92, 0.96, 1.00), mask.star_color.rgb, 0.30);

  let depth_fade = smoothstep(0.018, 0.16, r) * (0.42 + 0.58 * smoothstep(0.08, 0.65, r));
  let wall = deep_cobalt * (0.26 + 0.74 * veil_noise)
    + slip_teal * (rib * 1.10 + streak * 0.72)
    + ivory * (rib * rib * 0.58);

  let ap = aperture_radius(u);
  let wall_mask = smoothstep(ap - 0.12, ap + 0.14, r);
  let rim_gate = smoothstep(0.32, 0.56, u) * (1.0 - smoothstep(0.86, 0.99, u));
  let rim = exp(-pow((r - ap) / 0.055, 2.0)) * rim_gate;
  let rim_col = mix(vec3f(0.45, 0.88, 1.00), mask.star_color.rgb, 0.42);

  // Subtle distant tunnel core glow before the exit aperture opens.
  let tunnel_core = exp(-r * r * 65.0) * (1.0 - smoothstep(0.38, 0.68, u));
  let core_col = mix(vec3f(0.35, 0.78, 1.00), ivory, 0.55);

  return (wall * depth_fade * wall_mask + rim_col * rim * 0.88 + core_col * tunnel_core * 0.65)
    * intensity;
}

@fragment
fn fs_mask_hdr(@builtin(position) frag: vec4f) -> @location(0) vec4f {
  let resolution = max(mask.viewport.xy, vec2f(1.0));
  let uv = frag.xy / resolution;
  let p = (uv - mask.focus.xy) * vec2f(mask.viewport.z, 1.0);

  var color = vec3f(0.0);
  if (mask.timing.y < 0.5) {
    color = eval_warp_hdr(p);
  } else {
    color = eval_transwarp_hdr(p);
  }
  return vec4f(color, 1.0);
}

fn sample_depart(uv: vec2f, focus_uv: vec2f, pull: f32) -> vec3f {
  if (pull <= 0.001) {
    return textureSampleLevel(depart_tex, mask_sampler, uv, 0.0).rgb;
  }
  let dir = uv - focus_uv;
  var acc = vec3f(0.0);
  var wsum = 0.0;
  for (var i: i32 = 0; i < 6; i = i + 1) {
    let fi = f32(i) / 5.0;
    let scale = 1.0 - fi * pull * 0.16;
    let sample_uv = clamp(focus_uv + dir * scale, vec2f(0.0), vec2f(1.0));
    let w = 1.0 - fi * 0.45;
    acc = acc + textureSampleLevel(depart_tex, mask_sampler, sample_uv, 0.0).rgb * w;
    wsum = wsum + w;
  }
  return acc / max(wsum, 1e-5);
}

fn sample_dest(uv: vec2f, focus_uv: vec2f, settle: f32) -> vec3f {
  if (settle <= 0.0005) {
    return textureSampleLevel(dest_tex, mask_sampler, uv, 0.0).rgb;
  }
  let dir = uv - focus_uv;
  let zoom = 1.0 + 0.12 * settle;
  var acc = vec3f(0.0);
  var wsum = 0.0;
  for (var i: i32 = 0; i < 4; i = i + 1) {
    let fi = f32(i) / 3.0;
    let scale = zoom + fi * settle * 0.06;
    let sample_uv = clamp(focus_uv + dir * scale, vec2f(0.0), vec2f(1.0));
    let w = 1.0 - fi * 0.45;
    acc = acc + textureSampleLevel(dest_tex, mask_sampler, sample_uv, 0.0).rgb * w;
    wsum = wsum + w;
  }
  return acc / max(wsum, 1e-5);
}

fn tone_map_mask(hdr: vec3f) -> vec3f {
  let lum = dot(hdr, vec3f(0.2126, 0.7152, 0.0722));
  if (lum <= 1e-6) {
    return vec3f(0.0);
  }

  let knee = 0.42;
  let ceil_lum = 0.90;
  var mapped_lum = lum;
  if (lum > knee) {
    let excess = lum - knee;
    let headroom = ceil_lum - knee;
    mapped_lum = knee + headroom * (excess / (excess + headroom));
  }

  var color = hdr * (mapped_lum / lum);
  let desat = smoothstep(0.95, 4.2, lum) * 0.48;
  let warm_ivory = vec3f(0.96, 0.97, 1.00) * mapped_lum;
  color = mix(color, warm_ivory, desat);

  let peak = max(color.r, max(color.g, color.b));
  if (peak > 0.95) {
    color = color * (0.95 / peak);
  }
  return color;
}

@fragment
fn fs_mask_composite(@builtin(position) frag: vec4f) -> @location(0) vec4f {
  let resolution = max(mask.viewport.xy, vec2f(1.0));
  let uv = frag.xy / resolution;
  let focus_uv = mask.focus.xy;

  let depart_w = mask.envelope.x;
  let dest_w = mask.envelope.y;
  let pull = mask.envelope.w;
  let settle = mask.focus.z;

  var depart_col = vec3f(0.0);
  if (depart_w > 0.0005) {
    depart_col = sample_depart(uv, focus_uv, pull);
  }

  var dest_vis = dest_w;
  if (mask.timing.y >= 0.5) {
    let p = (uv - focus_uv) * vec2f(mask.viewport.z, 1.0);
    let r = length(p);
    let ap = aperture_radius(mask.timing.x);
    let aperture_reveal = 1.0 - smoothstep(ap - 0.08, ap + 0.10, r);
    dest_vis = clamp(max(dest_w, aperture_reveal * smoothstep(0.36, 0.58, mask.timing.x)), 0.0, 1.0);
  }

  var dest_col = vec3f(0.0);
  if (dest_vis > 0.0005) {
    dest_col = sample_dest(uv, focus_uv, settle);
  }

  let void_col = vec3f(0.012, 0.016, 0.028);
  let base = void_col * max(0.0, 1.0 - depart_w - dest_vis)
    + depart_col * depart_w * (1.0 - dest_vis)
    + dest_col * dest_vis;

  let hdr = textureLoad(mask_hdr, vec2i(frag.xy), 0).rgb;
  let mapped = tone_map_mask(hdr);
  let color = base + mapped * (1.0 - base * 0.35);

  return vec4f(clamp(color, vec3f(0.0), vec3f(1.0)), 1.0);
}
