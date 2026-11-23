// Shooting rays at the model, for "which side is outside" and wall thickness.
import { BufferAttribute, BufferGeometry, DoubleSide, Ray, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';

export function rayCaster(positions, indices) {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(positions, 3));
  // The tree reorders its index; give it a copy.
  geo.setIndex(new BufferAttribute(Uint32Array.from(indices), 1));
  const bvh = new MeshBVH(geo);
  const ray = new Ray();
  const o = new Vector3(), d = new Vector3();
  // Distance to the first surface along dir, or Infinity.
  return (origin, dir) => {
    ray.set(o.set(origin[0], origin[1], origin[2]), d.set(dir[0], dir[1], dir[2]));
    const hit = bvh.raycastFirst(ray, DoubleSide);
    return hit ? hit.distance : Infinity;
  };
}

export function faceFrame(positions, indices, f) {
  const a = indices[f * 3] * 3, b = indices[f * 3 + 1] * 3, c = indices[f * 3 + 2] * 3;
  const centre = [0, 1, 2].map((k) => (positions[a + k] + positions[b + k] + positions[c + k]) / 3);
  const u = [0, 1, 2].map((k) => positions[b + k] - positions[a + k]);
  const v = [0, 1, 2].map((k) => positions[c + k] - positions[a + k]);
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const l = Math.hypot(...n);
  return { centre, normal: l ? n.map((x) => x / l) : null, area: l / 2 };
}

// Spread samples over a list of faces without randomness (results repeat).
export function sampleFaces(faces, count) {
  if (faces.length <= count) return faces;
  const out = [];
  const step = faces.length / count;
  for (let i = 0; i < count; i++) out.push(faces[Math.floor(i * step)]);
  return out;
}
