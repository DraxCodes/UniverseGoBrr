/**
 * Unit-sphere geometry for planets. One interleaved buffer: position (3 floats), normal
 * (3 floats), stride 24 bytes. A sphere's normal is its position on the unit sphere, so the
 * second attribute is a copy of the first — 6 floats instead of 3 costs nothing at this size and
 * keeps the shader readable.
 */

export interface SphereMesh {
  /** Interleaved position + normal, `strideFloats` per vertex. */
  readonly vertices: Float32Array;
  readonly indices: Uint16Array;
  readonly indexCount: number;
  readonly strideFloats: number;
  readonly vertexCount: number;
}

export function createSphere(segments = 48, rings = 24): SphereMesh {
  if (segments < 3 || rings < 2) throw new Error('a sphere needs at least 3 segments and 2 rings');

  const vertexCount = (rings + 1) * (segments + 1);
  if (vertexCount > 65535) {
    throw new Error(`sphere has ${vertexCount} vertices; keep it under 65536 for uint16 indices`);
  }

  const vertices = new Float32Array(vertexCount * 6);
  let offset = 0;

  for (let ring = 0; ring <= rings; ring += 1) {
    const phi = (ring / rings) * Math.PI; // 0 at the north pole
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);

    for (let segment = 0; segment <= segments; segment += 1) {
      const theta = (segment / segments) * Math.PI * 2;
      const x = sinPhi * Math.cos(theta);
      const y = cosPhi;
      const z = sinPhi * Math.sin(theta);

      vertices[offset++] = x;
      vertices[offset++] = y;
      vertices[offset++] = z;
      // Normal = position on the unit sphere.
      vertices[offset++] = x;
      vertices[offset++] = y;
      vertices[offset++] = z;
    }
  }

  const indices = new Uint16Array(rings * segments * 6);
  let index = 0;
  for (let ring = 0; ring < rings; ring += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const a = ring * (segments + 1) + segment;
      const b = a + segments + 1;

      // Counter-clockwise when seen from outside.
      indices[index++] = a;
      indices[index++] = b;
      indices[index++] = a + 1;

      indices[index++] = a + 1;
      indices[index++] = b;
      indices[index++] = b + 1;
    }
  }

  return { vertices, indices, indexCount: indices.length, strideFloats: 6, vertexCount };
}

/**
 * A circle in the `xz` plane, as a line list, in star-relative display units. Two vertices per
 * segment so the ring closes exactly; no index buffer, because lines are already cheap.
 *
 * Four floats per vertex: `xyz` and the ring's radius. The shader needs the radius to decide
 * whether the eye is outside this ring — it is not derivable from the position once the ring is
 * tilted into the view.
 */
export function createOrbitRing(radius: number, segments = 160): Float32Array {
  const vertices = new Float32Array(segments * 2 * 4);
  let offset = 0;
  for (let segment = 0; segment < segments; segment += 1) {
    const a = (segment / segments) * Math.PI * 2;
    const b = ((segment + 1) / segments) * Math.PI * 2;
    vertices[offset++] = Math.cos(a) * radius;
    vertices[offset++] = 0;
    vertices[offset++] = Math.sin(a) * radius;
    vertices[offset++] = radius;
    vertices[offset++] = Math.cos(b) * radius;
    vertices[offset++] = 0;
    vertices[offset++] = Math.sin(b) * radius;
    vertices[offset++] = radius;
  }
  return vertices;
}