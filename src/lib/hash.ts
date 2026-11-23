/** FNV-1a, 32-bit. Stable across platforms, cheap, and good enough for placeholder work. */
export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Map a string seed into [0, 1) for shader uniforms. */
export function seedUnit(seed: string): number {
  return fnv1a32(seed) / 0x1_0000_0000;
}