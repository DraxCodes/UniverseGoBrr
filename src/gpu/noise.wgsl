// Shared procedural noise, prepended to every WGSL module at compile time.
//
// Two consumers want it for different reasons — the starfield wants sparse point density, the
// planets want continuous surface variation — so it lives in one file rather than being pasted
// into both. Editing this file rebuilds every pipeline.
//
// The 3D forms exist because sampling 2D noise from a 3D direction is what produced the seam on
// gas giants (an `atan2` cut at the 180° meridian) and the radial smear at the poles (a `dir.xz`
// projection that collapses there). 3D noise on the unit direction is continuous everywhere by
// construction: no seam, no pole, no north/south mirroring.

fn hash21(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.x, p.y, p.x) * 0.1031);
  p3 = p3 + dot(p3, vec3f(p3.y, p3.z, p3.x) + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

fn hash31(p: vec3f) -> f32 {
  var p3 = fract(p * 0.1031);
  p3 = p3 + dot(p3, vec3f(p3.y, p3.z, p3.x) + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

fn value_noise(p: vec2f) -> f32 {
  let cell = floor(p);
  let local = fract(p);
  let weight = local * local * (3.0 - 2.0 * local);
  let a = hash21(cell);
  let b = hash21(cell + vec2f(1.0, 0.0));
  let c = hash21(cell + vec2f(0.0, 1.0));
  let d = hash21(cell + vec2f(1.0, 1.0));
  return mix(mix(a, b, weight.x), mix(c, d, weight.x), weight.y);
}

fn value_noise3(p: vec3f) -> f32 {
  let cell = floor(p);
  let local = fract(p);
  let weight = local * local * (3.0 - 2.0 * local);

  let c000 = hash31(cell);
  let c100 = hash31(cell + vec3f(1.0, 0.0, 0.0));
  let c010 = hash31(cell + vec3f(0.0, 1.0, 0.0));
  let c110 = hash31(cell + vec3f(1.0, 1.0, 0.0));
  let c001 = hash31(cell + vec3f(0.0, 0.0, 1.0));
  let c101 = hash31(cell + vec3f(1.0, 0.0, 1.0));
  let c011 = hash31(cell + vec3f(0.0, 1.0, 1.0));
  let c111 = hash31(cell + vec3f(1.0, 1.0, 1.0));

  let x00 = mix(c000, c100, weight.x);
  let x10 = mix(c010, c110, weight.x);
  let x01 = mix(c001, c101, weight.x);
  let x11 = mix(c011, c111, weight.x);

  return mix(mix(x00, x10, weight.y), mix(x01, x11, weight.y), weight.z);
}

// Four octaves of value noise. `salt` decorrelates otherwise-identical calls so a planet's
// continents and its clouds are not the same shape offset.
fn fbm(p: vec2f, salt: f32) -> f32 {
  var sum = 0.0;
  var amplitude = 0.5;
  var q = p + vec2f(salt, salt * 0.61);
  for (var octave = 0; octave < 4; octave = octave + 1) {
    sum = sum + value_noise(q) * amplitude;
    q = q * 2.03 + vec2f(1.7, 9.2);
    amplitude = amplitude * 0.5;
  }
  return sum;
}

// Three octaves, because planets call this several times per fragment: once for the surface,
// twice more for the relief gradient. Four octaves of 3D noise is 32 hashes a call.
fn fbm3(p: vec3f, salt: f32) -> f32 {
  var sum = 0.0;
  var amplitude = 0.5;
  var q = p + vec3f(salt, salt * 0.61, salt * 0.37);
  for (var octave = 0; octave < 3; octave = octave + 1) {
    sum = sum + value_noise3(q) * amplitude;
    q = q * 2.03 + vec3f(1.7, 9.2, 3.4);
    amplitude = amplitude * 0.5;
  }
  return sum;
}