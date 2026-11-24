// The 3D view: the car, the original for comparison, the section cut,
// measuring and picking. Z is up; the car stands on Z = 0 with its front at low X.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const css = (name, fallback) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

// The camera's up stays Z, so turning the view always feels the same.
// Top and under lean a hair off vertical to keep the front on the left.
const VIEWS = {
  side: [0, -1, 0],
  top: [0, -1e-4, 1],
  front: [-1, 0, 0],
  rear: [1, 0, 0],
  under: [0, -1e-4, -1],
  '3d': [-0.9, -1.25, 0.75],
};

export class Viewport {
  constructor(host) {
    this.host = host;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.localClippingEnabled = true;
    host.prepend(this.renderer.domElement);
    this.canvas = this.renderer.domElement;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(css('--canvas', '#191d23'));
    this.perspective = new THREE.PerspectiveCamera(30, 1, 0.5, 20000);
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -20000, 20000);
    for (const c of [this.perspective, this.ortho]) c.up.set(0, 0, 1);
    this.camera = this.ortho;
    this.makeControls();

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x30343a, 1.6));
    this.key = new THREE.DirectionalLight(0xffffff, 1.6);
    this.scene.add(this.key);

    this.clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
    this.clipping = [];
    this.groundGroup = new THREE.Group();
    this.scene.add(this.groundGroup);
    this.overlay = new THREE.Group();
    this.scene.add(this.overlay);

    this.ray = new THREE.Raycaster();
    this.ray.firstHitOnly = true;
    this.labels = [];
    this.size = 200;
    this.needsRender = true;

    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    const loop = () => {
      requestAnimationFrame(loop);
      if (!this.needsRender) return;
      this.needsRender = false;
      this.key.position.copy(this.camera.position).add(new THREE.Vector3(0, 0, this.size));
      this.renderer.render(this.scene, this.camera);
      for (const l of this.labels) this.placeLabel(l);
    };
    loop();
  }

  render() {
    this.needsRender = true;
  }

  // The theme changed: the 3D view takes the canvas colour its box shows.
  retheme() {
    const c = getComputedStyle(this.host).backgroundColor;
    if (c && c !== 'rgba(0, 0, 0, 0)') this.scene.background = new THREE.Color(c);
    if (this.box) this.drawGround();
    this.render();
  }

  makeControls() {
    const target = this.controls?.target.clone();
    this.controls?.dispose();
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = false;
    this.controls.zoomToCursor = true;
    if (target) this.controls.target.copy(target);
    this.controls.addEventListener('change', () => this.render());
    this.setOrbitButton(this.orbitButton ?? 'left');
    if (this.transform) this.transform.camera = this.camera;
  }

  // Which mouse button turns the view: left in look mode, right while a tool uses the left.
  setOrbitButton(which) {
    this.orbitButton = which;
    const M = THREE.MOUSE;
    this.controls.mouseButtons =
      which === 'left'
        ? { LEFT: M.ROTATE, MIDDLE: M.PAN, RIGHT: M.PAN }
        : { LEFT: null, MIDDLE: M.PAN, RIGHT: M.ROTATE };
  }

  resize() {
    const w = this.host.clientWidth || 1,
      h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.perspective.aspect = w / h;
    this.perspective.updateProjectionMatrix();
    this.fitOrtho();
    this.render();
  }

  fitOrtho() {
    const w = this.host.clientWidth || 1,
      h = this.host.clientHeight || 1;
    const half = this.orthoHalf ?? 100;
    this.ortho.left = (-half * w) / h;
    this.ortho.right = (half * w) / h;
    this.ortho.top = half;
    this.ortho.bottom = -half;
    this.ortho.updateProjectionMatrix();
  }

  setPerspective(on) {
    const from = this.camera,
      to = on ? this.perspective : this.ortho;
    if (from === to) return;
    const target = this.controls.target.clone();
    const dir = from.position.clone().sub(target).normalize();
    if (on) {
      // Same framing: distance that shows the ortho height.
      const visible = (this.ortho.top - this.ortho.bottom) / this.ortho.zoom;
      const dist = visible / 2 / Math.tan(THREE.MathUtils.degToRad(this.perspective.fov / 2));
      to.position.copy(target).addScaledVector(dir, dist);
    } else {
      const dist = from.position.distanceTo(target);
      this.orthoHalf = dist * Math.tan(THREE.MathUtils.degToRad(this.perspective.fov / 2));
      this.ortho.zoom = 1;
      this.fitOrtho();
      to.position.copy(target).addScaledVector(dir, this.size * 4);
    }
    to.up.copy(from.up);
    this.camera = to;
    this.makeControls();
    this.controls.target.copy(target);
    this.controls.update();
    this.render();
  }

  view(name) {
    const v = VIEWS[name];
    if (!v || !this.box) return;
    const center = this.box.getCenter(new THREE.Vector3());
    const size = this.box.getSize(new THREE.Vector3());
    const eye = new THREE.Vector3(...v).normalize();
    this.camera.up.set(0, 0, 1);
    // Frame the car: extent across the screen for this direction.
    const right = new THREE.Vector3().crossVectors(this.camera.up, eye).normalize();
    const up = new THREE.Vector3().crossVectors(eye, right).normalize();
    const extent = (axis) =>
      Math.abs(axis.x) * size.x + Math.abs(axis.y) * size.y + Math.abs(axis.z) * size.z;
    const w = this.host.clientWidth || 1,
      h = this.host.clientHeight || 1;
    const half = Math.max(extent(up) / 2, (extent(right) / 2) * (h / w)) * 1.18;
    this.orthoHalf = half;
    this.ortho.zoom = 1;
    this.fitOrtho();
    const dist = half / Math.tan(THREE.MathUtils.degToRad(this.perspective.fov / 2));
    this.camera.position.copy(center).addScaledVector(eye, this.camera === this.ortho ? this.size * 4 : dist);
    this.camera.lookAt(center);
    this.makeControls();
    this.controls.target.copy(center);
    this.controls.update();
    this.render();
  }

  // ------------------------------------------------------------ the car

  setModel(result) {
    const { positions, indices } = result;
    this.disposeModel();
    this.indices = indices;
    this.positions = positions;
    this.faceCount = indices.length / 3;

    const indexed = new THREE.BufferGeometry();
    indexed.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    indexed.setIndex(new THREE.BufferAttribute(indices, 1));
    // Smooth where the surface is smooth, sharp at panel edges. Face i of the
    // result is still face i of the model.
    const geo = toCreasedNormals(indexed, THREE.MathUtils.degToRad(32));
    indexed.dispose();
    this.base = null;
    this.lastMask = null;
    const colors = new Float32Array(geo.attributes.position.count * 3).fill(1);
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    // indirect: keep the triangle order, so BVH face numbers are model face numbers.
    geo.computeBoundsTree({ indirect: true });
    this.geometry = geo;

    this.bodyMaterial = new THREE.MeshStandardMaterial({
      color: 0xc9ced6,
      roughness: 0.55,
      metalness: 0.05,
      vertexColors: true,
      side: THREE.FrontSide,
      clippingPlanes: this.clipping,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    this.insideMaterial = new THREE.MeshStandardMaterial({
      color: 0x5d6570,
      roughness: 0.8,
      side: THREE.BackSide,
      clippingPlanes: this.clipping,
    });
    this.body = new THREE.Mesh(geo, this.bodyMaterial);
    this.inside = new THREE.Mesh(geo, this.insideMaterial);
    this.inside.raycast = () => {};
    this.scene.add(this.body, this.inside);

    // Per-face centres and normals, for lasso and mirrored selection.
    const n = this.faceCount;
    this.centres = new Float32Array(n * 3);
    this.normals = new Float32Array(n * 3);
    for (let f = 0; f < n; f++) {
      const a = indices[f * 3] * 3, b = indices[f * 3 + 1] * 3, c = indices[f * 3 + 2] * 3;
      for (let k = 0; k < 3; k++)
        this.centres[f * 3 + k] = (positions[a + k] + positions[b + k] + positions[c + k]) / 3;
      const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
      const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      this.normals[f * 3] = nx / l;
      this.normals[f * 3 + 1] = ny / l;
      this.normals[f * 3 + 2] = nz / l;
    }
    this.mirrorMap = null;

    const first = !this.box;
    this.box = new THREE.Box3().setFromBufferAttribute(geo.attributes.position);
    this.size = Math.max(1, this.box.getSize(new THREE.Vector3()).length());
    this.drawGround();
    if (result.original) this.setOriginal(result.original);
    if (first) this.view('3d');
    this.render();
  }

  disposeModel() {
    for (const m of [this.body, this.inside]) if (m) this.scene.remove(m);
    this.geometry?.disposeBoundsTree();
    this.geometry?.dispose();
    this.bodyMaterial?.dispose();
    this.insideMaterial?.dispose();
    this.body = this.inside = this.geometry = null;
  }

  clear() {
    this.disposeModel();
    this.setOriginal(null);
    this.box = null;
    this.groundGroup.clear();
    this.clearOverlay();
    this.render();
  }

  setOriginal(mesh) {
    if (this.original) {
      this.scene.remove(this.original);
      this.original.geometry.dispose();
      this.original.material.dispose();
      this.original = null;
    }
    if (!mesh) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    geo.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    this.original = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        color: 0x3b9cff,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        side: THREE.DoubleSide,
        clippingPlanes: this.clipping,
      }),
    );
    this.original.raycast = () => {};
    this.original.visible = !!this.showOriginal;
    this.original.renderOrder = 2;
    this.scene.add(this.original);
  }

  setShowOriginal(on) {
    this.showOriginal = on;
    if (this.original) this.original.visible = on;
    this.render();
  }

  drawGround() {
    this.groundGroup.clear();
    if (!this.box) return;
    const size = this.box.getSize(new THREE.Vector3());
    const span = Math.ceil((Math.max(size.x, size.y) * 1.6) / 10) * 10;
    // Grid lines a little towards the text colour from the canvas, so they suit either theme.
    const base = this.scene.background.clone(), ink = new THREE.Color(css('--ink', '#e8e6e1'));
    const grid = new THREE.GridHelper(span, span / 10, base.clone().lerp(ink, 0.16), base.clone().lerp(ink, 0.07));
    grid.rotation.x = Math.PI / 2;
    grid.position.set(0, 0, -0.01);
    this.groundGroup.add(grid);
    // The centre line the mirror works across.
    const x = size.x / 2 + 12;
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-x, 0, 0.02), new THREE.Vector3(x, 0, 0.02)]),
      new THREE.LineDashedMaterial({ color: 0x98a0ab, dashSize: 3, gapSize: 2 }),
    );
    line.computeLineDistances();
    line.visible = !!this.showCentre;
    this.centreLine = line;
    this.groundGroup.add(line);
  }

  setShowCentre(on) {
    this.showCentre = on;
    if (this.centreLine) this.centreLine.visible = on;
    this.render();
  }

  // ------------------------------------------------------------ section

  setSection(section) {
    this.clipping.length = 0;
    if (section) {
      const k = 'xyz'.indexOf(section.axis);
      const normal = new THREE.Vector3();
      normal.setComponent(k, section.flip ? 1 : -1);
      this.clip.set(normal, section.flip ? -section.at : section.at);
      this.clipping.push(this.clip);
      if (this.insideMaterial) this.insideMaterial.color.set(0xd6383e);
    } else if (this.insideMaterial) this.insideMaterial.color.set(0x5d6570);
    for (const m of [this.bodyMaterial, this.insideMaterial, this.original?.material])
      if (m) m.needsUpdate = true;
    this.render();
  }

  // ------------------------------------------------------------ selection colours

  paintSelection(mask, sel = [0.93, 0.36, 0.38]) {
    if (!this.geometry) return;
    this.lastMask = mask;
    const color = this.geometry.attributes.color;
    const arr = color.array;
    const base = this.base;
    for (let f = 0; f < this.faceCount; f++) {
      const on = mask && mask[f];
      for (let v = 0; v < 3; v++) {
        const o = (f * 3 + v) * 3;
        arr[o] = on ? sel[0] : base ? base[o] : 1;
        arr[o + 1] = on ? sel[1] : base ? base[o + 1] : 1;
        arr[o + 2] = on ? sel[2] : base ? base[o + 2] : 1;
      }
    }
    color.needsUpdate = true;
    this.render();
  }

  // Colour the car by wall thickness. values: one per vertex of the model.
  // Red below min, then blue (thin) – green (the wall asked for) – amber (thick).
  setHeat(values, { min, mid, max } = {}) {
    if (!this.geometry) return;
    if (!values) {
      this.base = null;
      this.bodyMaterial.color.set(0xc9ced6);
    } else {
      const stops = [
        [0.23, 0.61, 1],
        [0.37, 0.82, 0.41],
        [0.95, 0.72, 0.29],
      ];
      const red = [0.9, 0.28, 0.3],
        grey = [0.55, 0.58, 0.62];
      const colorOf = (t) => {
        if (!Number.isFinite(t)) return grey;
        if (t < min) return red;
        const u = t <= mid ? (0.5 * (t - min)) / Math.max(mid - min, 1e-6) : 0.5 + (0.5 * (t - mid)) / Math.max(max - mid, 1e-6);
        const s = Math.min(1, Math.max(0, u));
        const [a, b, k] = s <= 0.5 ? [stops[0], stops[1], s / 0.5] : [stops[1], stops[2], (s - 0.5) / 0.5];
        return a.map((x, i) => x + (b[i] - x) * k);
      };
      this.base = new Float32Array(this.faceCount * 9);
      for (let f = 0; f < this.faceCount; f++)
        for (let v = 0; v < 3; v++) {
          const c = colorOf(values[this.indices[f * 3 + v]]);
          this.base.set(c, (f * 3 + v) * 3);
        }
      this.bodyMaterial.color.set(0xffffff);
    }
    this.paintSelection(this.lastMask);
  }

  // ------------------------------------------------------------ picking

  pick(event) {
    if (!this.body) return null;
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((event.clientX - r.left) / r.width) * 2 - 1,
      -((event.clientY - r.top) / r.height) * 2 + 1,
    );
    this.ray.setFromCamera(ndc, this.camera);
    this.ray.firstHitOnly = !this.clipping.length;
    const hits = this.bothSides(() => this.ray.intersectObject(this.body, false));
    // Respect the section cut: ignore what it hides.
    const hit = hits.find((h) => !this.clipping.length || this.clip.distanceToPoint(h.point) >= 0);
    if (!hit) return null;
    const normal = new THREE.Vector3(...this.normals.subarray(hit.faceIndex * 3, hit.faceIndex * 3 + 3));
    return { point: hit.point.clone(), face: hit.faceIndex, normal };
  }

  // Wall thickness at a picked point: shoot inwards and find the inner surface.
  thicknessAt(hit) {
    const dir = hit.normal.clone().negate();
    const origin = hit.point.clone().addScaledVector(dir, 1e-3);
    const ray = new THREE.Raycaster(origin, dir, 0, this.size);
    ray.firstHitOnly = true;
    const back = this.bothSides(() => ray.intersectObject(this.body, false))[0];
    if (!back) return null;
    return { distance: back.distance + 1e-3, end: back.point.clone() };
  }

  // Hits on the inside of a shell count too.
  bothSides(fn) {
    const side = this.bodyMaterial.side;
    this.bodyMaterial.side = THREE.DoubleSide;
    try {
      return fn();
    } finally {
      this.bodyMaterial.side = side;
    }
  }

  // Faces inside a sphere (brush).
  facesInSphere(center, radius, frontOnly) {
    const out = [];
    const sphere = new THREE.Sphere(center, radius);
    const view = this.viewDirection();
    const c = this.centres, n = this.normals;
    this.geometry.boundsTree.shapecast({
      intersectsBounds: (box) => sphere.intersectsBox(box),
      intersectsTriangle: (tri, i) => {
        const dx = c[i * 3] - center.x, dy = c[i * 3 + 1] - center.y, dz = c[i * 3 + 2] - center.z;
        if (dx * dx + dy * dy + dz * dz > radius * radius) return false;
        if (frontOnly && n[i * 3] * view.x + n[i * 3 + 1] * view.y + n[i * 3 + 2] * view.z > 0.05) return false;
        if (this.clipping.length && this.clip.distanceToPoint(new THREE.Vector3(c[i * 3], c[i * 3 + 1], c[i * 3 + 2])) < 0) return false;
        out.push(i);
        return false;
      },
    });
    return out;
  }

  viewDirection() {
    return this.controls.target.clone().sub(this.camera.position).normalize();
  }

  // Faces whose centre falls inside a screen polygon (lasso).
  facesInPolygon(points, frontOnly) {
    const r = this.canvas.getBoundingClientRect();
    const m = new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    const e = m.elements;
    const poly = points.map(([x, y]) => [((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1]);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of poly) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const view = this.viewDirection();
    const camPos = this.camera.position;
    const persp = this.camera === this.perspective;
    const out = [];
    const c = this.centres, n = this.normals;
    const p = new THREE.Vector3();
    for (let f = 0; f < this.faceCount; f++) {
      const x = c[f * 3], y = c[f * 3 + 1], z = c[f * 3 + 2];
      const w = e[3] * x + e[7] * y + e[11] * z + e[15];
      const sx = (e[0] * x + e[4] * y + e[8] * z + e[12]) / w;
      const sy = (e[1] * x + e[5] * y + e[9] * z + e[13]) / w;
      if (sx < minX || sx > maxX || sy < minY || sy > maxY) continue;
      if (frontOnly) {
        const vx = persp ? x - camPos.x : view.x, vy = persp ? y - camPos.y : view.y, vz = persp ? z - camPos.z : view.z;
        if (n[f * 3] * vx + n[f * 3 + 1] * vy + n[f * 3 + 2] * vz > 0) continue;
      }
      if (this.clipping.length && this.clip.distanceToPoint(p.set(x, y, z)) < 0) continue;
      if (inside(sx, sy, poly)) out.push(f);
    }
    return out;
  }

  // Face across the centre line, for mirrored selection.
  mirrorOf(face) {
    if (!this.mirrorMap) this.buildMirrorMap();
    return this.mirrorMap[face];
  }

  buildMirrorMap() {
    const n = this.faceCount, c = this.centres;
    const cell = Math.max(0.2, Math.cbrt((this.box.getSize(new THREE.Vector3()).toArray().reduce((a, b) => a * Math.max(b, 1), 1)) / n) * 2);
    const grid = new Map();
    const key = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
    for (let f = 0; f < n; f++) {
      const k = key(c[f * 3], c[f * 3 + 1], c[f * 3 + 2]);
      const list = grid.get(k);
      if (list) list.push(f);
      else grid.set(k, [f]);
    }
    const map = new Int32Array(n).fill(-1);
    for (let f = 0; f < n; f++) {
      const x = c[f * 3], y = -c[f * 3 + 1], z = c[f * 3 + 2];
      const gx = Math.floor(x / cell), gy = Math.floor(y / cell), gz = Math.floor(z / cell);
      let best = -1, bestD = (cell * 1.5) ** 2;
      for (let i = -1; i <= 1; i++)
        for (let j = -1; j <= 1; j++)
          for (let k = -1; k <= 1; k++)
            for (const g of grid.get(`${gx + i},${gy + j},${gz + k}`) ?? []) {
              const d = (c[g * 3] - x) ** 2 + (c[g * 3 + 1] - y) ** 2 + (c[g * 3 + 2] - z) ** 2;
              if (d < bestD) {
                bestD = d;
                best = g;
              }
            }
      map[f] = best;
    }
    this.mirrorMap = map;
  }

  // ------------------------------------------------------------ overlays

  clearOverlay() {
    this.overlay.clear();
    for (const l of this.labels) l.el.remove();
    this.labels = [];
    this.render();
  }

  marker(point, color = 0xffffff) {
    const s = this.size * 0.006;
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(s, 16, 12),
      new THREE.MeshBasicMaterial({ color, depthTest: false }),
    );
    m.position.copy(point);
    m.renderOrder = 10;
    this.overlay.add(m);
    this.render();
  }

  segment(a, b, color = 0xffffff) {
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([a, b]),
      new THREE.LineBasicMaterial({ color, depthTest: false }),
    );
    line.renderOrder = 10;
    this.overlay.add(line);
    this.render();
  }

  label(point, text) {
    const el = document.createElement('div');
    el.className = 'vp-label';
    el.textContent = text;
    this.host.append(el);
    const l = { el, point: point.clone() };
    this.labels.push(l);
    this.placeLabel(l);
    return el;
  }

  placeLabel(l) {
    const p = l.point.clone().project(this.camera);
    l.el.style.left = `${((p.x + 1) / 2) * this.host.clientWidth}px`;
    l.el.style.top = `${((1 - p.y) / 2) * this.host.clientHeight}px`;
    l.el.hidden = p.z > 1;
  }

  // A see-through plane, for the slice tool and the section.
  // tilt: { tilt (degrees), lean, pivot } turns it as the slice step does.
  planeGuide(axis, at, color = 0xe5484d, tilt = null) {
    if (this.guide) {
      this.scene.remove(this.guide);
      this.guide.geometry.dispose();
      this.guide = null;
    }
    if (axis == null || !this.box) return this.render();
    const size = this.box.getSize(new THREE.Vector3()).multiplyScalar(1.15);
    const center = this.box.getCenter(new THREE.Vector3());
    if (tilt?.tilt) return this.tiltedGuide(axis, at, color, tilt, size, center);
    const dims = { x: [size.y, size.z], y: [size.x, size.z], z: [size.x, size.y] }[axis];
    const geo = new THREE.PlaneGeometry(dims[0], dims[1]);
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }),
    );
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color }));
    mesh.add(edge);
    if (axis === 'x') mesh.rotation.set(Math.PI / 2, Math.PI / 2, 0);
    if (axis === 'y') mesh.rotation.set(Math.PI / 2, 0, 0);
    mesh.position.copy(center).setComponent('xyz'.indexOf(axis), at);
    mesh.renderOrder = 3;
    this.guide = mesh;
    this.scene.add(mesh);
    this.render();
  }

  // ------------------------------------------------------------ cut off

  // The cutting planes of Cut off. state: { cuts, active, mirror, mode
  // ('translate' | 'rotate' | 'scale') } or null. The active plane gets
  // handles; onChange(cut) gets it back after each drag, as
  // { at, normal, up, w, h }. Mirror copies show as outlines.
  setCutter(state, onChange) {
    this.cutterChange = onChange;
    if (!this.cutters) {
      this.cutters = new THREE.Group();
      this.scene.add(this.cutters);
    }
    for (const c of this.cutters.children) c.traverse((o) => o.geometry?.dispose());
    this.cutters.clear();
    if (!state?.cuts?.length) {
      if (this.transform) {
        this.transform.detach();
        this.transform.enabled = false;
        this.transform.getHelper().visible = false;
      }
      return this.render();
    }
    const make = (cut, kind) => {
      const g = new THREE.Group();
      const n = new THREE.Vector3(...cut.normal).normalize();
      let up = new THREE.Vector3(...(cut.up ?? [0, 0, 1]));
      up.addScaledVector(n, -up.dot(n));
      if (up.lengthSq() < 1e-9) up = new THREE.Vector3().crossVectors(n, Math.abs(n.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0));
      up.normalize();
      const v = new THREE.Vector3().crossVectors(n, up);
      g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(up, v, n));
      g.position.set(...cut.at);
      g.scale.set(cut.w, cut.h, Math.min(cut.w, cut.h));
      const color = kind === 'active' ? 0xe5484d : kind === 'copy' ? 0xf0a0a3 : 0xc0646a;
      const geo = new THREE.PlaneGeometry(1, 1);
      const face = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: kind === 'active' ? 0.28 : 0.14, side: THREE.DoubleSide, depthWrite: false }));
      face.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color })));
      face.renderOrder = 4;
      g.add(face);
      // An arrow towards the side that goes.
      const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(), 0.7, color, 0.22, 0.14);
      g.add(arrow);
      this.cutters.add(g);
      return g;
    };
    let active = null;
    state.cuts.forEach((cut, i) => {
      const g = make(cut, i === state.active ? 'active' : 'other');
      if (i === state.active) active = g;
      if (state.mirror) make({ ...cut, at: [cut.at[0], -cut.at[1], cut.at[2]], normal: [cut.normal[0], -cut.normal[1], cut.normal[2]], up: cut.up && [cut.up[0], -cut.up[1], cut.up[2]] }, 'copy');
    });
    if (!this.transform) {
      this.transform = new TransformControls(this.camera, this.canvas);
      this.transform.setSpace('local');
      this.transform.addEventListener('change', () => this.render());
      this.transform.addEventListener('dragging-changed', (e) => {
        this.controls.enabled = !e.value;
        this.cutterDragging = e.value;
        if (!e.value && this.transform.object) this.cutterChange?.(this.cutOf(this.transform.object));
      });
      this.transform.addEventListener('objectChange', () => {
        const o = this.transform.object;
        if (!o) return;
        // Keep the arrow and the depth in step with the smaller side.
        o.scale.z = Math.min(o.scale.x, o.scale.y);
        this.cutterMoved?.(this.cutOf(o));
      });
      this.scene.add(this.transform.getHelper());
    }
    this.transform.camera = this.camera;
    this.transform.enabled = !!active;
    this.transform.getHelper().visible = !!active;
    this.transform.setMode(state.mode ?? 'translate');
    this.transform.showZ = state.mode !== 'scale';
    if (active) this.transform.attach(active);
    else this.transform.detach();
    this.render();
  }

  cutOf(o) {
    const q = o.quaternion;
    const u = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const n = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const r = (x) => Math.round(x * 1e4) / 1e4;
    return { at: o.position.toArray().map(r), normal: n.toArray().map(r), up: u.toArray().map(r), w: r(Math.abs(o.scale.x)), h: r(Math.abs(o.scale.y)) };
  }

  tiltedGuide(axis, at, color, { tilt, lean, pivot }, size, center) {
    const k = 'xyz'.indexOf(axis),
      i = 'xyz'.indexOf(lean),
      j = 3 - k - i;
    const a = (tilt * Math.PI) / 180;
    // Along the slope, along the line it turns about, and the facing.
    const ex = new THREE.Vector3().setComponent(i, Math.cos(a)).setComponent(k, Math.sin(a));
    const ey = new THREE.Vector3().setComponent(j, 1);
    const ez = new THREE.Vector3().crossVectors(ex, ey);
    const along = size.getComponent(i) / Math.max(0.2, Math.cos(a));
    const geo = new THREE.PlaneGeometry(along, size.getComponent(j));
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }),
    );
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color })));
    mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(ex, ey, ez));
    const c = center.clone().setComponent(k, at).setComponent(i, pivot);
    // Centre it over the model along the slope.
    const shift = center.getComponent(i) - pivot;
    mesh.position.copy(c).addScaledVector(ex, shift / Math.cos(a));
    mesh.renderOrder = 3;
    this.guide = mesh;
    this.scene.add(mesh);
    this.render();
  }

  // Quick preview of a hammer blow on the shape on screen, until the real
  // rebuild arrives. Moves everything within the head along the surface's facing.
  previewBlow(at, radius, depth) {
    if (!this.geometry) return;
    const pos = this.geometry.attributes.position;
    const nor = this.geometry.attributes.normal;
    const p = pos.array, n = nor.array;
    // Facing under the head.
    const f = [0, 0, 0];
    const r2 = radius * radius;
    for (let i = 0; i < p.length; i += 3) {
      const d2 = (p[i] - at[0]) ** 2 + (p[i + 1] - at[1]) ** 2 + (p[i + 2] - at[2]) ** 2;
      if (d2 < r2 * 0.25) for (let c = 0; c < 3; c++) f[c] += n[i + c];
    }
    const fl = Math.hypot(...f);
    if (!fl) return;
    for (let c = 0; c < 3; c++) f[c] /= fl;
    for (let i = 0; i < p.length; i += 3) {
      const d2 = (p[i] - at[0]) ** 2 + (p[i + 1] - at[1]) ** 2 + (p[i + 2] - at[2]) ** 2;
      if (d2 >= r2) continue;
      if (n[i] * f[0] + n[i + 1] * f[1] + n[i + 2] * f[2] < 0) continue;
      const w = (1 - d2 / r2) ** 2 * depth;
      for (let c = 0; c < 3; c++) p[i + c] += f[c] * w;
    }
    pos.needsUpdate = true;
    this.geometry.boundsTree?.refit();
    this.render();
  }

  // The chassis as a see-through blue ghost: tyres, axles, deck and guide.
  setGhost(c, ground, mesh = null) {
    if (this.ghost) {
      this.scene.remove(this.ghost);
      this.ghost.traverse((o) => {
        o.geometry?.dispose();
        o.material?.dispose();
      });
      this.ghost = null;
    }
    if (!c) return this.render();
    const g = new THREE.Group();
    const fill = () => new THREE.MeshBasicMaterial({ color: 0x3b9cff, transparent: true, opacity: 0.18, depthTest: false, depthWrite: false });
    const line = () => new THREE.LineBasicMaterial({ color: 0x6fb6ff, transparent: true, opacity: 0.9, depthTest: false });
    const add = (geo, x, y, z, edges = true) => {
      const m = new THREE.Mesh(geo, fill());
      m.position.set(x, y, z);
      m.renderOrder = 20;
      g.add(m);
      if (edges) {
        const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), line());
        e.position.copy(m.position);
        e.renderOrder = 21;
        g.add(e);
      }
      return m;
    };
    const axles = [
      [c.frontX, c.front],
      [c.frontX + c.wheelbase, c.rear],
    ];
    for (const [x, t] of axles) {
      const z = ground + t.diameter / 2;
      for (const side of [-1, 1]) add(new THREE.CylinderGeometry(t.diameter / 2, t.diameter / 2, t.width, 40, 1), x, side * t.inOut, z);
      add(new THREE.CylinderGeometry(t.diameter * 0.04, t.diameter * 0.04, t.inOut * 2, 8), x, 0, z, false);
    }
    if (mesh) {
      // The chassis's own file, as a see-through ghost.
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
      geo.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
      const m = new THREE.Mesh(geo, fill());
      m.material.opacity = 0.22;
      m.renderOrder = 20;
      g.add(m);
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 35), line());
      e.material.opacity = 0.55;
      e.renderOrder = 21;
      g.add(e);
    }
    // Deck: between the axles, inside the tyres (not needed with a chassis file).
    const inner = Math.min(c.front.inOut - c.front.width / 2, c.rear.inOut - c.rear.width / 2) * 2 * 0.9;
    const len = c.wheelbase + c.front.diameter * 0.6;
    if (!mesh) add(new THREE.BoxGeometry(len, Math.max(inner, 1), Math.max(c.deck * 0.15, 0.5)), c.frontX + c.wheelbase / 2, 0, ground + c.deck);
    // Guide blade ahead of the front axle, down in the slot.
    const blade = c.front.diameter * 0.35;
    if (!mesh) add(new THREE.BoxGeometry(blade, Math.max(c.front.diameter * 0.05, 0.4), blade * 0.7), c.frontX - c.guideAhead, 0, ground + blade * 0.15);
    // The track surface.
    const track = new THREE.Mesh(
      new THREE.PlaneGeometry(len * 1.6, (c.rear.inOut + c.rear.width) * 2.4),
      new THREE.MeshBasicMaterial({ color: 0x3b9cff, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide }),
    );
    track.position.set(c.frontX + c.wheelbase / 2, 0, ground);
    g.add(track);
    this.ghost = g;
    this.scene.add(g);
    this.render();
  }

  // Outlines of openings: amber, red when chosen, white under the pointer.
  outlines(list, hover = null, chosen = new Set()) {
    if (this.loopGroup) {
      this.scene.remove(this.loopGroup);
      this.loopGroup.traverse((o) => o.geometry?.dispose());
      this.loopGroup = null;
    }
    if (list) {
      this.loopGroup = new THREE.Group();
      for (const o of list) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(o.points, 3));
        const color = hover === o.id ? 0xffffff : chosen.has(o.id) ? 0xe5484d : 0xf2b705;
        const line = new THREE.LineLoop(geo, new THREE.LineBasicMaterial({ color, depthTest: hover !== o.id, transparent: true }));
        line.renderOrder = hover === o.id ? 13 : 12;
        this.loopGroup.add(line);
      }
      this.scene.add(this.loopGroup);
    }
    this.render();
  }

  // Window outlines from the line tool. list: [{ points: [[x,y,z]...], color,
  // closed, handles: [[x,y,z]...], corners: [bool], active }]
  curves(list) {
    if (this.curveGroup) {
      this.scene.remove(this.curveGroup);
      this.curveGroup.traverse((o) => {
        o.geometry?.dispose();
        o.material?.dispose();
      });
      this.curveGroup = null;
    }
    if (list?.length) {
      const g = new THREE.Group();
      const s = this.size * 0.005;
      for (const c of list) {
        if (c.points.length >= 2) {
          const geo = new THREE.BufferGeometry().setFromPoints(c.points.map((p) => new THREE.Vector3(...p)));
          const Line = c.closed ? THREE.LineLoop : THREE.Line;
          const line = new Line(geo, new THREE.LineBasicMaterial({ color: c.color, depthTest: false, transparent: true, opacity: c.active ? 1 : 0.85 }));
          line.renderOrder = 14;
          g.add(line);
        }
        (c.handles ?? []).forEach((p, i) => {
          const corner = c.corners?.[i];
          const geo = corner ? new THREE.BoxGeometry(s * 1.7, s * 1.7, s * 1.7) : new THREE.SphereGeometry(s, 12, 8);
          const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: i === 0 && c.first ? 0x3ddc84 : 0xffffff, depthTest: false }));
          m.position.set(...p);
          m.renderOrder = 15;
          g.add(m);
        });
      }
      this.curveGroup = g;
      this.scene.add(g);
    }
    this.render();
  }

  // Where a point in the scene is on screen, in page pixels.
  screenOf(p) {
    const v = new THREE.Vector3(...p).project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height, behind: v.z > 1 };
  }

  // Added parts printed on their own: see-through violet, where they go.
  setExtras(mesh) {
    if (this.extras) {
      this.scene.remove(this.extras);
      this.extras.geometry.dispose();
      this.extras.material.dispose();
      this.extras = null;
    }
    if (mesh) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
      geo.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
      geo.computeVertexNormals();
      this.extras = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x9b8cff, transparent: true, opacity: 0.6, roughness: 0.6, depthWrite: false }));
      this.extras.renderOrder = 17;
      this.scene.add(this.extras);
    }
    this.render();
  }

  // The window buck, see-through amber inside the body.
  setBuck(mesh) {
    if (this.buck) {
      this.scene.remove(this.buck);
      this.buck.traverse((o) => {
        o.geometry?.dispose();
        o.material?.dispose();
      });
      this.buck = null;
    }
    if (mesh) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
      geo.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
      geo.computeVertexNormals();
      const g = new THREE.Group();
      const m = new THREE.Mesh(
        geo,
        // Seen through the body, like the chassis ghost.
        new THREE.MeshStandardMaterial({ color: 0xf2b705, transparent: true, opacity: 0.45, roughness: 0.6, depthTest: false, depthWrite: false }),
      );
      m.renderOrder = 18;
      g.add(m);
      this.buck = g;
      this.scene.add(g);
    }
    this.render();
  }

  // Brush outline at the cursor.
  brushRing(hit, radius) {
    if (!this.ring) {
      this.ring = new THREE.Mesh(
        new THREE.RingGeometry(0.92, 1, 48),
        new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 0.9 }),
      );
      this.ring.renderOrder = 11;
      this.scene.add(this.ring);
    }
    this.ring.visible = !!hit;
    if (hit) {
      this.ring.position.copy(hit.point);
      this.ring.scale.setScalar(radius);
      this.ring.lookAt(hit.point.clone().add(hit.normal));
    }
    this.render();
  }
}

function inside(x, y, poly) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}
