// Text to outlines, with the fonts on this computer: the text is drawn large
// on a canvas, and the edge of the ink is traced and smoothed. The outlines
// (in mm, round the middle of the text, Y up) go into the project, so it
// builds the same on a computer without that font.

const SIZE = 220; // px: the drawing's font size

export const TEXT_FONTS = ['Arial Black', 'Impact', 'Arial', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Georgia', 'Courier New'];

export function traceText(text, family, heightMm, bold = true) {
  const t = String(text).trim();
  if (!t) throw Error('Type the text first.');
  const font = `${bold ? '900 ' : ''}${SIZE}px "${family}", "Arial Black", Arial, sans-serif`;
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = font;
  const w = Math.ceil(probe.measureText(t).width) + SIZE;
  const h = Math.ceil(SIZE * 1.6);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#fff';
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.fillText(t, SIZE / 2, h / 2);
  const data = ctx.getImageData(0, 0, w, h).data;
  const ink = new Uint8Array(w * h);
  let x0 = w, x1 = -1, y0 = h, y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (data[(y * w + x) * 4] > 127) {
        ink[y * w + x] = 1;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
  if (x1 < 0) throw Error('That font draws nothing for this text.');
  const loops = traceInk(ink, w, h);
  // To mm: the ink's height is the text height; the middle of the ink at 0, 0; Y up.
  const s = heightMm / (y1 - y0 + 1);
  const cx = (x0 + x1 + 1) / 2, cy = (y0 + y1 + 1) / 2;
  const polys = loops
    .map((l) => simplify(smooth(l), 0.6).map(([x, y]) => [round((x - cx) * s), round((cy - y) * s)]))
    .filter((l) => l.length >= 3);
  return { polys, width: (x1 - x0 + 1) * s, height: heightMm };
}

const round = (v) => Math.round(v * 1000) / 1000;

// The edges between ink and no ink, joined into closed loops (ink on the left).
function traceInk(ink, w, h) {
  const at = (x, y) => (x >= 0 && y >= 0 && x < w && y < h ? ink[y * w + x] : 0);
  const out = new Map(); // corner "x,y" → list of next corners
  const add = (ax, ay, bx, by) => {
    const k = ax + ',' + ay;
    (out.get(k) ?? out.set(k, []).get(k)).push([bx, by]);
  };
  for (let y = 0; y <= h; y++)
    for (let x = 0; x <= w; x++) {
      // Horizontal edge between (x, y-1) above and (x, y) below.
      const up = at(x, y - 1), dn = at(x, y);
      if (up !== dn) up ? add(x + 1, y, x, y) : add(x, y, x + 1, y);
      // Vertical edge between (x-1, y) and (x, y).
      const lf = at(x - 1, y), rt = at(x, y);
      if (lf !== rt) lf ? add(x, y, x, y + 1) : add(x, y + 1, x, y);
    }
  const loops = [];
  for (const [k, list] of out) {
    while (list.length) {
      const [sx, sy] = k.split(',').map(Number);
      const loop = [[sx, sy]];
      let [cx, cy] = list.pop();
      let [px, py] = [sx, sy];
      let guard = 0;
      while (!(cx === sx && cy === sy) && guard++ < 1e6) {
        loop.push([cx, cy]);
        const next = out.get(cx + ',' + cy);
        if (!next?.length) break;
        // Where two loops touch at a corner, keep turning the same way.
        let pick = 0;
        if (next.length > 1) {
          const dx = cx - px, dy = cy - py;
          pick = next.findIndex(([nx, ny]) => (nx - cx) * dy - (ny - cy) * dx < 0);
          if (pick < 0) pick = 0;
        }
        const [nx, ny] = next.splice(pick, 1)[0];
        [px, py, cx, cy] = [cx, cy, nx, ny];
      }
      if (loop.length >= 4) loops.push(loop);
    }
  }
  return loops;
}

// Cut the pixel steps: the middle of each edge instead of its corners.
const smooth = (l) => l.map((p, i) => {
  const q = l[(i + 1) % l.length];
  return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
});

// Drop points that add nothing (Ramer–Douglas–Peucker, closed loop).
function simplify(l, tol) {
  if (l.length < 8) return l;
  const keep = new Uint8Array(l.length);
  const rdp = (a, b) => {
    let best = -1, bd = tol;
    const [ax, ay] = l[a], [bx, by] = l[b];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - l[i][1]) - (ax - l[i][0]) * (by - ay)) / len;
      if (d > bd) (bd = d), (best = i);
    }
    if (best >= 0) {
      keep[best] = 1;
      rdp(a, best);
      rdp(best, b);
    }
  };
  const half = Math.floor(l.length / 2);
  keep[0] = keep[half] = 1;
  rdp(0, half);
  rdp(half, l.length - 1);
  keep[l.length - 1] = 1;
  return l.filter((_, i) => keep[i]);
}
