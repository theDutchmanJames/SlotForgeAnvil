const LIMIT = 1_000_000;
function byteView(input) {
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input))
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new Error('Expected STL file bytes.');
}
function indexedTriangles() {
  const verts = [],
    tris = [],
    ids = new Map();
  function point(x, y, z) {
    x = Math.fround(x);
    y = Math.fround(y);
    z = Math.fround(z);
    if (![x, y, z].every(Number.isFinite))
      throw new Error('The STL contains invalid vertex coordinates.');
    const key = `${x},${y},${z}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = verts.length / 3;
      verts.push(x, y, z);
      ids.set(key, id);
    }
    tris.push(id);
  }
  return { point, verts, tris };
}

export function readSTLMesh(input) {
  const bytes = byteView(input);
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = bytes.length >= 84 ? data.getUint32(80, true) : 0;
  const binarySize = 84 + count * 50;
  const asciiHeader = /^\s*solid(?:\s|$)/i.test(
    new TextDecoder().decode(bytes.subarray(0, 256)),
  );
  const target = indexedTriangles();
  if (!asciiHeader || (count > 0 && binarySize <= bytes.length)) {
    if (!count || binarySize > bytes.length)
      throw new Error('The binary STL is empty or truncated.');
    if (count > LIMIT)
      throw new Error(
        `This edition supports up to ${LIMIT.toLocaleString()} STL triangles per import.`,
      );
    for (let i = 0; i < count; i++) {
      let offset = 84 + i * 50 + 12;
      for (let j = 0; j < 3; j++, offset += 12)
        target.point(
          data.getFloat32(offset, true),
          data.getFloat32(offset + 4, true),
          data.getFloat32(offset + 8, true),
        );
    }
  } else {
    if (bytes.length > 180_000_000)
      throw new Error('This ASCII STL exceeds the import size limit.');
    const contents = new TextDecoder().decode(bytes);
    const facets =
      /\bfacet\s+normal\s+\S+\s+\S+\s+\S+\s+outer\s+loop\s+vertex\s+(\S+)\s+(\S+)\s+(\S+)\s+vertex\s+(\S+)\s+(\S+)\s+(\S+)\s+vertex\s+(\S+)\s+(\S+)\s+(\S+)\s+endloop\s+endfacet\b/gi;
    let found = 0;
    for (const m of contents.matchAll(facets)) {
      if (++found > LIMIT)
        throw new Error('This ASCII STL exceeds the triangle limit.');
      for (let j = 1; j < 10; j += 3)
        target.point(Number(m[j]), Number(m[j + 1]), Number(m[j + 2]));
    }
    const declared = contents.match(/\bfacet\b/gi)?.length ?? 0;
    if (!found || found !== declared || !/\bendsolid\b/i.test(contents))
      throw new Error(
        'Malformed ASCII STL. Each facet needs three vertices and an endfacet.',
      );
  }
  return {
    positions: Float32Array.from(target.verts),
    indices: Uint32Array.from(target.tris),
  };
}

// Binary STL in millimetres, with a normal for each triangle.
export function encodeSTL({ positions, indices }, header = 'SlotForge Anvil') {
  const count = indices.length / 3;
  const out = new ArrayBuffer(84 + count * 50);
  const view = new DataView(out);
  const title = new TextEncoder().encode(header.slice(0, 79));
  new Uint8Array(out, 0, 80).set(title);
  view.setUint32(80, count, true);
  let o = 84;
  for (let f = 0; f < count; f++) {
    const a = indices[f * 3] * 3,
      b = indices[f * 3 + 1] * 3,
      c = indices[f * 3 + 2] * 3;
    const ux = positions[b] - positions[a],
      uy = positions[b + 1] - positions[a + 1],
      uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a],
      vy = positions[c + 1] - positions[a + 1],
      vz = positions[c + 2] - positions[a + 2];
    let nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    view.setFloat32(o, nx / len, true);
    view.setFloat32(o + 4, ny / len, true);
    view.setFloat32(o + 8, nz / len, true);
    o += 12;
    for (const v of [a, b, c]) {
      view.setFloat32(o, positions[v], true);
      view.setFloat32(o + 4, positions[v + 1], true);
      view.setFloat32(o + 8, positions[v + 2], true);
      o += 12;
    }
    o += 2;
  }
  return new Uint8Array(out);
}
