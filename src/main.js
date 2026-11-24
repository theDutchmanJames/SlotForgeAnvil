// SlotForge Anvil: the workspace. One project at a time: the imported car
// model plus the steps taken on it. The shape is rebuilt from the steps in
// the geometry worker, so every step can be changed or switched off later.
import './theme.css';
import './style.css';
import './update-basics.css';
import './update-window.css';
import './update-ui.js';
import { applyThemeState, loadTheme, read as readTheme, saveTheme, STORAGE_KEY as THEME_STORAGE_KEY } from './app-theme.js';
import EngineWorker from './geometry/engine.worker.js?worker&inline';
import brandIcon from './assets/slotforge-anvil.svg?inline';
import wordmarkDark from './assets/anvil-dark.svg?inline';
import wordmarkLight from './assets/anvil-light.svg?inline';
import collectionDark from './assets/slotforge-dark.svg?inline';
import collectionLight from './assets/slotforge-light.svg?inline';
import { Viewport } from './viewport.js';
import { encodeSTL } from './geometry/stl-mesh.js';
import { AXES, bounds, encodeRuns, runCount } from './geometry/engine.js';
import { partPieces } from './geometry/finish.js';
import { cutoffPreview } from './geometry/cutoff.js';
import { fitReport, suggestChassis } from './geometry/chassis.js';
import { flareBlows } from './geometry/arches.js';
import { applyOrient, guessOrient } from './geometry/engine.js';
import { readSTLMesh } from './geometry/stl-mesh.js';
import { changeLibrary, library } from './library.js';
import {
  decodeChassisFile,
  deleteChassis,
  deletePart,
  deletePostType,
  encodeChassisFile,
  listChassis,
  listParts,
  listPostTypes,
  readChassisStl,
  readPartStl,
  saveChassis,
  savePart,
  savePostType,
} from './library-db.js';
import { POST_TYPES, checkPostType, fitTestPiece, loosePost } from './geometry/posts.js';
import { pillarWarnings, windowOutlines } from './geometry/windows.js';
import { sampleClosedCurve } from './geometry/curve.js';
import { BUCK_DEFAULTS } from './geometry/buck.js';
import {
  DEFAULT_PRINT,
  MATERIALS,
  PRINT_WALLS,
  STEP_NAMES,
  clearLocal,
  createHistory,
  decodeProjectFile,
  encodeProjectFile,
  fmtLen,
  fromUnits,
  loadLocal,
  newId,
  newProject,
  restore,
  saveLocal,
  snapshot,
  toUnits,
} from './project.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const icon = (id) => `<svg class="ico"><use href="#i-${id}"/></svg>`;
const round = (v, d = 3) => Number(Number(v).toFixed(d));

// ------------------------------------------------------------ state

let project = null; // { name, units, mirror, source: { fileName, bytes }, steps }
let result = null; // the rebuilt shape and its statistics
let selection = null; // Uint8Array, one flag per triangle
let selectedCount = 0;
let sourceTriangles = 0;
const history = createHistory();
const ui = {
  menu: 'scale',
  panel: 'home', // home | orient | scale | slice | select | measure | stepinfo
  editStep: null,
  pointer: 'look', // look | brush | lasso | connected | distance | wall
  look: { section: false, original: false },
  // Keep the far half, so the side view looks into the cut.
  section: { axis: 'y', at: 0, flip: true },
  brush: 4,
  // The brush goes through both skins of a shell; the lasso only takes what faces you.
  frontOnly: { brush: false, lasso: true },
  perspective: false,
  lastView: '3d',
  scale: { mode: 'from', from: null, to: 24, factor: 1, length: null, dim: 0 },
  slice: { axis: 'z', at: null, keep: 'above', tilt: 0, lean: 'x' },
  cutoff: { cuts: [], active: 0, mirror: false, open: false, mode: 'translate', editingId: null },
  measure: [],
  saved: 'none',
  busy: false,
  // The window tool: drawing a new outline, or changing one.
  win: { draft: null, editing: null, drag: null },
};

// ------------------------------------------------------------ layout

// SlotForge family brand: the app icon beside the wordmark, the slogan under it,
// and the SlotForge App Collection mark at the end of the status bar.
export const BRAND_SLOGAN = 'HAMMERED INTO SHAPE';
// The desktop app has Settings → Updates (the SlotForge update check, as in Foundry).
const desktopUpdates = Boolean(globalThis.slotforgeDesktop?.updateCheck);
const footBrand = `<span class="sf-footer-brand"><img class="wm-dark" src="${collectionDark}" width="621" height="90" alt="SlotForge App Collection"><img class="wm-light" src="${collectionLight}" width="621" height="90" alt="SlotForge App Collection"></span>`;

$('#app').innerHTML = `
<header class="pb">
  <div class="brand" role="img" aria-label="SlotForge Anvil"><img class="brand-icon" src="${brandIcon}" width="42" height="42" alt=""><span class="brand-copy"><span class="brand-wordmark"><img class="wm-dark" src="${wordmarkDark}" width="408" height="87" alt=""><img class="wm-light" src="${wordmarkLight}" width="408" height="87" alt=""></span><small>${BRAND_SLOGAN}</small></span></div><span class="vline"></span>
  <div class="who"><input class="name" id="name" spellcheck="false" placeholder="Body name" disabled><span class="note" id="note">No model open</span></div>
  <div class="end">
    <span class="state" id="state"></span>
    <button class="btn ghost sm" data-act="new">${icon('plus')}New</button>
    <button class="btn ghost sm" data-act="open" title="Open an STL or an Anvil project (Ctrl+O)">${icon('open')}Open</button>
    <button class="btn ghost sm" data-act="save" title="Save the project as a file (Ctrl+S)">${icon('save')}Save project</button>
    <span class="vline"></span>
    <button class="btn icon ghost" data-act="undo" title="Undo (Ctrl+Z)">${icon('undo')}</button>
    <button class="btn icon ghost" data-act="redo" title="Redo (Ctrl+Y)">${icon('redo')}</button>
    <button class="btn ghost sm" data-act="final" title="Everything checked before you print">${icon('final')}Final check</button>
    <span class="vline"></span>
    <div class="tone-switch" role="group" aria-label="Theme"><button type="button" data-act="theme-light" aria-pressed="false" title="Light theme">☼<span>Light</span></button><button type="button" data-act="theme-dark" aria-pressed="true" title="Dark theme">☾<span>Dark</span></button></div>
    <button class="btn icon ghost" data-act="settings" title="Settings"${desktopUpdates ? '' : ' hidden'}>${icon('settings')}</button>
    <button class="btn primary" data-act="export" title="Export the body as an STL">${icon('export')}Export STL</button>
  </div>
</header>
<nav class="tools" id="tools"></nav>
<div class="sub" id="sub"></div>
<div class="ws">
  <div class="view" id="view">
    <div class="float views" id="views"></div>
    <div class="strip" id="strip"></div>
    <svg class="lasso" id="lasso"><polyline points=""/></svg>
    <div class="float sectionbar" id="sectionbar" hidden></div>
    <div class="float busy-pill" id="busy" hidden>Working…</div>
    <div class="float legend" id="legend" hidden></div>
    <div class="float fitbar" id="fitbar" hidden></div>
    <div class="empty" id="empty"><div class="card">
      <div class="big">Drop a car model here</div>
      <div class="muted">An STL file, or an Anvil project (.anvil).</div>
      <button class="btn primary" data-act="open">${icon('open')}Open a file</button>
      <div class="muted" style="font-size:12px">Anvil keeps your last body on this device and opens it here next time.</div>
    </div></div>
  </div>
  <aside class="side">
    <div class="panel" id="panel"></div>
    <div class="stepsbox"><div class="top"><span class="eyebrow">Steps</span><span>click one to change it</span></div><div class="steps" id="steps"></div></div>
  </aside>
</div>
<footer class="status" id="status"></footer>`;

const viewport = new Viewport($('#view'));
// For checks in the browser while developing; not in the built app.
if (import.meta.env.DEV) globalThis.__anvil = { get ui() { return ui; }, viewport, get result() { return result; }, applyGuide: () => applyGuide(), renderPanel: () => renderPanel() };

// ------------------------------------------------------------ geometry worker

let worker = null,
  jobId = 0,
  loaded = false,
  buildToken = 0;
const jobs = new Map();
function call(method, args) {
  if (!worker) {
    worker = new EngineWorker();
    worker.onmessage = ({ data }) => {
      const job = jobs.get(data.id);
      if (!job) return;
      jobs.delete(data.id);
      if (data.error) job.reject(Error(data.error));
      else job.resolve(data.value);
    };
    worker.onerror = (e) => {
      for (const job of jobs.values()) job.reject(Error(e.message || 'The geometry worker stopped. Try again.'));
      jobs.clear();
      worker.terminate();
      worker = null;
      loaded = false;
    };
  }
  return new Promise((resolve, reject) => {
    const id = ++jobId;
    jobs.set(id, { resolve, reject });
    worker.postMessage({ id, method, args });
  });
}

const partsSent = new Set();
async function rebuild() {
  if (!project) return;
  const token = ++buildToken;
  setBusy(true);
  try {
    if (!loaded) {
      const info = await call('load', { bytes: project.source.bytes });
      sourceTriangles = info.triangles;
      loaded = true;
      partsSent.clear();
    }
    // Added parts' files go to the worker once.
    for (const [id, f] of Object.entries(project.parts ?? {}))
      if (!partsSent.has(id)) {
        await call('setPart', { id, bytes: f.bytes.slice(0) });
        partsSent.add(id);
      }
    const r = await call('build', { steps: project.steps });
    if (token !== buildToken) return;
    result = r;
    selection = new Uint8Array(r.stats.triangles);
    selectedCount = 0;
    viewport.setModel(r);
    viewport.setShowOriginal(ui.look.original);
    applyHeat();
    viewport.setShowCentre(project.mirror);
    clearMeasure();
    applySection();
    applyGuide();
    const broken = r.results.filter((s) => s.state === 'error');
    if (broken.length) toast(`${broken.length} step${broken.length > 1 ? 's' : ''} could not be done. See the step list.`, 'bad');
  } catch (e) {
    if (token === buildToken) toast(e.message, 'bad');
  } finally {
    if (token === buildToken) setBusy(false);
    renderAll();
    if (token === buildToken) applyHeat();
  }
}

function setBusy(on) {
  ui.busy = on;
  $('#busy').hidden = !on;
}

// ------------------------------------------------------------ projects

async function openFile(file) {
  try {
    const bytes = await file.arrayBuffer();
    if (/\.anvil$/i.test(file.name)) {
      await startProject(decodeProjectFile(new TextDecoder().decode(bytes)));
    } else if (/\.stl$/i.test(file.name)) {
      setBusy(true);
      loaded = false;
      const info = await call('load', { bytes });
      loaded = true;
      sourceTriangles = info.triangles;
      await startProject(newProject(file.name, bytes, info.guess), true, 'check');
      toast(`Opened ${file.name}. Check the front and top under Scale › Orient.`);
    } else toast('Open an STL car model or an Anvil project (.anvil).', 'bad');
  } catch (e) {
    setBusy(false);
    toast(e.message, 'bad');
  }
}

async function startProject(p, alreadyLoaded = false, panel = 'home') {
  project = p;
  history.clear();
  ui.editStep = null;
  ui.panel = panel;
  if (panel === 'check') ui.menu = 'repair';
  ui.partsDrop = null;
  ui.closeLoops = new Set();
  ui.win = { draft: null, editing: null, drag: null };
  buck.result = buck.error = null;
  partMeshes.clear();
  partsShown = null;
  viewport.setExtras(null);
  ui.slice.at = ui.slice.pivot = null;
  Object.assign(ui.cutoff, { cuts: [], active: 0, editingId: null });
  ui.scale.length = null;
  ui.scale.from = null;
  setPointer('look');
  viewport.clear();
  if (!alreadyLoaded) loaded = false;
  await rebuild();
  scheduleSave();
}

let saveTimer = null;
function scheduleSave() {
  if (!project) return;
  ui.saved = 'saving';
  renderState();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await saveLocal(project);
      ui.saved = 'saved';
    } catch {
      ui.saved = 'failed';
    }
    renderState();
  }, 600);
}

function fileName(ext) {
  return `${(project.name || 'body').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'body'}.${ext}`;
}
function download(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// Every change to the project goes through here, so undo always works.
function commit(change, rebuildAfter = true) {
  history.push(snapshot(project));
  change();
  scheduleSave();
  if (rebuildAfter) rebuild();
  else {
    renderAll();
    drawGhost();
  }
}

function addOrUpdateStep(type, params) {
  const editing = project.steps.find((s) => s.id === ui.editStep && s.type === type);
  commit(() => {
    if (editing) editing.params = params;
    else {
      // Show the new step as the one being edited, so the panel does not
      // offer the same change again.
      const step = { id: newId(), type, enabled: true, params };
      project.steps.push(step);
      ui.editStep = step.id;
      ui.scale.editingId = ui.slice.editingId = ui.cutoff.editingId = null;
    }
  });
}

// ------------------------------------------------------------ rendering

const MENUS = [
  {
    id: 'repair',
    name: 'Repair',
    tools: [['check', 'checklist', 'Check'], ['fix', 'wrench', 'Light fix'], ['parts', 'parts', 'Parts'], ['openings', 'fill', 'Close openings'], ['solid', 'solid', 'Make solid'], ['reduce', 'reduce', 'Reduce']],
    later: [['Rebuild', 'Remakes a badly broken model as one solid. Comes later.']],
  },
  { id: 'scale', name: 'Scale', tools: [['orient', 'orient', 'Orient'], ['scale', 'scale', 'Scale']] },
  {
    id: 'chassis',
    name: 'Chassis',
    tools: [['chassis', 'ghost', 'Chassis'], ['tyres', 'tyre', 'Tyres'], ['arches', 'arch', 'Wheel arches'], ['stretch', 'stretch', 'Stretch']],
  },
  {
    id: 'shell',
    name: 'Shell',
    tools: [['floor', 'floor', 'Floor line'], ['hammer', 'hammer', 'Hammer'], ['hollow', 'shell', 'Hollow'], ['paint', 'brush', 'Paint thickness']],
    later: [['Rebuild', 'Remakes a badly broken model as one solid. Comes later.']],
  },
  {
    id: 'shape',
    name: 'Shape',
    tools: [['slice', 'slice', 'Slice'], ['cutoff', 'cutoff', 'Cut off'], ['select', 'trash', 'Delete selection'], ['smooth', 'smooth', 'Smooth'], ['addpart', 'plus', 'Add part']],
  },
  {
    id: 'windows',
    name: 'Windows',
    tools: [['windows', 'window', 'Windows']],
    later: [['Close window', 'Fills an opening the model came with. Comes later.'], ['Recessed window', 'Sinks a painted window a fraction. Comes later.']],
  },
  { id: 'posts', name: 'Posts', tools: [['posts', 'post', 'Posts'], ['posteditor', 'wrench', 'Post editor']] },
  { id: 'buck', name: 'Buck', tools: [['buck', 'buck', 'Window buck']] },
];

function renderAll() {
  renderHeader();
  renderTools();
  renderSub();
  renderViewChrome();
  renderPanel();
  renderSteps();
  renderStatus();
}

function renderHeader() {
  const name = $('#name');
  name.disabled = !project;
  if (document.activeElement !== name) name.value = project?.name ?? '';
  $('#note').textContent = project
    ? `From ${project.source.fileName}${sourceTriangles ? ` · ${sourceTriangles.toLocaleString()} triangles` : ''}`
    : 'No model open';
  document.querySelector('[data-act="undo"]').disabled = !history.canUndo;
  document.querySelector('[data-act="redo"]').disabled = !history.canRedo;
  for (const a of ['save', 'export', 'final']) document.querySelector(`[data-act="${a}"]`).disabled = !result;
  renderState();
}

function renderState() {
  const el = $('#state');
  el.className = 'state';
  if (!project) el.innerHTML = '';
  else if (ui.saved === 'saving') {
    el.classList.add('busy');
    el.textContent = 'Saving…';
  } else if (ui.saved === 'failed') el.innerHTML = `<span style="color:var(--accent-text)">${icon('warn')} Not saved on this device</span>`;
  else el.innerHTML = `${icon('check')}Saved on this device`;
}

function renderTools() {
  const has = !!result;
  const menus = MENUS.map((m) =>
    m.tools
      ? `<button class="tbtn${ui.menu === m.id ? ' on' : ''}" data-act="menu" data-v="${m.id}"${has ? '' : ' disabled'}>${m.name}<span class="chev"></span></button>`
      : `<button class="tbtn" disabled title="Comes in a later version">${m.name}<span class="chev"></span></button>`,
  ).join('');
  $('#tools').innerHTML = `
    <div class="grp">${menus}</div>
    <span class="vline"></span>
    <div class="grp"><span class="gl">Look</span>
      <button class="tbtn${ui.look.thickness ? ' on' : ''}" data-act="look" data-v="thickness"${has ? '' : ' disabled'} title="Colour the body by wall thickness">${icon('heat')}Thickness</button>
      <button class="tbtn${ui.look.section ? ' on' : ''}" data-act="look" data-v="section"${has ? '' : ' disabled'}>${icon('section')}Section</button>
      <button class="tbtn${ui.look.chassis ? ' on' : ''}" data-act="look" data-v="chassis"${project?.chassis ? '' : ' disabled'} title="Show the chassis as a ghost">${icon('ghost')}Chassis</button>
      <button class="tbtn${ui.look.original ? ' on' : ''}" data-act="look" data-v="original"${has ? '' : ' disabled'}>${icon('compare')}Original</button>
    </div>
    <div class="grp" style="margin-left:auto">
      <button class="tbtn${project && project.protect !== false ? ' on' : ''}" data-act="protect"${project ? '' : ' disabled'} title="Protect the outside: once the body is hollowed, selecting and smoothing only touch the inside">${icon('lock')}Protect outside</button>
      <button class="tbtn${project?.mirror ? ' on' : ''}" data-act="mirror"${project ? '' : ' disabled'} title="Selections work on both sides of the centre line">${icon('mirror')}Mirror</button>
      <span class="seg"><button data-act="units" data-v="mm" class="${(project?.units ?? 'mm') === 'mm' ? 'on' : ''}"${project ? '' : ' disabled'}>mm</button><button data-act="units" data-v="in" class="${project?.units === 'in' ? 'on' : ''}"${project ? '' : ' disabled'}>in</button></span>
    </div>`;
}

function renderSub() {
  const menu = MENUS.find((m) => m.id === ui.menu);
  if (!result || !menu?.tools) {
    $('#sub').innerHTML = `<span class="hint">${result ? '' : 'Open a car model to start.'}</span>`;
    return;
  }
  $('#sub').innerHTML =
    `<span class="gl">${menu.name}</span>` +
    menu.tools
      .map(([id, ic, name]) => `<button class="tbtn${ui.panel === id ? ' on' : ''}" data-act="tool" data-v="${id}">${icon(ic)}${name}</button>`)
      .join('') +
    (menu.later ?? []).map(([name, why]) => `<button class="tbtn" disabled title="${why}">${name}</button>`).join('');
}

function renderViewChrome() {
  const has = !!result;
  $('#empty').hidden = !!project;
  const views = [['top', 'Top'], ['side', 'Side'], ['front', 'Front'], ['rear', 'Rear'], ['under', 'Under'], ['3d', '3D']];
  $('#views').innerHTML = has
    ? `<span class="seg">${views.map(([v, n]) => `<button data-act="view" data-v="${v}" class="${ui.lastView === v ? 'on' : ''}">${n}</button>`).join('')}</span>
       <span class="seg"><button data-act="persp" data-v="0" class="${ui.perspective ? '' : 'on'}">Flat</button><button data-act="persp" data-v="1" class="${ui.perspective ? 'on' : ''}">Perspective</button></span>`
    : '';
  const strip = [
    ['look', 'look', 'Turn and look (left mouse button)'],
    ['brush', 'brush', 'Brush select'],
    ['lasso', 'lasso', 'Lasso select'],
    ['connected', 'connected', 'Select a connected part'],
    null,
    ['distance', 'ruler', 'Measure a distance'],
    ['wall', 'wall', 'Measure wall thickness'],
    ['hammer', 'hammer', 'Hammer'],
    ['paint', 'heat', 'Paint wall thickness'],
    ['line', 'line', 'Line tool: draw a window'],
  ];
  $('#strip').hidden = !has;
  $('#strip').innerHTML = strip
    .map((s) =>
      !s
        ? '<i></i>'
        : `<button data-act="pointer" data-v="${s[0]}" title="${s[2]}" class="${ui.pointer === s[0] ? 'on' : ''}">${icon(s[1])}</button>`,
    )
    .join('');
  $('#view').classList.toggle('tool', ui.pointer !== 'look');
  renderSectionBar();
}

function axisRange(axis) {
  const b = result.stats.bounds,
    k = 'xyz'.indexOf(axis);
  return [b.min[k], b.max[k]];
}
const AXIS_NAMES = { x: 'Along', y: 'Across', z: 'Height' };

function renderSectionBar() {
  const bar = $('#sectionbar');
  bar.hidden = !(result && ui.look.section);
  if (bar.hidden) return;
  const s = ui.section,
    [lo, hi] = axisRange(s.axis);
  bar.innerHTML = `<span class="eyebrow">Section</span>
    <span class="seg">${['x', 'y', 'z'].map((a) => `<button data-act="section-axis" data-v="${a}" class="${s.axis === a ? 'on' : ''}">${AXIS_NAMES[a]}</button>`).join('')}</span>
    <input type="range" data-field="section-at" min="${lo}" max="${hi}" step="${(hi - lo) / 400}" value="${s.at}">
    <span class="mono" id="section-val" style="min-width:76px">${fmtLen(s.at, project.units)}</span>
    <button class="btn sm ghost" data-act="section-flip">Flip</button>`;
}

function applySection() {
  if (!result) return;
  if (ui.look.section) {
    const [lo, hi] = axisRange(ui.section.axis);
    ui.section.at = Math.min(hi, Math.max(lo, ui.section.at));
    viewport.setSection(ui.section);
  } else viewport.setSection(null);
}

// ------------------------------------------------------------ the side panel

function head(title, text) {
  return `<div class="head"><div class="cond">${title}</div><div class="muted">${text}</div></div>`;
}
function numField(field, value, units, step = 'any') {
  return `<span class="num"><input data-field="${field}" type="number" step="${step}" value="${value}">${units ? `<small>${units}</small>` : ''}</span>`;
}
const unitLabel = () => project.units;

function renderPanel() {
  const el = $('#panel');
  if (!result) {
    el.innerHTML = project
      ? head('Loading', 'Building the model…')
      : head('Anvil', 'Turn any car model into a light, printable slotcar body. Open an STL to start.');
    return;
  }
  const editing = project.steps.find((s) => s.id === ui.editStep);
  const panel = editing ? STEP_PANEL[editing.type] : ui.panel;
  el.innerHTML = {
    home: panelHome,
    orient: panelOrient,
    scale: panelScale,
    slice: panelSlice,
    cutoff: panelCutoff,
    select: panelSelect,
    measure: panelMeasure,
    stepinfo: panelStepInfo,
    check: panelCheck,
    fix: panelFix,
    parts: panelParts,
    openings: panelOpenings,
    solid: panelSolid,
    reduce: panelReduce,
    chassis: panelChassis,
    tyres: panelTyres,
    arches: panelArches,
    stretch: panelStretch,
    floor: panelFloor,
    hollow: panelHollow,
    hammer: panelHammer,
    paint: panelPaint,
    posts: panelPosts,
    posteditor: panelPostEditor,
    windows: panelWindows,
    buck: panelBuck,
    smooth: panelSmooth,
    addpart: panelAddPart,
    final: panelFinal,
  }[panel](editing);
  drawSeparateParts();
  drawPostMarks(panel === 'posts');
  drawWindows(panel === 'windows' || panel === 'buck');
  drawBuck(panel === 'buck');
  applyGuide();
  drawOpenings(panel === 'openings');
  if (panel === 'floor') floorGuide();
  drawGhost();
  renderFitBar(['chassis', 'tyres', 'arches', 'stretch'].includes(panel));
}

function panelHome() {
  const b = result.stats.bounds.size,
    u = project.units;
  return `${head('Your body', 'Pick a tool from the menus above, or use the tools on the left of the car.')}
    <div class="note">Length ${fmtLen(b[0], u)} · width ${fmtLen(b[1], u)} · height ${fmtLen(b[2], u)}</div>
    <div class="muted" style="font-size:12.5px">Right mouse button turns the view while a tool is active, the middle button moves it, the wheel zooms.</div>`;
}

function orientStep() {
  return project.steps.find((s) => s.type === 'orient');
}

function panelOrient() {
  const s = orientStep();
  const p = s?.params ?? { front: '+x', up: '+z' };
  const b = result.stats.bounds.size,
    u = project.units;
  const axisButtons = (act, current, other) =>
    `<div class="axes">${AXES.map((a) => `<button data-act="${act}" data-v="${a}" class="${current === a ? 'on' : ''}"${a[1] === other[1] ? ' disabled' : ''}>${a.toUpperCase()}</button>`).join('')}</div>`;
  return `${head('Orient', 'Which way the front and the roof point in the file you opened. Anvil stands the car on its wheels with the front to the left in the side view.')}
    ${s ? '' : '<div class="note warn">There is no Orient step. Choosing a direction adds one.</div>'}
    <div class="f">Front of the car points to${axisButtons('orient-front', p.front, p.up)}</div>
    <div class="f">Roof points to${axisButtons('orient-up', p.up, p.front)}</div>
    <div class="row"><button class="btn sm" data-act="orient-turn">Turn around</button><button class="btn sm" data-act="orient-flip">Upside down</button></div>
    <div class="f">Straighten<div class="muted" style="font-weight:400;font-size:12px">Turns the car about its roof axis when it sits at an angle in the file. Check it in the Top view.</div>
      <div class="row"><button class="btn sm icon" data-act="orient-yaw" data-v="-0.5" title="Turn 0.5° one way">−</button>${numField('orient-yaw', p.turn ?? 0, '°')}<button class="btn sm icon" data-act="orient-yaw" data-v="0.5" title="Turn 0.5° the other way">+</button><button class="btn sm ghost" data-act="orient-straighten">Auto</button></div></div>
    <div class="note">Length ${fmtLen(b[0], u)} · width ${fmtLen(b[1], u)} · height ${fmtLen(b[2], u)}</div>`;
}

const SIZE_NAMES = ['length', 'width', 'height'];

function scaleFactor() {
  const s = ui.scale;
  if (s.mode === 'from') return s.from > 0 && s.to > 0 ? s.from / s.to : NaN;
  if (s.mode === 'length') return s.length > 0 ? s.length / result.stats.bounds.size[s.dim ?? 0] : NaN;
  return s.factor;
}

// A real car is about 4.4 m long: guess which common scale the file is at.
function guessScale(length) {
  const scales = [1, 8, 10, 12, 18, 20, 24, 32, 43, 64, 87, 100];
  const ratio = 4400 / length;
  return scales.reduce((best, s) => (Math.abs(Math.log(s / ratio)) < Math.abs(Math.log(best / ratio)) ? s : best));
}

function panelScale(editing) {
  const s = ui.scale,
    u = project.units,
    size = result.stats.bounds.size;
  if (editing) {
    s.mode = 'factor';
    if (s.editingId !== editing.id) {
      s.factor = editing.params.factor;
      s.editingId = editing.id;
    }
  } else s.editingId = null;
  if (s.from == null) s.from = guessScale(size[0]);
  const f = scaleFactor();
  let body = '';
  if (s.mode === 'from')
    body = `<div class="f">The file is at<div class="row">1 : ${numField('scale-from', s.from, '')}<span class="muted">${s.from === guessScale(size[0]) ? 'guessed from its length' : '1 = real car size'}</span></div></div>
      <div class="f">Make it<div class="row">1 : ${numField('scale-to', s.to, '')}<span class="seg"><button data-act="scale-to" data-v="32" class="${s.to === 32 ? 'on' : ''}">1:32</button><button data-act="scale-to" data-v="24" class="${s.to === 24 ? 'on' : ''}">1:24</button></span></div></div>`;
  else if (s.mode === 'length') {
    const d = s.dim ?? 0,
      name = SIZE_NAMES[d];
    body = `<div class="f">Measure the<span class="seg">${SIZE_NAMES.map((n, i) => `<button data-act="scale-dim" data-v="${i}" class="${d === i ? 'on' : ''}">${n[0].toUpperCase() + n.slice(1)}</button>`).join('')}</span></div>
      <div class="f">${name[0].toUpperCase() + name.slice(1)} now<div class="row mono">${fmtLen(size[d], u)}</div></div>
      <div class="f">Make the ${name}<div class="row">${numField('scale-length', s.length ? round(toUnits(s.length, u)) : '', u)}</div></div>`;
  }
  else body = `<div class="f">Multiply every size by<div class="row">${numField('scale-factor', s.factor, '×')}</div></div>`;
  const ok = Number.isFinite(f) && f > 0;
  const preview = editing
    ? ''
    : `<div class="note">${ok ? `New size: ${fmtLen(size[0] * f, u)} long, ${fmtLen(size[1] * f, u)} wide, ${fmtLen(size[2] * f, u)} high · ×${round(f, 4)}` : 'Enter the numbers above.'}</div>`;
  return `${head(editing ? 'Change scale step' : 'Scale', 'Make the body the right size for your scale. Measure › distance can also set the scale from a known length.')}
    ${editing ? '' : `<span class="seg"><button data-act="scale-mode" data-v="from" class="${s.mode === 'from' ? 'on' : ''}">From a scale</button><button data-act="scale-mode" data-v="length" class="${s.mode === 'length' ? 'on' : ''}" title="To a length, width or height">To a size</button><button data-act="scale-mode" data-v="factor" class="${s.mode === 'factor' ? 'on' : ''}">By a factor</button></span>`}
    ${body}${preview}
    <div class="row"><button class="btn primary sm" data-act="scale-apply"${ok ? '' : ' disabled'}>${editing ? 'Update step' : 'Scale'}</button>${editing ? '<button class="btn ghost sm" data-act="stop-edit">Done</button>' : ''}</div>`;
}

const KEEP_NAMES = {
  x: { below: 'Front', above: 'Back' },
  y: { below: 'Left side', above: 'Right side' },
  z: { below: 'Below', above: 'Above' },
};

// ------------------------------------------------------------ cut off

function panelCutoff(editing) {
  const s = ui.cutoff,
    u = project.units;
  if (editing && s.editingId !== editing.id) {
    Object.assign(s, { mirror: false, open: false }, structuredClone(editing.params), { active: 0, editingId: editing.id });
  }
  if (!editing) s.editingId = null;
  const placing = ui.pointer === 'cutplace';
  const intro = head(editing ? 'Change cut off step' : 'Cut off', 'Take off a part such as a mirror or a spoiler. Put a small cutting plane across where it joins the body: only what the plane cuts free goes, the rest stays.');
  const placeBtn = (label) =>
    placing
      ? `<div class="note">Click on the model where the part joins the body. <button class="btn sm ghost" data-act="cut-place-stop">Cancel</button></div>`
      : `<button class="btn sm${s.cuts.length ? '' : ' primary'}" data-act="cut-place">${icon('cutoff')}${label}</button>`;
  if (!s.cuts.length) return `${intro}<div class="row">${placeBtn('Place a cutting plane')}</div><div class="muted" style="font-size:12px">Works best before Hollow: on a hollow body the cut is closed with a ring.</div>`;
  s.active = Math.min(s.active, s.cuts.length - 1);
  const c = s.cuts[s.active];
  const pv = editing ? null : cutoffPreviewNow();
  const status = editing
    ? '<div class="note">Change the planes, then Update step. The red part shows before a new cut only.</div>'
    : pv?.error
      ? `<div class="note warn">${pv.error}</div>`
      : pv
        ? `<div class="note">The part shown in red goes: ${pv.share < 0.001 ? 'under 0.1' : round(pv.share * 100, 1)}% of the model.</div>`
        : '';
  return `${intro}
    ${s.cuts.length > 1 || !placing ? `<div class="f">Cutting planes<div class="row"><span class="seg">${s.cuts.map((_, i) => `<button data-act="cut-pick" data-v="${i}" class="${i === s.active ? 'on' : ''}">${i + 1}</button>`).join('')}</span>${placeBtn('Add one')}${s.cuts.length > 1 ? `<button class="btn sm ghost icon" data-act="cut-remove" title="Remove plane ${s.active + 1}">${icon('x')}</button>` : ''}</div></div>` : placeBtn('')}
    <div class="f">Drag in the view to<span class="seg">${[['translate', 'Move'], ['rotate', 'Turn'], ['scale', 'Size']].map(([m, n]) => `<button data-act="cut-mode" data-v="${m}" class="${s.mode === m ? 'on' : ''}">${n}</button>`).join('')}</span></div>
    <div class="f">Size<div class="row">${numField('cut-w', round(toUnits(c.w, u), 2), u)}<span class="muted">×</span>${numField('cut-h', round(toUnits(c.h, u), 2), u)}</div></div>
    <div class="f">Push along the arrow<div class="row"><button class="btn sm icon" data-act="cut-push" data-v="-0.2" title="Move 0.2 mm back">−</button><span class="muted">0.2 mm</span><button class="btn sm icon" data-act="cut-push" data-v="0.2" title="Move 0.2 mm on">+</button><button class="btn sm" data-act="cut-flip">Flip side</button></div><div class="muted" style="font-weight:400;font-size:12px">The arrow points to the part that goes.</div></div>
    <label class="chk"><input type="checkbox" data-field="cut-mirror" ${s.mirror ? 'checked' : ''}>Cut the other side too (mirrors)</label>
    <label class="chk"><input type="checkbox" data-field="cut-open" ${s.open ? 'checked' : ''}>Leave the cut open</label>
    ${status}
    <div class="row"><button class="btn primary sm" data-act="cut-apply"${!editing && pv?.error ? ' disabled' : ''}>${editing ? 'Update step' : 'Cut off'}</button>${editing ? '<button class="btn ghost sm" data-act="stop-edit">Done</button>' : ''}</div>`;
}

function cutoffParams() {
  const s = ui.cutoff;
  return { cuts: structuredClone(s.cuts), ...(s.mirror ? { mirror: true } : {}), ...(s.open ? { open: true } : {}) };
}

// What the cut would take off, worked out on the model shown. Kept until
// the planes or the model change.
let cutPreview = { key: null, value: null };
function cutoffPreviewNow() {
  const key = JSON.stringify(cutoffParams());
  if (cutPreview.key !== key || cutPreview.result !== result) {
    cutPreview = { key, result, value: cutoffPreview(result, cutoffParams()) };
  }
  return cutPreview.value;
}

// A new plane where the model was clicked, standing just off the surface and
// facing out of it.
function placeCut(hit) {
  const n = hit.normal.clone().normalize();
  const len = result.stats.bounds.size[0];
  const at = hit.point.clone().addScaledVector(n, len * 0.006);
  const up = Math.abs(n.z) > 0.9 ? [1, 0, 0] : [0, 0, 1];
  const side = round(Math.max(2, len * 0.06), 2);
  const r = (x) => round(x, 4);
  ui.cutoff.cuts.push({ at: at.toArray().map(r), normal: n.toArray().map(r), up, w: side, h: side });
  ui.cutoff.active = ui.cutoff.cuts.length - 1;
  ui.cutoff.mode = 'translate';
  setPointer('look');
  renderPanel();
  applyGuide();
}

function cutChanged(cut) {
  ui.cutoff.cuts[ui.cutoff.active] = cut;
  renderPanel();
  applyGuide();
}

// A tilted cut slopes along one of the other two directions, about the
// middle of the model in that direction.
const SLICE_LEAN = { x: 'z', y: 'z', z: 'x' };
const LEAN_NAMES = { x: 'length', y: 'width', z: 'height' };
const LEAN_END = { x: 'back', y: 'right side', z: 'top' };
const AXIS_ENDS = { x: ['front', 'back'], y: ['left side', 'right side'] };
function tiltHint({ axis, tilt, lean }) {
  if (axis === 'z') return `${tilt > 0 ? 'Higher' : 'Lower'} toward the ${LEAN_END[lean]}.`;
  return `Leans toward the ${AXIS_ENDS[axis][tilt > 0 ? 1 : 0]} at the ${LEAN_END[lean]}.`;
}
function slicePivot(lean) {
  const [lo, hi] = axisRange(lean);
  return round((lo + hi) / 2, 4);
}
function sliceParams() {
  const { axis, at, keep, cap, gap, tilt, lean, pivot } = ui.slice;
  return {
    axis,
    at: round(at, 4),
    keep,
    ...(cap ? { cap: true } : {}),
    ...(keep === 'both' ? { gap: round(gap ?? 10, 3) } : {}),
    ...(tilt ? { tilt: round(tilt, 2), lean, pivot: pivot ?? slicePivot(lean) } : {}),
  };
}

function panelSlice(editing) {
  const s = ui.slice,
    u = project.units;
  if (editing && s.editingId !== editing.id) Object.assign(s, { tilt: 0, cap: false, gap: 10, pivot: null }, editing.params, { editingId: editing.id });
  if (!editing) s.editingId = null;
  const [lo, hi] = axisRange(s.axis);
  if (s.at == null || (!editing && (s.at < lo || s.at > hi))) s.at = s.axis === 'z' ? lo + (hi - lo) * 0.08 : (lo + hi) / 2;
  s.gap ??= 10;
  s.tilt ??= 0;
  if (!s.lean || s.lean === s.axis) s.lean = SLICE_LEAN[s.axis];
  if (s.pivot == null) s.pivot = slicePivot(s.lean);
  const leans = ['x', 'y', 'z'].filter((a) => a !== s.axis);
  return `${head(editing ? 'Change slice step' : 'Slice', 'Cut the model with a flat plane and keep one side, or both to print in two. The cut stays open, like the underside of a body shell, unless you close it.')}
    <div class="f">Direction<span class="seg">${['x', 'y', 'z'].map((a) => `<button data-act="slice-axis" data-v="${a}" class="${s.axis === a ? 'on' : ''}">${AXIS_NAMES[a]}</button>`).join('')}</span></div>
    <div class="f">Cut at<div class="row"><input type="range" data-field="slice-range" min="${lo}" max="${hi}" step="${(hi - lo) / 500}" value="${s.at}">${numField('slice-at', round(toUnits(s.at, u)), u)}</div>${s.tilt ? `<div class="muted" style="font-weight:400;font-size:12px">Measured at the middle of the ${LEAN_NAMES[s.lean]}.</div>` : ''}</div>
    <div class="f">Tilt<div class="row"><button class="btn sm icon" data-act="slice-tilt" data-v="-1" title="Tilt 1° one way">−</button>${numField('slice-tilt', s.tilt, '°')}<button class="btn sm icon" data-act="slice-tilt" data-v="1" title="Tilt 1° the other way">+</button>${s.tilt ? '<button class="btn sm ghost" data-act="slice-tilt" data-v="0">Level</button>' : ''}</div></div>
    ${s.tilt ? `<div class="f">Slopes along<span class="seg">${leans.map((a) => `<button data-act="slice-lean" data-v="${a}" class="${s.lean === a ? 'on' : ''}">${LEAN_NAMES[a][0].toUpperCase() + LEAN_NAMES[a].slice(1)}</button>`).join('')}</span><div class="muted" style="font-weight:400;font-size:12px">${tiltHint(s)} Check the red plane in the view.</div></div>` : ''}
    <div class="f">Keep<span class="seg">${['below', 'above', 'both'].map((k) => `<button data-act="slice-keep" data-v="${k}" class="${s.keep === k ? 'on' : ''}">${k === 'both' ? 'Both' : KEEP_NAMES[s.axis][k]}</button>`).join('')}</span></div>
    ${s.keep === 'both' ? `<div class="f">Move the two apart by<div class="row">${numField('slice-gap', round(toUnits(s.gap, u), 2), u)}</div></div>` : ''}
    <label class="chk"><input type="checkbox" data-field="slice-cap" ${s.cap ? 'checked' : ''}>Close the cut flat (a ring on a hollow shell)</label>
    <div class="row"><button class="btn primary sm" data-act="slice-apply">${editing ? 'Update step' : 'Cut'}</button>${editing ? '<button class="btn ghost sm" data-act="stop-edit">Done</button>' : ''}</div>`;
}

function panelSelect() {
  const tools = [['brush', 'Brush'], ['lasso', 'Lasso'], ['connected', 'Connected']];
  const pointer = tools.some(([t]) => t === ui.pointer) ? ui.pointer : null;
  return `${head('Select', 'Pick a selection tool, then work on the car with the left mouse button. Shift adds, Alt takes away.')}
    <span class="seg">${tools.map(([t, n]) => `<button data-act="pointer" data-v="${t}" class="${pointer === t ? 'on' : ''}">${n}</button>`).join('')}</span>
    ${ui.pointer === 'brush' ? `<div class="f">Brush size<div class="row"><input type="range" data-field="brush" min="0.5" max="30" step="0.5" value="${ui.brush}"><span class="mono" id="brush-val">${fmtLen(ui.brush, project.units, 1)}</span></div></div>` : ''}
    ${ui.pointer === 'connected' ? '' : `<label class="chk"><input type="checkbox" data-field="front-only" ${ui.frontOnly[ui.pointer] ? 'checked' : ''}>Only surfaces facing me</label>`}
    <div><div class="big-num" id="sel-count">${selectedCount.toLocaleString()}</div><div class="muted" style="font-size:12px">triangles selected${project.mirror ? ', mirrored across the centre line' : ''}</div></div>
    <div class="row"><button class="btn sm" data-act="sel-clear">Clear</button><button class="btn sm" data-act="sel-invert">Invert</button></div>
    <div class="row"><button class="btn primary sm" data-act="sel-delete"${selectedCount ? '' : ' disabled'}>${icon('trash')}Delete, leave open</button>
      <button class="btn sm" data-act="sel-delete" data-v="smooth"${selectedCount ? '' : ' disabled'}>Delete and patch</button></div>
    <div class="muted" style="font-size:12px">Patching closes the hole with a surface that bends with its edge, for a lump or badge you want gone.</div>
    <button class="btn sm ghost" data-act="tool" data-v="smooth"${selectedCount ? '' : ' disabled'}>Smooth the selection…</button>
    ${project.protect !== false ? '<div class="muted" style="font-size:12px">Protect the outside is on: only the inside of the body can be selected.</div>' : ''}`;
}

function panelMeasure() {
  const u = project.units,
    m = ui.measure;
  const mode = ui.pointer === 'wall' ? 'wall' : 'distance';
  let body;
  if (mode === 'distance') {
    const d = m.length === 2 ? m[0].point.distanceTo(m[1].point) : null;
    body = d == null
      ? `<div class="note">Click two points on the car.${m.length === 1 ? ' Now click the second point.' : ''}</div>`
      : `<div><div class="big-num">${fmtLen(d, u)}</div><div class="muted" style="font-size:12px">straight line between the two points</div></div>
         <div class="hr"></div>
         <div class="f">Set the scale from this distance<div class="muted" style="font-weight:400;font-size:12px">If you know how long this should be, Anvil scales the whole body to match.</div>
         <div class="row">It should be ${numField('measure-real', '', u)}<button class="btn sm" data-act="measure-scale">Scale</button></div></div>`;
  } else {
    body = m.wall
      ? `<div><div class="big-num">${fmtLen(m.wall, u)}</div><div class="muted" style="font-size:12px">wall thickness at the point you clicked</div></div>`
      : m.wallMiss
        ? '<div class="note warn">No inner surface found there: the model is solid or open at that point.</div>'
        : '<div class="note">Click anywhere on the body to measure its wall.</div>';
  }
  return `${head('Measure', 'Measure lengths and wall thickness on the body.')}
    <span class="seg"><button data-act="pointer" data-v="distance" class="${mode === 'distance' ? 'on' : ''}">Distance</button><button data-act="pointer" data-v="wall" class="${mode === 'wall' ? 'on' : ''}">Wall thickness</button></span>
    ${body}`;
}

function panelStepInfo(editing) {
  return `${head('Delete selection', `This step deletes ${runCount(editing.params.faces).toLocaleString()} triangles.`)}
    <div class="note">To change what it deletes, switch it off or remove it, then select again.</div>
    <div class="row"><button class="btn ghost sm" data-act="stop-edit">Done</button></div>`;
}

// ------------------------------------------------------------ repair panels

const STEP_PANEL = { orient: 'orient', scale: 'scale', slice: 'slice', cutoff: 'cutoff', delete: 'stepinfo', repair: 'fix', fill: 'openings', solid: 'solid', reduce: 'reduce', floor: 'floor', hollow: 'hollow', hammer: 'hammer', stretch: 'stretch', arches: 'arches', posts: 'posts', windows: 'windows', smooth: 'smooth', addpart: 'addpart' };
const STEP_MENU = { windows: 'windows', smooth: 'shape', addpart: 'shape', orient: 'scale', scale: 'scale', slice: 'shape', cutoff: 'shape', delete: 'shape', repair: 'repair', fill: 'repair', solid: 'repair', reduce: 'repair', floor: 'shell', hollow: 'shell', hammer: 'shell', stretch: 'chassis', arches: 'chassis', posts: 'posts' };

// Results the worker works out on request, kept until the shape changes.
const lookups = {
  arches: { token: -1, value: null, busy: false },
  check: { token: -1, value: null, busy: false },
  openings: { token: -1, value: null, busy: false },
  thickness: { token: -1, value: null, busy: false },
  skins: { token: -1, value: null, busy: false },
  solid: { token: -1, value: null, busy: false },
};
function lookup(name) {
  const l = lookups[name];
  if (l.token === buildToken) return l.value;
  if (!l.busy && !ui.busy && result) {
    l.busy = true;
    const token = buildToken;
    call(name)
      .then((v) => {
        if (token !== buildToken) return;
        l.token = token;
        l.value = v;
      })
      .catch((e) => toast(e.message, 'bad'))
      .finally(() => {
        l.busy = false;
        if (token !== buildToken) return;
        renderPanel();
        if (name === 'arches') {
          drawGhost();
          renderFitBar(ui.panel === 'chassis' || ui.panel === 'tyres');
          renderStatus();
        }
        if (name === 'thickness') {
          applyHeat();
          renderStatus();
        }
      });
  }
  return null;
}

const KINDS = [
  ['solid', 'Solid', 'Filled all the way through'],
  ['shell', 'Hollow shell', 'Already hollow'],
  ['skin', 'Single skin', 'A surface with no thickness'],
  ['many', 'Many parts', 'Pieces that overlap'],
];
const VERDICT = {
  solid: 'This is a solid model',
  shell: 'This is a hollow shell',
  skin: 'This is a single skin',
  many: 'This is made of many parts',
};

function row(ok, title, text, action) {
  return `<div class="crow"><svg class="ico ${ok ? 'ok' : 'wa'}"><use href="#i-${ok ? 'check' : 'warn'}"/></svg><div><b>${title}</b>${text ? `<br><span>${text}</span>` : ''}</div><span>${action}</span></div>`;
}

function panelCheck() {
  const c = lookup('check');
  if (!c) return head('Check', 'Looking at the model…');
  const u = project.units;
  const broken = c.collapsed + c.doubled;
  const bigParts = c.parts.filter((p) => !p.speck);
  const openings = c.loops.filter((l) => !l.crack).length - c.smallHoles;
  const rows = [];
  if (c.specks) rows.push(row(false, `${c.specks} specks`, `Tiny loose bits, ${c.speckTriangles.toLocaleString()} triangles`, 'Light fix removes them'));
  if (broken) rows.push(row(false, `${broken} broken triangles`, 'Collapsed to a line, or there twice', 'Light fix removes them'));
  if (c.crowded) rows.push(row(false, `${c.crowded} edge faults`, 'Places where surfaces touch along an edge', 'Light fix untangles them'));
  if (c.flipped || c.insideOutParts) rows.push(row(false, 'Inside-out areas', `${c.flipped.toLocaleString()} triangles face the wrong way${c.insideOutParts ? `, ${c.insideOutParts} part${c.insideOutParts > 1 ? 's' : ''} inside out` : ''}`, 'Light fix turns them round'));
  if (c.smallHoles) rows.push(row(false, `${c.smallHoles} small holes`, '', 'Light fix closes them'));
  if (bigParts.length > 1) rows.push(row(false, `${bigParts.length} separate parts`, 'Choose which to keep under Parts', '<button class="btn sm ghost" data-act="tool" data-v="parts">Parts</button>'));
  if (openings) rows.push(row(true, `${openings} opening${openings > 1 ? 's' : ''}`, 'Such as the underside and the windows', '<button class="btn sm ghost" data-act="tool" data-v="openings">Show</button>'));
  if (!rows.some((r) => r.includes('"ico wa"'))) rows.unshift(row(true, 'No faults', 'Every edge is shared by exactly two triangles', ''));
  const fixable = c.specks + broken + c.crowded + c.flipped + c.insideOutParts + c.smallHoles > 0;
  let expect;
  if (c.kind === 'skin')
    expect = '<div class="note warn"><b>This surface has no thickness.</b><br>It cannot be printed as it is. Thickening it inwards comes with the Shell tools.</div>';
  else if (c.kind === 'many')
    expect = '<div class="note warn"><b>The parts overlap.</b><br>Keep the body under Parts. Merging overlapping parts into one comes with the Rebuild tool.</div>';
  else expect = '<div class="note ok"><b>The outer surface stays exactly as it is.</b><br>' + (fixable ? 'The light fix only removes and untangles faults.' : 'This model needs no repair.') + '</div>';
  const coarse = c.triangles < 4000 ? '<div class="note warn">Only ' + c.triangles.toLocaleString() + ' triangles: curved panels may print with visible flat facets.</div>' : '';
  return `${head('Check', `${c.triangles.toLocaleString()} triangles`)}
    <div class="kinds">${KINDS.map(([k, n, d]) => `<div class="kind${c.kind === k ? ' on' : ''}"><b>${n}</b>${d}</div>`).join('')}</div>
    <div class="verdict">${VERDICT[c.kind]}</div>
    ${c.kind === 'shell' && c.wall ? `<div class="muted" style="margin-top:-6px">Walls about ${fmtLen(c.wall, u)} thick. To slice it closed all the way across, <button class="btn sm ghost" data-act="final-go" data-v="solid">make it solid</button> first.</div>` : ''}
    <div class="crows">${rows.join('')}</div>
    ${expect}${coarse}
    ${fixable ? '<div class="row"><button class="btn primary sm" data-act="fix-now">' + icon('wrench') + 'Light fix</button><button class="btn ghost sm" data-act="tool" data-v="fix">Choose what to fix</button></div>' : ''}`;
}

function fixOptions() {
  const editing = project.steps.find((s) => s.id === ui.editStep && s.type === 'repair');
  if (editing) {
    if (ui.fixFor !== editing.id) {
      ui.fixOpts = { ...editing.params };
      ui.fixFor = editing.id;
    }
  } else if (!ui.fixOpts || ui.fixFor) {
    ui.fixOpts = { clean: true, untangle: true, winding: true, specks: true, holes: true };
    ui.fixFor = null;
  }
  return ui.fixOpts;
}

function panelFix(editing) {
  const o = fixOptions();
  const c = editing ? null : lookup('check');
  const n = (k) => (c ? ` <span class="muted">(${c[k].toLocaleString()} found)</span>` : '');
  const opt = (key, label, count) => `<label class="chk"><input type="checkbox" data-field="fix-${key}" ${o[key] ? 'checked' : ''}>${label}${count ?? ''}</label>`;
  return `${head(editing ? 'Change light fix' : 'Light fix', 'Cleans up faults without moving the surface you see.')}
    ${opt('specks', 'Remove specks', n('specks'))}
    ${opt('clean', 'Remove broken and doubled triangles', c ? ` <span class="muted">(${(c.collapsed + c.doubled).toLocaleString()} found)</span>` : '')}
    ${opt('untangle', 'Untangle surfaces that touch', n('crowded'))}
    ${opt('winding', 'Turn inside-out areas round', n('flipped'))}
    ${opt('holes', 'Close small holes', n('smallHoles'))}
    <div class="row"><button class="btn primary sm" data-act="fix-apply">${editing ? 'Update step' : 'Fix'}</button>${editing ? '<button class="btn ghost sm" data-act="stop-edit">Done</button>' : ''}</div>`;
}

function panelParts() {
  const c = lookup('check');
  if (!c) return head('Parts', 'Finding the parts…');
  const u = project.units;
  ui.partsDrop ??= new Set(c.parts.filter((p) => p.speck).map((p) => p.id));
  if (c.parts.length === 1)
    return `${head('Parts', 'Separate pieces of the model.')}<div class="note ok">This model is one piece.</div>`;
  const rows = c.parts
    .slice(0, 60)
    .map((p, i) => {
      const keep = !ui.partsDrop.has(p.id);
      const name = i === 0 ? 'Body' : p.speck ? 'Speck' : `Part ${i + 1}`;
      return `<label class="prow" data-part="${p.id}"><input type="checkbox" data-act="part-keep" data-v="${p.id}" ${keep ? 'checked' : ''}>
        <span><b>${name}</b><small>${p.triangles.toLocaleString()} triangles · ${p.size.map((s) => fmtLen(s, u, 1)).join(' × ')}</small></span></label>`;
    })
    .join('');
  const more = c.parts.length > 60 ? `<div class="muted" style="font-size:12px">And ${c.parts.length - 60} more small parts.</div>` : '';
  return `${head('Parts', 'Tick the parts to keep. Point at a part to see it on the car.')}
    <div class="plist">${rows}</div>${more}
    <button class="btn primary sm" data-act="parts-apply"${ui.partsDrop.size ? '' : ' disabled'}>Remove ${ui.partsDrop.size} unticked part${ui.partsDrop.size === 1 ? '' : 's'}</button>`;
}

function panelOpenings(editing) {
  const list = lookup('openings');
  ui.fillMode ??= 'smooth';
  if (editing) {
    return `${head('Close openings', `This step closes ${editing.params.loops.length} opening${editing.params.loops.length === 1 ? '' : 's'} (${editing.params.mode}).`)}
      <div class="note">To close different openings, remove this step and choose again.</div>
      <div class="row"><button class="btn ghost sm" data-act="stop-edit">Done</button></div>`;
  }
  if (!list) return head('Close openings', 'Finding the openings…');
  if (!list.length) return `${head('Close openings', 'Openings in the surface.')}<div class="note ok">This model has no openings.</div>`;
  const u = project.units;
  const sorted = [...list].sort((a, b) => b.length - a.length);
  const rows = sorted
    .slice(0, 80)
    .map(
      (o, i) => `<label class="prow" data-loop="${o.id}"><input type="checkbox" data-act="loop-close" data-v="${o.id}" ${ui.closeLoops.has(o.id) ? 'checked' : ''}>
        <span><b>${i === 0 && !o.small ? 'Largest opening' : o.small ? 'Small hole' : 'Opening'}</b><small>${fmtLen(o.length, u, 1)} around · ${o.edges} edges</small></span></label>`,
    )
    .join('');
  const small = list.filter((o) => o.small).length;
  return `${head('Close openings', 'Tick the openings to close. They show in amber on the car; point at one to find it.')}
    <div class="muted" style="font-size:12px">The underside and the windows of a body are openings too: leave those open.</div>
    ${small ? `<button class="btn sm ghost" data-act="loops-small">Tick the ${small} small hole${small > 1 ? 's' : ''}</button>` : ''}
    <div class="plist">${rows}</div>
    <div class="f">Patch<span class="seg"><button data-act="fill-mode" data-v="smooth" class="${ui.fillMode === 'smooth' ? 'on' : ''}">Smooth</button><button data-act="fill-mode" data-v="flat" class="${ui.fillMode === 'flat' ? 'on' : ''}">Flat</button></span></div>
    <button class="btn primary sm" data-act="fill-apply"${ui.closeLoops.size ? '' : ' disabled'}>Close ${ui.closeLoops.size || ''} opening${ui.closeLoops.size === 1 ? '' : 's'}</button>`;
}

// Make solid's flat bottom: 10% of the height above the lowest point, to start with.
const solidDefault = () => {
  const b = result.stats.bounds;
  return { flat: true, bottom: round(b.min[2] + b.size[2] * 0.1, 2) };
};

function panelSolid(editing) {
  ui.solid ??= solidDefault();
  if (editing && ui.solidFor !== editing.id) {
    const p = editing.params;
    ui.solid = p.bottom != null ? { flat: true, bottom: p.bottom } : { ...solidDefault(), flat: false };
    ui.solidFor = editing.id;
  }
  if (!editing) ui.solidFor = null;
  const u = project.units;
  const intro = head(editing ? 'Change make solid' : 'Make solid', 'Turns a hollow shell into a solid: the inner skin goes and the windows and underside are closed. To make it a body again later, set a Floor line and Hollow it.');
  const open = `<label class="chk"><input type="checkbox" data-field="solid-flat" ${ui.solid.flat ? 'checked' : ''}>Cut the underside off flat</label>
    ${ui.solid.flat ? `<div class="f">Flat bottom at<div class="row">${numField('solid-bottom', round(toUnits(ui.solid.bottom, u), 3), u)}</div>
      <div class="muted" style="font-weight:400;font-size:12px">Everything below this height goes, and the body is closed flat there, wheel arches included. Do this here rather than with a slice afterwards: a slice through a closed-up underside cannot always close it again.</div></div>`
    : '<div class="muted" style="font-size:12px">The underside is closed with walls straight down from its edge to its lowest point.</div>'}`;
  if (editing) {
    const info = result.results.find((r) => r.id === editing.id)?.info;
    return `${intro}
      ${info ? `<div class="note">${info.removed.toLocaleString()} triangles of inner skin removed${info.inside ? `, ${info.inside} loose piece${info.inside === 1 ? '' : 's'} inside` : ''}${info.closed ? `, ${info.closed} opening${info.closed === 1 ? '' : 's'} closed` : ''}.</div>` : ''}
      ${open}
      <div class="row"><button class="btn primary sm" data-act="solid-apply">Update step</button><button class="btn ghost sm" data-act="stop-edit">Done</button></div>`;
  }
  const pv = lookup('solid');
  if (!pv) return `${intro}<div class="note">Finding the inner skin…</div>`;
  if (pv.error) return `${intro}<div class="note warn">${esc(pv.error)}</div>`;
  return `${intro}
    <div class="note">The inner skin shown in red goes: ${pv.gone.toLocaleString()} triangles, ${Math.round(pv.share * 100)}% of the model. The wall was about ${fmtLen(pv.wall, project.units)} thick. Loose pieces left inside the body, such as seats, go too.</div>
    ${pv.share > 0.6 ? '<div class="note warn">That is more than half of the model. Check the red part is really the inside before going on.</div>' : ''}
    ${open}
    <div class="row"><button class="btn primary sm" data-act="solid-apply">${icon('solid')}Make solid</button></div>`;
}

let hoverLoop = null;
function drawOpenings(show) {
  const list = show ? lookups.openings.token === buildToken && lookups.openings.value : null;
  viewport.outlines(list || null, hoverLoop, ui.closeLoops);
}

function reduceTolerance() {
  ui.reduce ??= { keep: 50, tolerance: null };
  return ui.reduce.tolerance ?? Math.max(0.005, round(Math.hypot(...result.stats.bounds.size) * 0.0004, 3));
}

function panelReduce(editing) {
  ui.reduce ??= { keep: 50, tolerance: null };
  if (editing && ui.reduceFor !== editing.id) {
    ui.reduce = { keep: Math.round(editing.params.target * 100), tolerance: editing.params.tolerance };
    ui.reduceFor = editing.id;
  }
  if (!editing) ui.reduceFor = null;
  const done = editing && result.results.find((r) => r.id === editing.id)?.info;
  const n = done ? done.before : result.stats.triangles,
    u = project.units;
  return `${head(editing ? 'Change reduce step' : 'Reduce', 'Fewer triangles where the surface is flat, so heavy files stay quick. Openings keep their outline.')}
    <div class="note">${done ? `Before this step: ${n.toLocaleString()} triangles. After: ${done.after.toLocaleString()}.` : `Now ${n.toLocaleString()} triangles.`}</div>
    <div class="f">Keep<input type="range" data-field="reduce-keep-range" min="5" max="95" step="5" value="${ui.reduce.keep}"><span class="mono" id="reduce-keep-val" style="font-size:12px;font-weight:400">${ui.reduce.keep}% · about ${Math.round((n * ui.reduce.keep) / 100).toLocaleString()} triangles</span></div>
    <div class="f">The shape may move at most<div class="row">${numField('reduce-tol', round(toUnits(reduceTolerance(), u), 4), u)}</div>
      <div class="muted" style="font-weight:400;font-size:12px">Anvil stops early rather than move the surface further than this.</div></div>
    <div class="row"><button class="btn primary sm" data-act="reduce-apply">${editing ? 'Update step' : 'Reduce'}</button>${editing ? '<button class="btn ghost sm" data-act="stop-edit">Done</button>' : ''}</div>`;
}


// ------------------------------------------------------------ shell

const printOf = () => ({ ...DEFAULT_PRINT, ...(project.print ?? {}) });
// FDM walls are best as whole lines of the nozzle.
function snapWall(t) {
  const p = printOf();
  if (p.process !== 'fdm') return round(t, 2);
  return round(Math.max(1, Math.round(t / p.nozzle)) * p.nozzle, 2);
}
const lines = (t) => {
  const p = printOf();
  return p.process === 'fdm' ? ` · ${Math.round(t / p.nozzle)} lines of ${p.nozzle} mm` : '';
};

function floorGuide() {
  if (ui.panel === 'floor' || project.steps.find((s) => s.id === ui.editStep)?.type === 'floor') viewport.planeGuide('z', ui.floor.at, 0x3b9cff);
}

function panelFloor(editing) {
  const b = result.stats.bounds,
    u = project.units;
  ui.floor ??= { mode: 'cut', at: null, blend: 6, editingId: null };
  if (editing && ui.floor.editingId !== editing.id) Object.assign(ui.floor, editing.params, { editingId: editing.id });
  if (!editing) ui.floor.editingId = null;
  const lo = b.min[2],
    hi = b.min[2] + b.size[2] * 0.4;
  if (ui.floor.at == null || (!editing && (ui.floor.at < lo || ui.floor.at > hi))) ui.floor.at = round(lo + b.size[2] * 0.06, 2);
  const f = ui.floor;
  const pressed = f.mode === 'squish' && f.at > lo ? Math.round((1 - (f.blend) / (f.at + f.blend - lo)) * 100) : 0;
  return `${head(editing ? 'Change floor line' : 'Floor line', 'Where the underside of the body ends. Below the line is opened up, so the body can sit over a chassis.')}
    <span class="seg"><button data-act="floor-mode" data-v="cut" class="${f.mode === 'cut' ? 'on' : ''}">Cut</button><button data-act="floor-mode" data-v="squish" class="${f.mode === 'squish' ? 'on' : ''}">Squish</button></span>
    <div class="muted" style="font-size:12px">${f.mode === 'cut' ? 'Removes everything below the line.' : 'Presses the lower body up onto the line, so sills and valances keep their shape. Only heights change; length and width stay exact.'}</div>
    <div class="f">Floor line at<input type="range" data-field="floor-range" min="${lo}" max="${hi}" step="${(hi - lo) / 400}" value="${f.at}">
      <div class="row">${numField('floor-at', round(toUnits(f.at, u)), u)}<span class="muted">above the lowest point: ${fmtLen(f.at - lo, u)}</span></div></div>
    ${f.mode === 'squish' ? `<div class="f">Squish reaches up<div class="row">${numField('floor-blend', round(toUnits(f.blend, u)), u)}</div>
      <div class="muted" style="font-weight:400;font-size:12px">The zone above the line that is pressed together: ${pressed}% shorter.${pressed > 40 ? ' That is a lot: details there will look squashed.' : ''}</div></div>` : ''}
    <div class="row"><button class="btn primary sm" data-act="floor-apply">${editing ? 'Update step' : f.mode === 'cut' ? 'Cut' : 'Squish'}</button>${editing ? '<button class="btn ghost sm" data-act="stop-edit">Done</button>' : ''}</div>`;
}

const hollowStep = () => [...project.steps].reverse().find((s) => s.type === 'hollow' && s.enabled);

function hollowOptions() {
  const p = printOf();
  const d = PRINT_WALLS[p.process];
  const editing = project.steps.find((s) => s.id === ui.editStep && s.type === 'hollow');
  if (editing && ui.hollow?.for !== editing.id) {
    ui.hollow = { for: editing.id, wall: editing.params.wall, lighten: Number.isFinite(editing.params.top), top: editing.params.top ?? d.top };
  } else if (!editing && (!ui.hollow || ui.hollow.for)) {
    ui.hollow = { for: null, wall: snapWall(d.wall), lighten: false, top: snapWall(d.top) };
  }
  return ui.hollow;
}

function printSettings() {
  const p = printOf();
  const mats = Object.entries(MATERIALS).filter(([, m]) => m.process === p.process);
  return `<div class="f">Printing in<span class="seg"><button data-act="print-process" data-v="resin" class="${p.process === 'resin' ? 'on' : ''}">Resin</button><button data-act="print-process" data-v="fdm" class="${p.process === 'fdm' ? 'on' : ''}">FDM (filament)</button></span>
    <div class="row"><select class="num" style="width:auto" data-field="material">${mats.map(([k, m]) => `<option value="${k}"${p.material === k ? ' selected' : ''}>${m.name}</option>`).join('')}</select>
    ${p.process === 'fdm' ? `<span class="muted">nozzle</span>${numField('nozzle', p.nozzle, 'mm')}` : ''}</div></div>`;
}

function panelHollow(editing) {
  const o = hollowOptions(),
    u = project.units;
  const min = PRINT_WALLS[printOf().process].min;
  const check = lookups.check.token === buildToken ? lookups.check.value : null;
  return `${head(editing ? 'Change hollow step' : 'Hollow', 'Builds an even wall inwards from the outside. The outside does not move.')}
    ${printSettings()}
    <div class="f">Wall<div class="row">${numField('hollow-wall', round(toUnits(o.wall, u), 3), u)}<span class="muted" style="font-size:12px">${lines(o.wall)}</span></div>
      ${o.wall < min ? `<div class="note warn" style="font-weight:400">Thinner than ${fmtLen(min, u)} may not print or survive a crash.</div>` : ''}</div>
    <label class="chk"><input type="checkbox" data-act="top-toggle" ${o.lighten ? 'checked' : ''}>Lighten the top</label>
    ${o.lighten ? `<div class="f">Wall at the roof<div class="row">${numField('hollow-top', round(toUnits(o.top, u), 3), u)}<span class="muted" style="font-size:12px">${lines(o.top)}</span></div>
      <div class="muted" style="font-weight:400;font-size:12px">The wall thins evenly from the sills (${fmtLen(o.wall, u)}) up to the roof. Less weight up high.</div></div>` : ''}
    ${check?.kind === 'shell' || !check ? '<div class="muted" style="font-size:12px">If the model is already hollow, its old inside wall is replaced by the new one.</div>' : ''}
    <div class="row"><button class="btn primary sm" data-act="hollow-apply">${editing ? 'Update step' : 'Hollow'}</button>${editing ? '<button class="btn ghost sm" data-act="stop-edit">Done</button>' : ''}</div>`;
}

function paintRadius() {
  ui.paint ??= { dir: 'thinner', wall: null, radius: null };
  return ui.paint.radius ?? round(Math.hypot(...result.stats.bounds.size) * 0.04, 1);
}

function panelPaint() {
  const step = hollowStep(),
    u = project.units;
  paintRadius();
  if (!step)
    return `${head('Paint thickness', 'Paint thinner or thicker areas on the wall.')}<div class="note warn">Hollow the body first: painting changes the wall that Hollow builds.</div>
      <button class="btn sm" data-act="tool" data-v="hollow">${icon('shell')}Hollow</button>`;
  const d = PRINT_WALLS[printOf().process];
  if (ui.paint.wall == null) ui.paint.wall = snapWall(ui.paint.dir === 'thinner' ? d.min : step.params.wall * 1.5);
  const n = step.params.strokes?.length ?? 0;
  return `${head('Paint thickness', 'Paint on the car with the left mouse button. Only the inside moves. Each stroke rebuilds the wall.')}
    <span class="seg"><button data-act="paint-dir" data-v="thinner" class="${ui.paint.dir === 'thinner' ? 'on' : ''}">Thinner</button><button data-act="paint-dir" data-v="thicker" class="${ui.paint.dir === 'thicker' ? 'on' : ''}">Thicker</button></span>
    <div class="f">Paint the wall to<div class="row">${numField('paint-wall', round(toUnits(ui.paint.wall, u), 3), u)}<span class="muted" style="font-size:12px">${lines(ui.paint.wall)}</span></div></div>
    <div class="f">Brush size<div class="row"><input type="range" data-field="paint-radius" min="1" max="${round(Math.hypot(...result.stats.bounds.size) * 0.2, 0)}" step="0.5" value="${paintRadius()}"><span class="mono" id="paint-radius-val">${fmtLen(paintRadius(), u, 1)}</span></div></div>
    <div class="row"><span class="muted" style="font-size:12px">${n} painted spot${n === 1 ? '' : 's'}</span>${n ? '<button class="btn sm ghost" data-act="paint-clear">Clear painting</button>' : ''}</div>
    ${ui.pointer === 'paint' ? '' : '<button class="btn primary sm" data-act="pointer" data-v="paint">' + icon('brush') + 'Start painting</button>'}`;
}

function paintAt(e, hit = viewport.pick(e)) {
  if (!hit || !drag) return;
  const r = paintRadius();
  const last = drag.strokes.at(-1);
  if (last && Math.hypot(...last.at.map((x, k) => x - hit.point.getComponent(k))) < r * 0.5) return;
  const spot = { at: hit.point.toArray().map((x) => round(x, 3)), radius: r, wall: ui.paint.wall };
  drag.strokes.push(spot);
  if (project.mirror) drag.strokes.push({ ...spot, at: [spot.at[0], -spot.at[1], spot.at[2]] });
  viewport.marker(hit.point, 0x3b9cff);
}

function addStrokes(strokes) {
  const step = hollowStep();
  if (!step) return;
  viewport.clearOverlay();
  commit(() => (step.params = { ...step.params, strokes: [...(step.params.strokes ?? []), ...strokes] }));
}

// ------------------------------------------------------------ wall colours, weight

function heatScale() {
  const p = printOf();
  const step = hollowStep();
  const mid = step ? step.params.wall : PRINT_WALLS[p.process].wall;
  return { min: PRINT_WALLS[p.process].min, mid, max: mid * 2 };
}

function applyHeat() {
  const legend = $('#legend');
  if (!result || !ui.look.thickness) {
    viewport.setHeat(null);
    if (legend) legend.hidden = true;
    return;
  }
  const values = lookup('thickness');
  if (!values) return;
  const s = heatScale(),
    u = project.units;
  viewport.setHeat(values, s);
  legend.hidden = false;
  legend.innerHTML = `<span class="eyebrow" style="font-size:10px">Wall thickness</span><span class="lbar"></span>
    <span class="lsc"><span style="color:var(--accent-text)">&lt; ${fmtLen(s.min, u, 1)}</span><span>${fmtLen(s.mid, u, 1)}</span><span>${fmtLen(s.max, u, 1)}+</span></span>`;
}

function wallStats() {
  if (lookups.thickness.token !== buildToken || !lookups.thickness.value) return null;
  const v = Array.from(lookups.thickness.value).filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  return { thin: v[Math.floor(v.length * 0.02)], median: v[Math.floor(v.length / 2)] };
}

function wallStatus() {
  const u = project.units,
    s = result.stats,
    p = printOf();
  const parts = [];
  const w = wallStats();
  const min = PRINT_WALLS[p.process].min;
  let dot = 'no';
  if (w) {
    parts.push(`<span class="sb"><span class="dot ${w.thin < min ? 'w' : 'ok'}"></span><b>Wall</b>${fmtLen(w.median, u)} · thinnest ${fmtLen(w.thin, u)}</span>`);
  } else parts.push(`<span class="sb"><span class="dot no"></span><b>Wall</b>${hollowStep() ? 'turn on Thickness to measure' : 'not hollowed yet'}</span>`);
  if (s.volume) {
    const g = (s.volume / 1000) * MATERIALS[p.material].density;
    dot = 'ok';
    parts.push(`<span class="sb" title="${MATERIALS[p.material].name}, solid print"><span class="dot ${dot}"></span><b>Weight</b>${g.toFixed(1)} g</span>`);
  } else parts.push('<span class="sb"><span class="dot no"></span><b>Weight</b>needs a closed body</span>');
  return parts.join('');
}


// ------------------------------------------------------------ hammer

function hammerOptions() {
  const diag = Math.hypot(...result.stats.bounds.size);
  ui.hammerOpts ??= { mode: 'hammer', side: 'out', radius: round(diag * 0.05, 1), force: round(diag * 0.002, 2) };
  return ui.hammerOpts;
}

// The hammer step that new blows go into. Blows are placed on the body as it
// looks now, so they belong right before Hollow, after anything that moves
// the outside (stretch, arch cuts). Only a Hammer step already sitting there
// is reused; otherwise addBlows makes a new one in that place.
function hammerStep() {
  const firstHollow = project.steps.findIndex((s) => s.type === 'hollow' && s.enabled);
  const before = (firstHollow < 0 ? project.steps : project.steps.slice(0, firstHollow)).filter((s) => s.enabled);
  const last = before.at(-1);
  return last?.type === 'hammer' ? last : null;
}

function panelHammer(editing) {
  const o = hammerOptions(),
    u = project.units;
  const steps = editing ? [editing] : project.steps.filter((s) => s.type === 'hammer' && s.enabled);
  const blows = steps.reduce((n, s) => n + (s.params.blows?.length ?? 0), 0),
    dollies = steps.reduce((n, s) => n + (s.params.dollies?.length ?? 0), 0);
  const diag = Math.hypot(...result.stats.bounds.size);
  const hollow = project.steps.some((s) => s.type === 'hollow' && s.enabled);
  return `${head('Hammer', 'Tap or drag on the body with the left mouse button. Each blow moves the panel a little, most under the middle of the head.')}
    <span class="seg"><button data-act="hammer-mode" data-v="hammer" class="${o.mode === 'hammer' ? 'on' : ''}">Hammer</button><button data-act="hammer-mode" data-v="dolly" class="${o.mode === 'dolly' ? 'on' : ''}">Dolly</button><button data-act="hammer-mode" data-v="planish" class="${o.mode === 'planish' ? 'on' : ''}">Planish</button></span>
    <div class="muted" style="font-size:12px">${
      o.mode === 'hammer'
        ? 'Moves the panel out or in.'
        : o.mode === 'dolly'
          ? 'Paint where the hammer must not move anything, like holding a dolly behind the panel.'
          : 'Smooths out hammer marks under the head.'
    }</div>
    ${o.mode === 'hammer' ? `<div class="f">Hit<span class="seg"><button data-act="hammer-side" data-v="out" class="${o.side === 'out' ? 'on' : ''}">From behind: out</button><button data-act="hammer-side" data-v="in" class="${o.side === 'in' ? 'on' : ''}">From outside: in</button></span></div>` : ''}
    <div class="f">Head size<div class="row"><input type="range" data-field="hammer-radius" min="${round(diag * 0.01, 1)}" max="${round(diag * 0.2, 1)}" step="0.5" value="${o.radius}"><span class="mono" id="hammer-radius-val">${fmtLen(o.radius, u, 1)}</span></div></div>
    ${o.mode !== 'dolly' ? `<div class="f">${o.mode === 'planish' ? 'Strength' : 'Force (per blow)'}<div class="row"><input type="range" data-field="hammer-force" min="0.01" max="${round(diag * 0.01, 2)}" step="0.01" value="${o.force}"><span class="mono" id="hammer-force-val">${fmtLen(o.force, u, 2)}</span></div></div>` : ''}
    <div class="row"><span class="muted" style="font-size:12px">${blows} blow${blows === 1 ? '' : 's'}${dollies ? `, ${dollies} dolly spot${dollies === 1 ? '' : 's'}` : ''}${project.mirror ? ' · mirrored' : ''}</span>${dollies ? '<button class="btn sm ghost" data-act="dolly-clear">Clear dolly</button>' : ''}</div>
    ${hollow ? '<div class="muted" style="font-size:12px">The hammer works on the outside before Hollow, so the wall is rebuilt evenly behind it. Each stroke rebuilds the body.</div>' : ''}
    ${ui.pointer === 'hammer' ? '' : '<button class="btn primary sm" data-act="pointer" data-v="hammer">' + icon('hammer') + 'Pick up the hammer</button>'}`;
}

function hammerAt(e, hit = viewport.pick(e)) {
  if (!hit || !drag) return;
  const o = hammerOptions();
  const list = o.mode === 'dolly' ? drag.dollies : drag.blows;
  const last = list.at(-1);
  if (last && Math.hypot(...last.at.map((x, k) => x - hit.point.getComponent(k))) < o.radius * 0.4) return;
  const at = hit.point.toArray().map((x) => round(x, 3));
  const mirrored = project.mirror && Math.abs(at[1]) > o.radius * 0.25 ? [[at[0], -at[1], at[2]]] : [];
  for (const p of [at, ...mirrored]) {
    if (o.mode === 'dolly') {
      drag.dollies.push({ at: p, radius: o.radius });
      viewport.marker(new hit.point.constructor(...p), 0x3b9cff);
    } else {
      const kind = o.mode === 'planish' ? 'planish' : o.side;
      drag.blows.push({ at: p, radius: o.radius, depth: o.force, kind });
      if (kind !== 'planish') viewport.previewBlow(p, o.radius, kind === 'out' ? o.force : -o.force);
    }
  }
}

function addBlows(blows, dollies) {
  viewport.clearOverlay();
  commit(() => {
    let step = hammerStep();
    if (!step) {
      step = { id: newId(), type: 'hammer', enabled: true, params: { blows: [], dollies: [] } };
      const at = project.steps.findIndex((s) => s.type === 'hollow' && s.enabled);
      if (at < 0) project.steps.push(step);
      else project.steps.splice(at, 0, step);
    }
    step.params = {
      blows: [...(step.params.blows ?? []), ...blows],
      dollies: [...(step.params.dollies ?? []), ...dollies],
    };
  });
}


// ------------------------------------------------------------ chassis

// The track the chassis stands on, under the body by the chosen clearance.
// The bottom of the body: from before the posts, so a long post hanging
// below the body does not push the chassis down.
function bodyBottom() {
  const posts = postsStep();
  const info = posts && result.results.find((r) => r.id === posts.id)?.info;
  return info?.bodyBottom ?? result.stats.bounds.min[2];
}
const groundZ = () => bodyBottom() - project.chassis.clearance;

function drawGhost() {
  if (!result || !project?.chassis || !ui.look.chassis) return viewport.setGhost(null);
  viewport.setGhost(project.chassis, groundZ(), chassisMeshPlaced());
}

// The chassis STL turned like the car (front at low X, up Z), then put where
// the user placed it: centred between the axles, standing on the track.
let meshCache = { key: null, base: null, placed: null };
function chassisMeshPlaced() {
  const c = project.chassis,
    m = project.chassisMesh;
  if (!c?.stl || !m) return null;
  if (meshCache.bytes !== m.bytes) {
    try {
      const raw = readSTLMesh(m.bytes);
      meshCache = { bytes: m.bytes, base: applyOrient(raw, guessOrient(raw)), key: null };
    } catch (e) {
      toast(`The chassis file could not be read: ${e.message}`, 'bad');
      meshCache = { bytes: m.bytes, base: null, key: null };
    }
  }
  if (!meshCache.base) return null;
  const s = c.stl;
  const key = JSON.stringify([s, c.frontX, c.wheelbase, groundZ()]);
  if (meshCache.key === key) return meshCache.placed;
  const src = meshCache.base.positions;
  const pos = new Float32Array(src.length);
  const cx = c.frontX + c.wheelbase / 2 + (s.along ?? 0),
    z0 = groundZ() + (s.height ?? 0.5);
  for (let i = 0; i < src.length; i += 3) {
    const f = s.flip ? -1 : 1;
    pos[i] = cx + src[i] * f;
    pos[i + 1] = src[i + 1] * f;
    pos[i + 2] = z0 + src[i + 2];
  }
  meshCache.key = key;
  meshCache.placed = { positions: pos, indices: meshCache.base.indices };
  return meshCache.placed;
}

// Number fields of the chassis, as "path" → value in mm (typed in the current units).
function setChassisField(path, raw) {
  const v = Number(raw);
  if (path !== 'name' && !Number.isFinite(v)) return;
  const u = project.units;
  commit(() => {
    const c = structuredClone(project.chassis);
    const [a, b] = path.split('.');
    if (path === 'name') c.name = String(raw).trim() || 'My chassis';
    else if (path === 'frontFromNose') c.frontX = round(result.stats.bounds.min[0] + fromUnits(v, u), 3);
    else if (path === 'rearAlong') c.wheelbase = round(fromUnits(v, u), 3);
    else if (b) c[a] = { ...c[a], [b]: round(fromUnits(v, u), 3) };
    else c[a] = path === 'wheelbaseMin' || path === 'wheelbaseMax' ? (raw === '' ? null : round(fromUnits(v, u), 3)) : round(fromUnits(v, u), 3);
    project.chassis = c;
  }, false);
}

// ------------------------------------------------------------ chassis library

const lib = { list: null, busy: false, error: null };
function libraryList() {
  if (lib.list || lib.busy || lib.error) return lib.list;
  lib.busy = true;
  library()
    .then((db) => (lib.list = listChassis(db)))
    .catch((e) => (lib.error = e.message))
    .finally(() => {
      lib.busy = false;
      if (ui.panel === 'chassis') renderPanel();
    });
  return null;
}
async function libraryChange(fn, message) {
  try {
    const out = await changeLibrary(fn);
    lib.list = listChassis(await library());
    if (message) toast(message);
    renderPanel();
    return out;
  } catch (e) {
    toast(e.message, 'bad');
  }
}

function libraryBox() {
  const list = libraryList(),
    u = project.units;
  const rows = lib.error
    ? `<div class="note bad">The library could not be opened: ${esc(lib.error)}</div>`
    : !list
      ? '<div class="muted" style="font-size:12px">Opening the library…</div>'
      : !list.length
        ? '<div class="muted" style="font-size:12px">Your library is empty. Save a chassis to keep it for your next body.</div>'
        : `<div class="plist">${list
            .map(
              (r) => `<div class="prow lrow${project.chassis?.libId === r.id ? ' cur' : ''}"><span><b>${esc(r.name)}</b><small>wheelbase ${fmtLen(r.data.wheelbase, u, 1)}${
                r.data.wheelbaseMin != null || r.data.wheelbaseMax != null ? ` (${fmtLen(r.data.wheelbaseMin ?? r.data.wheelbase, u, 0)}–${fmtLen(r.data.wheelbaseMax ?? r.data.wheelbase, u, 0)})` : ''
              } · tyres ${fmtLen(r.data.front.diameter, u, 1)} / ${fmtLen(r.data.rear.diameter, u, 1)}${r.stlName ? ' · STL' : ''}</small></span>
              <button class="btn sm" data-act="lib-use" data-v="${r.id}">Use</button>
              <button class="btn sm icon ghost" data-act="lib-share" data-v="${r.id}" title="Share as a file">${icon('export')}</button>
              <button class="btn sm icon ghost" data-act="lib-delete" data-v="${r.id}" title="Remove from the library">${icon('trash')}</button></div>`,
            )
            .join('')}</div>`;
  return `<div class="f">Your library${rows}</div>
    <div class="row"><button class="btn sm ghost" data-act="chassis-import">${icon('open')}Load chassis file</button></div>`;
}

const chField = (path, value, unit = project.units) =>
  `<span class="num"><input data-field="ch-${path}" type="number" step="any" value="${value == null ? '' : round(toUnits(value, project.units), 3)}">${unit ? `<small>${unit}</small>` : ''}</span>`;

function panelChassis() {
  const c = project.chassis,
    u = project.units;
  if (!c) {
    const a = lookup('arches');
    return `${head('Chassis', 'The chassis the body goes on, shown as a blue ghost inside it. It is never exported.')}
      ${a ? `<div class="note">Anvil found ${a.arches.length === 2 ? `both wheel arches, ${fmtLen(a.arches[1].x - a.arches[0].x, u)} apart` : a.arches.length === 1 ? 'one wheel arch' : 'no wheel arches'}.</div>` : '<div class="muted">Looking for the wheel arches…</div>'}
      <button class="btn primary sm" data-act="chassis-new"${a ? '' : ' disabled'}>${icon('plus')}New chassis that fits</button>
      <div class="muted" style="font-size:12px">Then type in your chassis's own numbers, or load its STL to see it inside the body.</div>
      <div class="hr"></div>
      ${libraryBox()}`;
  }
  const front = c.frontX - result.stats.bounds.min[0];
  return `${head('Chassis', 'Numbers of your chassis. The ghost and the fit check follow as you type.')}
    <div class="f">Name<span class="num" style="width:100%"><input data-field="ch-name" type="text" value="${esc(c.name)}" style="font-family:var(--font-ui)"></span></div>
    <div class="g2">
      <span class="fx">Wheelbase${chField('rearAlong', c.wheelbase)}</span>
      <span class="fx">Front axle behind the nose${chField('frontFromNose', front)}</span>
      <span class="fx">Adjustable from${chField('wheelbaseMin', c.wheelbaseMin)}</span>
      <span class="fx">to${chField('wheelbaseMax', c.wheelbaseMax)}</span>
      <span class="fx">Body above the track${chField('clearance', c.clearance)}</span>
      <span class="fx">Deck height${chField('deck', c.deck)}</span>
      <span class="fx">Guide ahead of front axle${chField('guideAhead', c.guideAhead)}</span>
    </div>
    <div class="row"><button class="btn sm ghost" data-act="tool" data-v="tyres">${icon('tyre')}Tyres</button><button class="btn sm ghost danger" data-act="chassis-remove">Remove chassis</button></div>
    <div class="hr"></div>
    <div class="f">Chassis STL${
      c.stl && project.chassisMesh
        ? `<div class="muted" style="font-weight:400;font-size:12px">${esc(c.stl.fileName)} · shown in the ghost. Put it where it sits on your car.</div>
      <div class="g2"><span class="fx">Move along${chField('stl.along', c.stl.along ?? 0)}</span><span class="fx">Height above the track${chField('stl.height', c.stl.height ?? 0.5)}</span></div>
      <div class="row"><button class="btn sm ghost" data-act="stl-flip">Turn it around</button><button class="btn sm ghost danger" data-act="stl-remove">Remove STL</button></div>`
        : `<div class="muted" style="font-weight:400;font-size:12px">Load your chassis's own STL to see the real chassis inside the body. The tyre numbers above stay in charge of the fit.</div>
      <div class="row"><button class="btn sm ghost" data-act="stl-load">${icon('open')}Load chassis STL</button></div>`
    }</div>
    <div class="hr"></div>
    <div class="row"><button class="btn sm primary" data-act="lib-save">${icon('save')}${c.libId ? 'Update in library' : 'Save to library'}</button>${c.libId ? '<button class="btn sm ghost" data-act="lib-save-new">Save as new</button>' : ''}<button class="btn sm ghost" data-act="chassis-share">${icon('export')}Share as a file</button></div>
    ${libraryBox()}`;
}

function panelTyres() {
  const c = project.chassis,
    u = project.units;
  if (!c) return panelChassis();
  const a = lookups.arches.token === buildToken ? lookups.arches.value : null;
  const r = a ? fitReport(c, a) : null;
  const card = (key, label) => {
    const t = c[key];
    const along = key === 'front' ? 0 : c.wheelbase;
    const note = r
      ? r[key].stickOut > 0.05
        ? `<span style="color:var(--warn)">Outer width ${fmtLen(r[key].outer * 2, u)} · ${fmtLen(r[key].stickOut, u)} outside the body</span>`
        : `Outer width ${fmtLen(r[key].outer * 2, u)} · ${fmtLen(-r[key].stickOut, u)} inside the body`
      : '';
    return `<div class="pair"><div class="ph">${icon('tyre')}<b>${label}</b><span class="lock">mirrored</span></div>
      <div class="g3"><span class="fx">Along (X)${key === 'front' ? `<span class="num" style="color:var(--muted)">0<small>start</small></span>` : chField('rearAlong', along)}</span>
        <span class="fx">In/out (Y)${chField(`${key}.inOut`, t.inOut)}</span>
        <span class="fx">Height (Z)<span class="num" style="color:var(--muted)">auto</span></span></div>
      <div class="g2"><span class="fx">Diameter${chField(`${key}.diameter`, t.diameter)}</span><span class="fx">Width${chField(`${key}.width`, t.width)}</span></div>
      <span class="muted" style="font-size:11.5px">${note}</span></div>`;
  };
  return `${head('Tyres', 'Each pair moves together and stays mirrored. Along is measured from the front axle, so the rear pair\'s value is the wheelbase.')}
    ${card('front', 'Front pair')}${card('rear', 'Rear pair')}
    <div class="muted" style="font-size:12px">Wheelbase from the two pairs: <b style="color:var(--ink)">${fmtLen(c.wheelbase, u)}</b></div>`;
}

// One plain sentence on the car about what does not fit, with the ways out.
function renderFitBar(show) {
  const bar = $('#fitbar');
  const a = show && project?.chassis && result ? lookup('arches') : null;
  if (!show || !project?.chassis || !a || !result) {
    bar.hidden = true;
    return;
  }
  const c = project.chassis,
    u = project.units,
    r = fitReport(c, a);
  let html = '';
  if (r.problems.includes('wheelbase')) {
    const longer = r.wheelbaseOff > 0;
    const inRange = (c.wheelbaseMin == null || r.bodyWheelbase >= c.wheelbaseMin) && (c.wheelbaseMax == null || r.bodyWheelbase <= c.wheelbaseMax);
    html = `<div><b>The body is ${fmtLen(Math.abs(r.wheelbaseOff), u)} ${longer ? 'longer' : 'shorter'} between the arches than this chassis.</b><br><span class="muted">Arches ${fmtLen(r.bodyWheelbase, u)} apart · chassis ${fmtLen(c.wheelbase, u)}${c.wheelbaseMin != null || c.wheelbaseMax != null ? ` (can go from ${fmtLen(c.wheelbaseMin ?? c.wheelbase, u)} to ${fmtLen(c.wheelbaseMax ?? c.wheelbase, u)})` : ''}</span></div>
      <div class="acts"><button class="btn primary sm" data-act="fit-wheelbase"${inRange ? '' : ' title="Outside the chassis\\u2019s range"'}>Set chassis to ${fmtLen(r.bodyWheelbase, u, 1)}</button><button class="btn ghost sm" data-act="stretch-match">${longer ? 'Shorten' : 'Lengthen'} the body</button></div>`;
  } else if (r.frontOff != null && Math.abs(r.frontOff) > 0.5) {
    html = `<div><b>The front axle is ${fmtLen(Math.abs(r.frontOff), u)} ${r.frontOff > 0 ? 'ahead of' : 'behind'} the middle of the front arch.</b></div>
      <div class="acts"><button class="btn primary sm" data-act="fit-front">Line it up</button></div>`;
  } else {
    const wide = ['front', 'rear'].find((k) => r.problems.includes(`${k}-wide`));
    const tall = ['front', 'rear'].find((k) => r.problems.includes(`${k}-tall`));
    if (wide)
      html = `<div><b>The ${wide} tyres stick out ${fmtLen(r[wide].stickOut, u)} on each side.</b><br><span class="muted">Body ${fmtLen((a.arches[wide === 'front' ? 0 : 1]?.halfWidth ?? 0) * 2, u)} wide there · tyres span ${fmtLen(r[wide].outer * 2, u)}</span></div>
        <div class="acts"><button class="btn primary sm" data-act="fit-in" data-v="${wide}">Move tyres in ${fmtLen(r[wide].stickOut + 0.1, u, 1)}</button><button class="btn ghost sm" data-act="widen-fit">Widen the body</button></div>`;
    else if (tall)
      html = `<div><b>The ${tall} tyres reach into the top of the arch.</b></div>
        <div class="acts"><button class="btn primary sm" data-act="fit-small" data-v="${tall}">Fit the tyres under the arch</button><button class="btn ghost sm" data-act="arch-cut" data-v="${tall}">Cut the arch round the tyre</button></div>`;
    else html = `<div><b style="color:var(--ok)">Body and chassis fit.</b><br><span class="muted">Arches line up with the axles; tyres clear the body.</span></div>`;
  }
  bar.innerHTML = `${icon(r.problems.length ? 'warn' : 'check')}${html}`;
  bar.classList.toggle('ok', !r.problems.length);
  bar.hidden = false;
}

function chassisStatus() {
  const c = project.chassis;
  if (!c) return '<span class="sb"><span class="dot no"></span><b>Chassis</b>none yet</span>';
  const a = lookup('arches');
  if (!a) return `<span class="sb"><span class="dot no"></span><b>Chassis</b>${esc(c.name)}</span>`;
  const r = fitReport(c, a),
    u = project.units;
  let text = 'fits';
  if (r.problems.includes('wheelbase')) text = `wheelbase ${fmtLen(Math.abs(r.wheelbaseOff), u)} too ${r.wheelbaseOff > 0 ? 'long' : 'short'}`;
  else if (r.problems.some((p) => p.endsWith('wide'))) text = 'tyres stick out';
  else if (r.problems.some((p) => p.endsWith('tall'))) text = 'tyres too tall';
  return `<span class="sb"><span class="dot ${r.problems.length ? 'w' : 'ok'}"></span><b>Chassis</b>${text}</span>`;
}


// ------------------------------------------------------------ stretch and arches

// Steps that change the outside go before Hollow (after any hammering), so the
// wall is built behind them and earlier hammer blows still land where they were made.
function addBeforeHollow(type, params) {
  const editing = project.steps.find((s) => s.id === ui.editStep && s.type === type);
  commit(() => {
    if (editing) return (editing.params = params);
    const step = { id: newId(), type, enabled: true, params };
    const at = project.steps.findIndex((s) => s.type === 'hollow' && s.enabled);
    if (at < 0) project.steps.push(step);
    else project.steps.splice(at, 0, step);
    ui.editStep = step.id;
  });
}

// The part of the body between the arches, where stretching happens.
function stretchZone(a) {
  const [f, r] = a.arches;
  return { from: round(f.x + f.width / 2, 3), to: round(r.x - r.width / 2, 3) };
}

function stretchOptions() {
  ui.stretch ??= { length: 0, width: 0 };
  const editing = project.steps.find((s) => s.id === ui.editStep && s.type === 'stretch');
  if (editing && ui.stretchFor !== editing.id) {
    ui.stretchFor = editing.id;
    if (editing.params.axis === 'x') ui.stretch.length = editing.params.amount;
    else ui.stretch.width = editing.params.amount;
  }
  if (!editing) ui.stretchFor = null;
  return ui.stretch;
}

function panelStretch(editing) {
  const o = stretchOptions(),
    u = project.units,
    b = result.stats.bounds;
  const a = lookups.arches.token === buildToken ? lookups.arches.value : lookup('arches');
  const hasChassis = !!project.chassis;
  const showX = !editing || editing.params.axis === 'x',
    showY = !editing || editing.params.axis === 'y';
  return `${head(editing ? 'Change stretch' : 'Stretch', 'Lengthen or shorten the body between the wheel arches, or make it wider. The arches keep their shape: they only move.')}
    ${showX ? `<div class="f">Between the arches${a?.arches.length === 2 ? `<span class="muted" style="font-weight:400;font-size:12px">The arches are ${fmtLen(a.arches[1].x - a.arches[0].x, u)} apart.</span>` : '<span class="note warn" style="font-weight:400">Anvil needs to find both wheel arches to stretch between them.</span>'}
      <div class="row">Make it ${numField('st-length', round(toUnits(o.length, u), 3), u)} longer${hasChassis && !editing ? '<button class="btn sm ghost" data-act="stretch-fill" data-v="x">Match the chassis</button>' : ''}</div>
      <div class="muted" style="font-weight:400;font-size:12px">Use a minus number to shorten. Doors and windows in between get a little longer or shorter.</div>
      <button class="btn primary sm" data-act="stretch-apply" data-v="x"${a?.arches.length === 2 ? '' : ' disabled'}>${editing ? 'Update step' : 'Stretch'}</button></div>` : ''}
    ${showX && showY ? '<div class="hr"></div>' : ''}
    ${showY ? `<div class="f">Across the car<span class="muted" style="font-weight:400;font-size:12px">The body is ${fmtLen(b.size[1], u)} wide.</span>
      <div class="row">Make it ${numField('st-width', round(toUnits(o.width, u), 3), u)} wider${hasChassis && !editing ? '<button class="btn sm ghost" data-act="stretch-fill" data-v="y">Fit the tyres</button>' : ''}</div>
      <button class="btn primary sm" data-act="stretch-apply" data-v="y">${editing ? 'Update step' : 'Widen'}</button></div>` : ''}
    ${editing ? '<button class="btn ghost sm" data-act="stop-edit">Done</button>' : ''}`;
}

function archOptions() {
  const L = result.stats.bounds.size[0];
  ui.archOpts ??= { front: true, rear: true, gap: round(Math.max(0.3, L * 0.006), 2), flare: round(L * 0.006, 2), head: round(L * 0.04, 1) };
  return ui.archOpts;
}

// The circle an arch is cut to: round the tyre, plus the gap.
function archCircle(key, gap) {
  const c = project.chassis;
  const t = c[key];
  const x = key === 'front' ? c.frontX : c.frontX + c.wheelbase;
  return { x: round(x, 3), z: round(groundZ() + t.diameter / 2, 3), r: round(t.diameter / 2 + gap, 3) };
}

function panelArches(editing) {
  const u = project.units;
  if (!project.chassis)
    return `${head('Wheel arches', 'Cut and flare the arches round the tyres of your chassis.')}<div class="note warn">Set up a chassis first: the arches are cut round its tyres.</div>
      <button class="btn sm" data-act="tool" data-v="chassis">${icon('ghost')}Chassis</button>`;
  const o = archOptions();
  if (editing)
    return `${head('Wheel arches', `This step cuts the ${editing.params.which?.join(' and ') ?? ''} arch${editing.params.which?.length > 1 ? 'es' : ''} round the tyres.`)}
      <div class="note">To cut differently, remove this step and cut again.</div><button class="btn ghost sm" data-act="stop-edit">Done</button>`;
  const pick = (k, n) => `<label class="chk"><input type="checkbox" data-act="arch-pick" data-v="${k}" ${o[k] ? 'checked' : ''}>${n}</label>`;
  return `${head('Wheel arches', 'Cut the arches round your tyres, or flare them out with the hammer.')}
    <div class="row">${pick('front', 'Front')}${pick('rear', 'Rear')}</div>
    <div class="f">Cut round the tyres<div class="row">Gap round the tyre ${numField('ar-gap', round(toUnits(o.gap, u), 3), u)}</div>
      <div class="muted" style="font-weight:400;font-size:12px">Removes the body inside a circle round each tyre, on both sides. Only makes the arches bigger, never smaller.</div>
      <button class="btn primary sm" data-act="arch-cut">${icon('arch')}Cut arches</button></div>
    <div class="hr"></div>
    <div class="f">Flare out<div class="g2"><span class="fx">How far out${numField('ar-flare', round(toUnits(o.flare, u), 3), u)}</span><span class="fx">Hammer head${numField('ar-head', round(toUnits(o.head, u), 2), u)}</span></div>
      <div class="muted" style="font-weight:400;font-size:12px">Hammers evenly along the arch edge from behind, on both sides. The blows go into the Hammer step, so you can take them back there.</div>
      <button class="btn sm" data-act="arch-flare">${icon('hammer')}Flare arches</button></div>`;
}

// ------------------------------------------------------------ posts

// One Posts step, at the end: posts are placed on the finished body and hang
// from its wall, so they come after Hollow and everything that moves the outside.
function postsStep() {
  return project.steps.find((s) => s.type === 'posts' && s.enabled) ?? null;
}

const postLib = { list: null, busy: false, error: null };
function postLibrary() {
  if (postLib.list || postLib.busy || postLib.error) return postLib.list ?? [];
  postLib.busy = true;
  library()
    .then((db) => (postLib.list = listPostTypes(db)))
    .catch((e) => (postLib.error = e.message))
    .finally(() => {
      postLib.busy = false;
      if (['posts', 'posteditor'].includes(ui.panel)) renderPanel();
    });
  return [];
}
// Ready-made types first, then your own from the library.
function postTypes() {
  return [...Object.entries(POST_TYPES).map(([id, t]) => ({ id, ...t, builtin: true })), ...postLibrary()];
}
const postTypeById = (id) => postTypes().find((t) => t.id === id) ?? { id: 'screw', ...POST_TYPES.screw, builtin: true };
const typeSizes = (t) => ({ id: t.id, name: t.name, kind: t.kind, outer: t.outer, hole: t.hole, depth: t.depth, fillet: t.fillet });

function postOptions() {
  ui.posts ??= { type: 'screw', fixed: false, length: round(result.stats.bounds.size[2] * 0.6, 0), float: 0.3, base: null };
  const s = postsStep();
  if (s && ui.postsFor !== s.id) {
    ui.postsFor = s.id;
    Object.assign(ui.posts, { type: s.params.type?.id ?? ui.posts.type, fixed: s.params.length > 0, base: s.params.base });
    if (s.params.length > 0) ui.posts.length = s.params.length;
  }
  return ui.posts;
}

// Height of the bottom of the posts: on the chassis deck plus a small gap,
// or typed in when there is no chassis.
function postBase() {
  const o = postOptions(),
    c = project.chassis;
  if (c) return round(groundZ() + c.deck + o.float, 3);
  return round(o.base ?? bodyBottom() + result.stats.bounds.size[2] * 0.15, 3);
}

function postParams(posts) {
  const o = postOptions();
  return { posts, type: typeSizes(postTypeById(o.type)), base: postBase(), length: o.fixed ? o.length : 0 };
}

function setPosts(posts) {
  commit(() => {
    const step = postsStep();
    if (!posts.length && step) project.steps = project.steps.filter((s) => s !== step);
    else if (step) step.params = postParams(posts);
    else if (posts.length) project.steps.push({ id: newId(), type: 'posts', enabled: true, params: postParams(posts) });
  });
}
const currentPosts = () => postsStep()?.params.posts ?? [];
// After a setting changed: rebuild the posts that are there with it.
const refreshPosts = () => (postsStep() ? setPosts(currentPosts()) : renderPanel());

function placePost(hit) {
  const t = postTypeById(postOptions().type);
  let [x, y] = [round(hit.point.x, 2), round(hit.point.y, 2)];
  if (Math.abs(y) < t.outer * 0.6) y = 0; // on the centre line
  const add = [{ x, y }];
  if (project.mirror && y !== 0) add.push({ x, y: -y });
  const near = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) < t.outer;
  const posts = currentPosts();
  if (add.some((p) => posts.some((q) => near(p, q)))) return toast('There is already a post there.', 'bad');
  setPosts([...posts, ...add]);
}

// The chassis's own post spots, as blue marks at the bottom of the posts.
let postMarksShown = false;
function drawPostMarks(show) {
  const c = project?.chassis;
  if (!show || !c?.posts?.length) {
    if (postMarksShown) viewport.clearOverlay();
    postMarksShown = false;
    return;
  }
  viewport.clearOverlay();
  const z = postBase();
  for (const p of chassisSpots()) viewport.marker({ x: p.x, y: p.y, z }, 0x3b9cff);
  postMarksShown = true;
}
function chassisSpots() {
  const c = project.chassis;
  return (c?.posts ?? []).flatMap((p) => {
    const x = round(c.frontX + p.along, 2);
    return p.side > 0.01 ? [{ x, y: p.side }, { x, y: -p.side }] : [{ x, y: 0 }];
  });
}

function panelPosts(editing) {
  const o = postOptions(),
    u = project.units,
    c = project.chassis;
  const step = editing ?? postsStep();
  const posts = step?.params.posts ?? [];
  const info = step && result.results.find((r) => r.id === step.id);
  const t = postTypeById(o.type);
  const hollow = project.steps.some((s) => s.type === 'hollow' && s.enabled);
  const placing = ui.pointer === 'post';
  const spots = chassisSpots();
  return `${head('Posts', 'Posts hang from the inside of the body down to the chassis. Click on the body to place one; with Mirror on, the other side gets one too.')}
    ${hollow ? '' : '<div class="muted" style="font-size:12px">Posts hang from the inside of the wall. If the body is still solid or its walls are too thick, run Shell › Hollow first.</div>'}
    <div class="f">Post type<div class="row"><select data-field="post-type">${postTypes()
      .map((x) => `<option value="${esc(x.id)}"${x.id === t.id ? ' selected' : ''}>${esc(x.name)}</option>`)
      .join('')}</select><button class="btn sm ghost" data-act="tool" data-v="posteditor">Edit</button></div>
      <span class="muted" style="font-weight:400;font-size:12px">${fmtLen(t.outer, u, 1)} round, ${t.kind === 'socket' ? 'socket' : 'hole'} ${fmtLen(t.hole, u, 1)}${t.kind === 'screw' ? `, ${fmtLen(t.depth, u, 1)} deep` : ''}</span></div>
    <div class="f">Length<span class="seg"><button data-act="post-fixed" data-v="0" class="${o.fixed ? '' : 'on'}">Automatic</button><button data-act="post-fixed" data-v="1" class="${o.fixed ? 'on' : ''}">Fixed length</button></span>
      ${o.fixed ? `<div class="row">${numField('post-length', round(toUnits(o.length, u), 2), u)}</div><span class="muted" style="font-weight:400;font-size:12px">Longer than needed. A groove marks where to cut it at the chassis.</span>` : '<span class="muted" style="font-weight:400;font-size:12px">Each post reaches exactly from the chassis to the body.</span>'}</div>
    ${c ? `<div class="f">Gap above the chassis deck<div class="row">${numField('post-float', round(toUnits(o.float, u), 2), u)}</div></div>` : `<div class="f">Bottom of the posts (height)<div class="row">${numField('post-base', round(toUnits(postBase(), u), 2), u)}</div><span class="muted" style="font-weight:400;font-size:12px">Set up a chassis and the posts stand on its deck.</span></div>`}
    ${step && Math.abs(step.params.base - postBase()) > 0.01 ? `<div class="note warn">The chassis has changed since the posts were placed.<button class="btn sm" data-act="post-follow">Follow the chassis</button></div>` : ''}
    <div class="row">${placing ? '<button class="btn sm" data-act="pointer" data-v="look">Done placing</button>' : `<button class="btn primary sm" data-act="pointer" data-v="post">${icon('post')}Place posts</button>`}
      ${spots.length ? `<button class="btn sm ghost" data-act="post-spots">Use the chassis's ${spots.length} spot${spots.length === 1 ? '' : 's'}</button>` : ''}</div>
    ${placing ? '<div class="muted" style="font-size:12px">Click on the body. The Under and Top views make it easy to place them.</div>' : ''}
    ${
      posts.length
        ? `<div class="f">${posts.length} post${posts.length === 1 ? '' : 's'}<div class="plist">${posts
            .map(
              (p, i) =>
                `<div class="prow"><span><b>Post ${i + 1}</b><small>${fmtLen(p.x - (c ? c.frontX : result.stats.bounds.min[0]), u, 1)} behind the ${c ? 'front axle' : 'nose'} · ${p.y === 0 ? 'centre' : `${fmtLen(Math.abs(p.y), u, 1)} ${p.y > 0 ? 'right' : 'left'}`}</small></span><button class="btn sm icon ghost" data-act="post-remove" data-v="${i}" title="Remove this post">${icon('trash')}</button></div>`,
            )
            .join('')}</div></div>
      <div class="row"><button class="btn sm ghost danger" data-act="post-clear">Remove all</button>${c ? '<button class="btn sm ghost" data-act="post-save-spots">Keep these spots with the chassis</button>' : ''}</div>`
        : ''
    }
    ${(info?.info?.warnings ?? []).map((w) => `<div class="note warn">${esc(w)}</div>`).join('')}
    ${info?.state === 'error' ? `<div class="note bad">${esc(info.error)}</div>` : ''}`;
}

function postDraft() {
  if (!ui.postDraft) {
    const t = postTypeById(postOptions().type);
    ui.postDraft = { ...typeSizes(t), id: t.builtin ? null : t.id, name: t.builtin ? `My ${t.name}` : t.name };
  }
  ui.postTest ??= { wall: PRINT_WALLS[project.print?.process ?? 'resin'].wall, length: 12 };
  return ui.postDraft;
}

function panelPostEditor() {
  const d = postDraft(),
    u = project.units;
  const wall = (d.outer - d.hole) / 2;
  const f = (k, label) => `<span class="fx">${label}${numField(`pe-${k}`, round(toUnits(d[k], u), 2), u)}</span>`;
  return `${head('Post editor', 'Make your own post type and keep it in your library: sized for your screws, brass tube or inserts.')}
    <div class="f">Start from<select data-field="pe-from"><option value="">…</option>${postTypes()
      .map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`)
      .join('')}</select></div>
    <div class="f">Name<span class="num" style="width:100%"><input data-field="pe-name" type="text" value="${esc(d.name)}" style="font-family:var(--font-ui)"></span></div>
    <span class="seg"><button data-act="pe-kind" data-v="screw" class="${d.kind === 'screw' ? 'on' : ''}">Screw hole</button><button data-act="pe-kind" data-v="socket" class="${d.kind === 'socket' ? 'on' : ''}">Socket (tube, insert)</button></span>
    <div class="g2">${f('outer', 'Post diameter')}${f('hole', d.kind === 'socket' ? 'Socket diameter' : 'Hole diameter')}${d.kind === 'screw' ? f('depth', 'Hole depth') : ''}${f('fillet', 'Flare at the top')}</div>
    <div class="note${wall < 0.8 ? ' warn' : ''}">Post wall round the hole: ${fmtLen(wall, u)}${wall < 0.8 ? '. Thin: it may split when the screw goes in.' : ''}</div>
    <div class="row"><button class="btn sm primary" data-act="pe-save">${icon('save')}${d.id ? 'Update in library' : 'Save to library'}</button>${d.id ? '<button class="btn sm ghost" data-act="pe-save-new">Save as new</button><button class="btn sm ghost danger" data-act="pe-delete">Delete</button>' : ''}</div>
    <div class="hr"></div>
    <div class="f">Print a test first<span class="muted" style="font-weight:400;font-size:12px">A fit test piece is one post under a small square of wall: print it upside down and try your screw or tube. Each test piece is exported on its own, never with the body.</span>
      <div class="g2"><span class="fx">Wall${numField('pt-wall', round(toUnits(ui.postTest.wall, u), 2), u)}</span><span class="fx">Post length${numField('pt-length', round(toUnits(ui.postTest.length, u), 2), u)}</span></div>
      <div class="row"><button class="btn sm" data-act="pe-fit">${icon('export')}Fit test piece</button><button class="btn sm ghost" data-act="pe-loose">${icon('export')}Loose post</button></div></div>`;
}

// ------------------------------------------------------------ windows

// One Windows step, after Hollow (the cut goes through the finished wall)
// and before the posts.
function windowsStep() {
  return project.steps.find((s) => s.type === 'windows' && s.enabled) ?? null;
}
const allWindows = () => windowsStep()?.params.windows ?? [];
function hollowWall() {
  const h = project.steps.find((s) => s.type === 'hollow' && s.enabled);
  return h ? Math.max(h.params.wall, Number.isFinite(h.params.top) ? h.params.top : 0) : null;
}
// How deep the cut reaches behind the outline: through the wall with room to spare.
const cutDepth = () => round(Math.max(2.5, 2 * (hollowWall() ?? 1.5) + 1), 2);

function setWindows(windows) {
  commit(() => {
    let step = windowsStep();
    if (!windows.length && step) return (project.steps = project.steps.filter((s) => s !== step));
    if (!step) {
      step = { id: newId(), type: 'windows', enabled: true, params: {} };
      const at = project.steps.findIndex((s) => s.type === 'posts');
      if (at < 0) project.steps.push(step);
      else project.steps.splice(at, 0, step);
    }
    step.params = { windows, depth: step.params.depth ?? cutDepth() };
  });
}

function windowName(normal) {
  const [x, y, z] = normal;
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  const base = ay >= ax && ay >= az ? 'Side window' : az >= ax ? (x < 0 ? 'Windscreen' : 'Rear window') : x < 0 ? 'Windscreen' : 'Rear window';
  const taken = new Set(allWindows().map((w) => w.name));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
}
const meanNormal = (ns) => {
  const s = ns.reduce((a, n) => [a[0] + n[0], a[1] + n[1], a[2] + n[2]], [0, 0, 0]);
  const l = Math.hypot(...s) || 1;
  return s.map((v) => round(v / l, 4));
};

// The window being worked on (the draft, or a copy of the one being changed).
function activeWindow() {
  if (ui.win.draft) return ui.win.draft;
  return ui.win.editing ? allWindows().find((w) => w.id === ui.win.editing) ?? null : null;
}

let windowsShown = false;
function drawWindows(show) {
  if (!show || !result) {
    if (windowsShown) viewport.curves(null);
    windowsShown = false;
    return;
  }
  const act = activeWindow();
  const list = [];
  for (const o of windowOutlines(allWindows(), 0.4)) {
    if (act && o.window.id === act.id && !o.mirrored) continue;
    list.push({ points: o.points, closed: true, color: o.window.open !== false ? 0xf2b705 : 0x6fb6ff });
  }
  if (act) {
    const pts = act.points.length >= 3 && !ui.win.draft ? sampleClosedCurve(act.points, act.corners, 0.4) : act.points;
    list.push({ points: pts, closed: !ui.win.draft, color: 0xffffff, active: true, handles: act.points, corners: act.corners, first: !!ui.win.draft });
  }
  viewport.curves(list);
  windowsShown = true;
}

function panelWindows(editing) {
  const u = project.units;
  const step = editing ?? windowsStep();
  const wins = step?.params.windows ?? [];
  const info = step && result.results.find((r) => r.id === step.id);
  const hollow = project.steps.some((s) => s.type === 'hollow' && s.enabled);
  const pillars = pillarWarnings(wins);
  const d = ui.win.draft;
  const drawing = ui.pointer === 'line';
  let tool = '';
  if (d)
    tool = `<div class="note">Click points round the window on the body; the line runs smoothly through them. Click the green first point (or Enter) to close it.<br><span class="muted">Ctrl-click a point for a sharp corner · drag a point to move it · Backspace takes the last one back · Esc stops.</span></div>
      <div class="row"><button class="btn primary sm" data-act="win-finish"${d.points.length >= 3 ? '' : ' disabled'}>Close the outline</button><button class="btn sm ghost" data-act="win-cancel">Cancel</button><span class="muted" style="font-size:12px">${d.points.length} point${d.points.length === 1 ? '' : 's'}</span></div>`;
  else if (ui.win.editing && activeWindow())
    tool = `<div class="note">Changing <b>${esc(activeWindow().name)}</b>: drag a point to move it, Shift-click on the body to add one, Ctrl-click a point for a corner, Alt-click to remove it.</div>
      <div class="row"><button class="btn sm" data-act="win-done">Done</button></div>`;
  else
    tool = `<div class="row"><button class="btn primary sm" data-act="win-new">${icon('line')}Draw a window</button></div>
      <div class="muted" style="font-size:12px">Draw on the outside of the body. The side and front views make it easy; with Mirror on, side windows get their twin on the other side.</div>`;
  const rows = wins
    .map(
      (w) => `<div class="prow${ui.win.editing === w.id ? ' cur' : ''}"><span><b>${esc(w.name)}</b><small>${w.points.length} points${w.mirror ? ' · both sides' : ''}</small></span>
        <span class="seg"><button data-act="win-state" data-v="${w.id}|open" class="${w.open !== false ? 'on' : ''}">Open</button><button data-act="win-state" data-v="${w.id}|solid" class="${w.open === false ? 'on' : ''}">Solid</button></span>
        <button class="btn sm icon ghost" data-act="win-mirror" data-v="${w.id}" title="${w.mirror ? 'Only this side' : 'Both sides'}">${icon('mirror')}</button>
        <button class="btn sm icon ghost" data-act="win-edit" data-v="${w.id}" title="Change the outline">${icon('line')}</button>
        <button class="btn sm icon ghost" data-act="win-delete" data-v="${w.id}" title="Remove this window">${icon('trash')}</button></div>`,
    )
    .join('');
  return `${head('Windows', 'Each window is an outline on the body. Open windows are cut through the wall; solid ones stay closed and only mark the window on the buck.')}
    ${hollow ? '' : '<div class="muted" style="font-size:12px">Open windows cut through a shell wall. If the body is still solid, run Shell › Hollow first.</div>'}
    ${tool}
    ${wins.length ? `<div class="f">${wins.length} window${wins.length === 1 ? '' : 's'}<div class="plist">${rows}</div></div>` : ''}
    ${step ? `<div class="f">Cut reaches behind the outline<div class="row">${numField('win-depth', round(toUnits(step.params.depth ?? cutDepth(), u), 2), u)}</div><span class="muted" style="font-weight:400;font-size:12px">More than the wall, not as far as the other side of the car.</span></div>` : ''}
    ${pillars.map((p) => `<div class="note warn">${esc(p.text)}: the pillar will be very thin.</div>`).join('')}
    ${(info?.info?.warnings ?? []).map((w) => `<div class="note warn">${esc(w)}</div>`).join('')}
    ${drawing || d ? '' : ''}`;
}

// The line tool on the body.
const HANDLE_PX = 9;
function handleAt(e) {
  const w = activeWindow();
  if (!w) return -1;
  let best = -1, bd = HANDLE_PX;
  w.points.forEach((p, i) => {
    const s = viewport.screenOf(p);
    const d = Math.hypot(s.x - e.clientX, s.y - e.clientY);
    if (!s.behind && d < bd) (bd = d), (best = i);
  });
  return best;
}
// Changing a window that is already in the step: work on a copy, then save it.
function editedCopy() {
  const w = activeWindow();
  return w && { ...w, points: w.points.map((p) => p.slice()), corners: [...(w.corners ?? w.points.map(() => false))], normals: (w.normals ?? w.points.map(() => w.normal)).map((n) => n.slice()) };
}
function saveEdited(w) {
  w.normal = meanNormal(w.normals);
  if (ui.win.draft) {
    ui.win.draft = w;
    renderPanel();
    return;
  }
  setWindows(allWindows().map((x) => (x.id === w.id ? w : x)));
}
function lineDown(e) {
  const h = handleAt(e);
  if (h >= 0 && !e.ctrlKey && !e.altKey) {
    ui.win.drag = { index: h, copy: editedCopy(), moved: false, x: e.clientX, y: e.clientY };
    return true;
  }
  return false;
}
function lineMove(e) {
  const d = ui.win.drag;
  if (!d || (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4)) return;
  const hit = viewport.pick(e);
  if (!hit) return;
  d.moved = true;
  d.copy.points[d.index] = hit.point.toArray().map((x) => round(x, 3));
  d.copy.normals[d.index] = hit.normal.toArray().map((x) => round(x, 4));
  // Show the move straight away; the cut follows when the mouse is let go.
  const save = ui.win.draft;
  if (save) ui.win.draft = d.copy;
  const list = [{ points: d.copy.points.length >= 3 && !save ? sampleClosedCurve(d.copy.points, d.copy.corners, 0.4) : d.copy.points, closed: !save, color: 0xffffff, active: true, handles: d.copy.points, corners: d.copy.corners, first: !!save }];
  viewport.curves(list);
}
function lineUp(e) {
  const d = ui.win.drag;
  ui.win.drag = null;
  // A point that was dragged; a point only clicked counts as a click.
  if (d?.moved) return saveEdited(d.copy);
  const h = handleAt(e);
  const w = editedCopy();
  if (ui.win.draft) {
    if (h === 0 && w.points.length >= 3 && !e.ctrlKey) return actions['win-finish']();
    if (h >= 0 && e.ctrlKey) {
      w.corners[h] = !w.corners[h];
      return saveEdited(w);
    }
    const hit = viewport.pick(e);
    if (!hit) return;
    w.points.push(hit.point.toArray().map((x) => round(x, 3)));
    w.corners.push(false);
    w.normals.push(hit.normal.toArray().map((x) => round(x, 4)));
    return saveEdited(w);
  }
  if (!w) return;
  if (h >= 0 && e.altKey) {
    if (w.points.length <= 3) return toast('A window needs at least three points.', 'bad');
    w.points.splice(h, 1);
    w.corners.splice(h, 1);
    w.normals.splice(h, 1);
    return saveEdited(w);
  }
  if (h >= 0 && e.ctrlKey) {
    w.corners[h] = !w.corners[h];
    return saveEdited(w);
  }
  if (e.shiftKey) {
    const hit = viewport.pick(e);
    if (!hit) return;
    const p = hit.point.toArray().map((x) => round(x, 3));
    // In the side whose middle is nearest.
    let best = 0, bd = Infinity;
    for (let i = 0; i < w.points.length; i++) {
      const a = w.points[i], b = w.points[(i + 1) % w.points.length];
      const dd = Math.hypot((a[0] + b[0]) / 2 - p[0], (a[1] + b[1]) / 2 - p[1], (a[2] + b[2]) / 2 - p[2]);
      if (dd < bd) (bd = dd), (best = i);
    }
    w.points.splice(best + 1, 0, p);
    w.corners.splice(best + 1, 0, false);
    w.normals.splice(best + 1, 0, hit.normal.toArray().map((x) => round(x, 4)));
    saveEdited(w);
  }
}

// ------------------------------------------------------------ buck

function buckSettings() {
  const s = { ...BUCK_DEFAULTS, ...(project.buck ?? {}) };
  s.wall ??= hollowWall() ?? 1;
  if (!Number.isFinite(s.trimFront) || !Number.isFinite(s.trimRear)) {
    // Default trim line: the glue margin below the lowest window, front and
    // back, measured on the buck (which sits wall + sheet + allowance further in).
    const b = result.stats.bounds;
    const mid = b.min[0] + b.size[0] / 2;
    const pts = windowOutlines(allWindows(), 1).flatMap((o) => o.points);
    const low = (front) => {
      const zs = pts.filter((p) => (p[0] < mid) === front).map((p) => p[2]);
      return zs.length ? Math.min(...zs) - s.margin - (s.wall + s.sheet + s.allowance) - 0.5 : b.min[2] + b.size[2] * 0.55;
    };
    s.trimFront = round(Number.isFinite(s.trimFront) ? s.trimFront : low(true), 2);
    s.trimRear = round(Number.isFinite(s.trimRear) ? s.trimRear : low(false), 2);
  }
  if (!Number.isFinite(s.cabinFrom) || !Number.isFinite(s.cabinTo)) {
    // Default cabin: the windows, plus room for the glue margin; else the middle of the car.
    const b = result.stats.bounds;
    const xs = windowOutlines(allWindows(), 1).flatMap((o) => o.points.map((p) => p[0]));
    const nose = b.min[0];
    s.cabinFrom ??= round((xs.length ? Math.min(...xs) - s.margin - 2 : nose + b.size[0] * 0.25) - nose, 1);
    s.cabinTo ??= round((xs.length ? Math.max(...xs) + s.margin + 2 : nose + b.size[0] * 0.8) - nose, 1);
  }
  return s;
}
function setBuckSetting(key, value) {
  commit(() => (project.buck = { ...buckSettings(), [key]: value }), false);
}

// The last buck made: kept until the body or the settings change.
const buck = { result: null, key: null, busy: false, error: null };
const buckKey = () => JSON.stringify([buildToken, buckSettings()]);
async function makeBuckNow() {
  const s = buckSettings();
  buck.busy = true;
  buck.error = null;
  renderPanel();
  try {
    const nose = result.stats.bounds.min[0];
    const opts = { wall: s.wall, sheet: s.sheet, allowance: s.allowance, margin: s.margin, skirt: s.skirt, plinth: s.plinth, draft: s.draft, guide: s.guide };
    opts.trim = { front: s.trimFront, rear: s.trimRear };
    opts.cabin = { from: nose + s.cabinFrom, to: nose + s.cabinTo };
    const out = await call('buck', { opts });
    buck.result = out;
    buck.key = buckKey();
  } catch (e) {
    buck.error = e.message;
    buck.result = null;
  }
  buck.busy = false;
  renderPanel();
}

let buckMarks = false,
  buckShown = null;
function drawBuck(show) {
  const r = (show && buck.result) || null;
  if (r !== buckShown) viewport.setBuck(r ? { positions: r.positions, indices: r.indices } : null);
  buckShown = r;
  if (show && result) {
    viewport.clearOverlay();
    // The trim line, front to back, on both sides of the body.
    const s = buckSettings(), b = result.stats.bounds;
    for (const y of [b.min[1], b.max[1]]) viewport.segment({ x: b.min[0], y, z: s.trimFront }, { x: b.max[0], y, z: s.trimRear }, 0x3ddc84);
    // The ends of the cabin, across the car.
    const zAt = (x) => s.trimFront + ((s.trimRear - s.trimFront) * (x - b.min[0])) / b.size[0];
    for (const x of [b.min[0] + s.cabinFrom, b.min[0] + s.cabinTo])
      viewport.segment({ x, y: b.min[1], z: zAt(x) }, { x, y: b.max[1], z: zAt(x) }, 0x3ddc84);
    if (r) {
      for (const p of r.info.changed) viewport.marker({ x: p[0], y: p[1], z: p[2] }, 0xe5484d);
      for (const p of r.info.short) viewport.marker({ x: p[0], y: p[1], z: p[2] }, 0xf2b705);
    }
    buckMarks = true;
  } else if (buckMarks) {
    viewport.clearOverlay();
    buckMarks = false;
  }
}

function panelBuck() {
  const s = buckSettings(),
    u = project.units;
  const r = buck.result,
    stale = r && buck.key !== buckKey();
  const f = (k, label, digits = 2) => `<span class="fx">${label}${numField(`bk-${k}`, round(toUnits(s[k], u), digits), u)}</span>`;
  const wins = allWindows();
  return `${head('Window buck', 'One plug for the whole cabin: vac-form clear sheet over it and glue the insert in from the inside. Made from the body before its windows are cut.')}
    ${wins.length ? '' : '<div class="muted" style="font-size:12px">Draw the windows first (Windows menu): their outlines become raised guide lines on the buck, and the trim line follows them.</div>'}
    <div class="f">Trim line (green on the car)<div class="g2">${f('trimFront', 'Height at the front')}${f('trimRear', 'Height at the back')}</div>
      <span class="muted" style="font-weight:400;font-size:12px">The formed sheet is cut off here. It should run at least the glue margin below every window.</span></div>
    <div class="f">Cabin, measured from the nose<div class="g2">${f('cabinFrom', 'From', 1)}${f('cabinTo', 'To', 1)}</div>
      <span class="muted" style="font-weight:400;font-size:12px">Keeps the bonnet and boot off the buck when they stand above the trim line.</span></div>
    <div class="g2">${f('margin', 'Glue margin', 1)}${f('wall', 'Body wall')}${f('sheet', 'Sheet thickness')}${f('allowance', 'Fit allowance')}${f('skirt', 'Skirt below the trim', 1)}${f('plinth', 'Plinth', 1)}
      <span class="fx">Draft${numField('bk-draft', s.draft, '°')}</span>${f('guide', 'Guide line height')}</div>
    <div class="row"><button class="btn primary sm" data-act="buck-make"${buck.busy ? ' disabled' : ''}>${icon('buck')}${buck.busy ? 'Making the buck…' : r ? 'Make it again' : 'Make the buck'}</button>
      ${r && !stale ? `<button class="btn sm" data-act="buck-export">${icon('export')}Export buck STL</button>` : ''}</div>
    ${buck.error ? `<div class="note bad">${esc(buck.error)}</div>` : ''}
    ${stale ? '<div class="note warn">The body or the settings changed since this buck was made. Make it again before exporting.</div>' : ''}
    ${
      r
        ? `<div class="note">${fmtLen(r.info.size[0], u, 1)} × ${fmtLen(r.info.size[1], u, 1)} × ${fmtLen(r.info.size[2], u, 1)} · ${r.info.triangles.toLocaleString()} triangles · ${r.info.guides} guide line${r.info.guides === 1 ? '' : 's'}<br>
            <span class="muted">Surface ${fmtLen(r.info.offset, u)} inside the body (wall + sheet + allowance).</span></div>
          ${r.info.changedCount ? `<div class="note warn">The sheet could not come off as the body is shaped in ${r.info.changed.length} place${r.info.changed.length === 1 ? '' : 's'} (red on the car): the buck is filled there, by up to ${fmtLen(r.info.changedMost, u)}. Expect a small gap between the insert and the wall there; usually the shoulder below the windows or a lip round the glass.</div>` : '<div class="note">The sheet comes off everywhere without changing the shape.</div>'}
          ${r.info.warnings.map((w) => `<div class="note warn">${esc(w)}</div>`).join('')}
          <div class="muted" style="font-size:12px">Print the buck solid, in fine layers, and smooth it: layer lines show through the formed sheet.</div>`
        : ''
    }`;
}

// ------------------------------------------------------------ smooth

function smoothOptions() {
  const diag = Math.hypot(...result.stats.bounds.size);
  ui.smooth ??= { radius: round(diag * 0.03, 1), strength: 3, keepEdges: true };
  return ui.smooth;
}
// Brush strokes go into the last step when it is a Smooth step with the
// same settings; otherwise a new one is added at the end.
function addSmooth({ strokes = [], faces = null }) {
  const o = smoothOptions();
  const params = { strength: o.strength, keepEdges: o.keepEdges, protect: protectActive() };
  commit(() => {
    const last = project.steps.at(-1);
    const same = last?.type === 'smooth' && last.enabled && !last.params.faces && !faces && ['strength', 'keepEdges', 'protect'].every((k) => last.params[k] === params[k]);
    if (same) last.params = { ...last.params, strokes: [...last.params.strokes, ...strokes] };
    else project.steps.push({ id: newId(), type: 'smooth', enabled: true, params: { ...params, strokes, faces } });
  });
}
function smoothAt(e, hit = viewport.pick(e)) {
  if (!hit || !drag) return;
  const r = smoothOptions().radius;
  const last = drag.strokes.at(-1);
  const at = hit.point.toArray().map((x) => round(x, 3));
  if (last && Math.hypot(...last.at.map((x, k) => x - at[k])) < r * 0.4) return;
  drag.strokes.push({ at, radius: r });
  if (project.mirror && Math.abs(at[1]) > r * 0.25) drag.strokes.push({ at: [at[0], -at[1], at[2]], radius: r });
  viewport.marker(hit.point, 0x3b9cff);
}

function panelSmooth(editing) {
  const o = smoothOptions(),
    u = project.units;
  const diag = Math.hypot(...result.stats.bounds.size);
  const brushing = ui.pointer === 'smooth';
  if (editing)
    return `${head('Smooth', `This step smooths ${editing.params.faces ? `${runCount(editing.params.faces).toLocaleString()} selected triangles` : `${editing.params.strokes.length} brush spots`}, strength ${editing.params.strength}${editing.params.keepEdges ? ', sharp edges kept' : ''}${editing.params.protect ? ', outside protected' : ''}.`)}
      <div class="note">To smooth differently, switch it off or remove it and smooth again.</div><button class="btn ghost sm" data-act="stop-edit">Done</button>`;
  return `${head('Smooth', 'Brush over the body to smooth it, or smooth what you selected. Sharp edges stay unless you untick that.')}
    <div class="f">Brush size<div class="row"><input type="range" data-field="smooth-radius" min="${round(diag * 0.005, 1)}" max="${round(diag * 0.15, 1)}" step="0.5" value="${o.radius}"><span class="mono" id="smooth-radius-val">${fmtLen(o.radius, u, 1)}</span></div></div>
    <div class="f">Strength<div class="row"><input type="range" data-field="smooth-strength" min="1" max="10" step="1" value="${o.strength}"><span class="mono" id="smooth-strength-val">${o.strength}</span></div></div>
    <label class="chk"><input type="checkbox" data-field="smooth-edges" ${o.keepEdges ? 'checked' : ''}>Keep sharp edges (creases and panel lines)</label>
    ${protectActive() ? '<div class="muted" style="font-size:12px">Protect the outside is on: only the inside of the wall is smoothed.</div>' : ''}
    <div class="row">${brushing ? '<button class="btn sm" data-act="pointer" data-v="look">Put the brush down</button>' : `<button class="btn primary sm" data-act="pointer" data-v="smooth">${icon('smooth')}Pick up the brush</button>`}
      <button class="btn sm" data-act="smooth-sel"${selectedCount ? '' : ' disabled'}>Smooth the selection (${selectedCount.toLocaleString()})</button></div>
    <div class="muted" style="font-size:12px">Each stroke rebuilds the body. Smoothing comes after everything else, so it works on the body as you see it.</div>`;
}

// ------------------------------------------------------------ add a part

const partMeshes = new Map(); // id → mesh read from the file (for showing and exporting)
function partMesh(id) {
  if (!partMeshes.has(id)) {
    const f = project.parts?.[id];
    partMeshes.set(id, f ? readSTLMesh(f.bytes) : null);
  }
  return partMeshes.get(id);
}
const partSteps = () => project.steps.filter((s) => s.type === 'addpart');

async function loadPart(file, name, bytes, place) {
  const id = newId();
  const mesh = readSTLMesh(bytes);
  partMeshes.set(id, mesh);
  const b = result.stats.bounds;
  const pb = bounds(mesh.positions);
  // Put it on top of the body, in the middle, at its own size.
  place ??= { x: round((b.min[0] + b.max[0]) / 2, 2), y: 0, z: round(b.max[2], 2), rx: 0, ry: 0, rz: 0, scale: 1, pair: false };
  project.parts = { ...(project.parts ?? {}), [id]: { fileName: file, bytes } };
  commit(() => project.steps.push({ id: newId(), type: 'addpart', enabled: true, params: { part: id, name, place, join: true } }));
  const size = pb.size.map((v) => fmtLen(v, project.units, 1)).join(' × ');
  toast(`${name} added (${size}). Put it in place with the numbers.`);
}

let partsShown = null;
function drawSeparateParts() {
  if (!result) return;
  const meshes = [];
  for (const s of partSteps()) {
    if (!s.enabled || s.params.join) continue;
    const m = partMesh(s.params.part);
    if (m) meshes.push(...partPieces(m, s.params.place));
  }
  const key = JSON.stringify(partSteps().map((s) => [s.enabled, s.params]));
  if (key === partsShown) return;
  partsShown = key;
  if (!meshes.length) return viewport.setExtras(null);
  let pos = [], idx = [];
  for (const m of meshes) {
    const off = pos.length / 3;
    pos = pos.concat(Array.from(m.positions));
    for (const v of m.indices) idx.push(v + off);
  }
  viewport.setExtras({ positions: Float32Array.from(pos), indices: Uint32Array.from(idx) });
}

const partLib = { list: null, busy: false, error: null };
function partLibrary() {
  if (partLib.list || partLib.busy || partLib.error) return partLib.list ?? [];
  partLib.busy = true;
  library()
    .then((db) => (partLib.list = listParts(db)))
    .catch((e) => (partLib.error = e.message))
    .finally(() => {
      partLib.busy = false;
      if (ui.panel === 'addpart') renderPanel();
    });
  return [];
}

function panelAddPart(editing) {
  const u = project.units;
  const steps = editing ? [editing] : partSteps();
  const nose = result.stats.bounds.min[0];
  const lib = partLibrary();
  const field = (s, k, label, unit = u, value = s.params.place[k] ?? 0) =>
    `<span class="fx">${label}<span class="num"><input data-field="ap-${s.id}-${k}" type="number" step="any" value="${round(unit === u ? toUnits(value, u) : value, 3)}"><small>${unit}</small></span></span>`;
  const cards = steps
    .map((s) => {
      const p = s.params.place;
      const info = result.results.find((r) => r.id === s.id);
      return `<div class="pair"><div class="ph">${icon('plus')}<b>${esc(s.params.name)}</b>${s.enabled ? '' : '<span class="lock">off</span>'}</div>
        <span class="seg"><button data-act="ap-join" data-v="${s.id}|1" class="${s.params.join ? 'on' : ''}">Joined to the body</button><button data-act="ap-join" data-v="${s.id}|0" class="${s.params.join ? '' : 'on'}">Its own print</button></span>
        <div class="g3">${field(s, 'x', 'Along (from the nose)', u, p.x - nose)}${field(s, 'y', 'Across')}${field(s, 'z', 'Height')}</div>
        <div class="g3">${field(s, 'rz', 'Turn (top view)', '°')}${field(s, 'ry', 'Tilt (side view)', '°')}${field(s, 'rx', 'Roll (front view)', '°')}</div>
        <div class="g3">${field(s, 'scale', 'Size ×', '×', p.scale ?? 1)}</div>
        <label class="chk"><input type="checkbox" data-field="ap-${s.id}-pair" ${p.pair ? 'checked' : ''}>A pair, mirrored on the other side (mirrors, scoops)</label>
        ${info?.state === 'error' ? `<div class="note bad">${esc(info.error)}</div>` : ''}
        <div class="row">${s.params.join ? '' : `<button class="btn sm" data-act="ap-export" data-v="${s.id}">${icon('export')}Export this part</button>`}
          <button class="btn sm ghost" data-act="ap-save" data-v="${s.id}">${icon('save')}Keep in library</button>
          <button class="btn sm icon ghost" data-act="remove-step" data-v="${s.id}" title="Remove this part">${icon('trash')}</button></div></div>`;
    })
    .join('');
  return `${head('Add a part', 'Load a wing, scoop, mirror or driver from an STL, put it in place, then join it to the body or keep it as its own print.')}
    <div class="row"><button class="btn primary sm" data-act="ap-load">${icon('open')}Load a part (STL)</button></div>
    ${cards}
    ${steps.length ? '<div class="muted" style="font-size:12px">A joined part overlaps the body as its own piece; the slicer joins them when it prints. A part of its own shows see-through and is exported on its own.</div>' : ''}
    ${lib.length ? `<div class="f">Your parts<div class="plist">${lib.map((r) => `<div class="prow"><span><b>${esc(r.name)}</b><small>${esc(r.stlName)}</small></span><button class="btn sm" data-act="ap-lib-use" data-v="${r.id}">Use</button><button class="btn sm icon ghost" data-act="ap-lib-delete" data-v="${r.id}" title="Remove from the library">${icon('trash')}</button></div>`).join('')}</div></div>` : ''}`;
}

// ------------------------------------------------------------ final check

// Centre of the solid (its weight centre), from the closed body.
function centreOfMass() {
  const p = result.positions, t = result.indices;
  let V = 0;
  const c = [0, 0, 0];
  for (let f = 0; f < t.length; f += 3) {
    const a = t[f] * 3, b = t[f + 1] * 3, d = t[f + 2] * 3;
    const v = (p[a] * (p[b + 1] * p[d + 2] - p[b + 2] * p[d + 1]) - p[a + 1] * (p[b] * p[d + 2] - p[b + 2] * p[d]) + p[a + 2] * (p[b] * p[d + 1] - p[b + 1] * p[d])) / 6;
    V += v;
    for (let k = 0; k < 3; k++) c[k] += (v * (p[a + k] + p[b + k] + p[d + k])) / 4;
  }
  return V ? c.map((x) => x / V) : null;
}

function panelFinal() {
  const u = project.units,
    s = result.stats,
    pr = printOf();
  const rows = [];
  const row = (state, title, text, tool, label = 'Fix') => rows.push({ state, title, text, tool, label });
  // Printable
  const postInfo = postsStep() && result.results.find((r) => r.id === postsStep().id)?.info;
  const joinedPieces = partSteps().reduce((n, x) => n + (x.enabled && x.params.join ? (x.params.place.pair ? 2 : 1) : 0), 0);
  const loose = s.parts - (postInfo?.made ?? 0) - joinedPieces;
  if (s.faultyEdges) row('bad', 'Closed solid', `${s.faultyEdges.toLocaleString()} faulty edges: the slicer may print it wrong.`, 'fix');
  else if (s.openEdges) row('warn', 'Closed solid', `${s.openEdges.toLocaleString()} open edges. Close them, or check the slicer is happy.`, 'openings');
  else row('ok', 'Closed solid', 'No open or faulty edges.');
  if (loose > 1) row('warn', 'Loose pieces', `${loose} pieces besides posts and parts: specks or broken bits?`, 'parts', 'Look');
  const hollow = project.steps.some((x) => x.type === 'hollow' && x.enabled);
  const w = wallStats();
  const min = PRINT_WALLS[pr.process].min;
  if (!hollow) row('warn', 'Wall', 'The body is not hollowed: it will be heavy. Shell › Hollow.', 'hollow', 'Hollow');
  else if (!w) {
    lookup('thickness');
    row('wait', 'Wall', 'Measuring the wall…');
  } else if (w.thin < min) row('warn', 'Wall', `The thinnest 2% is ${fmtLen(w.thin, u)}, under the ${fmtLen(min, u)} that ${pr.process === 'fdm' ? 'FDM' : 'resin'} prints well. Thickness shows where.`, 'paint', 'Show me');
  else row('ok', 'Wall', `${fmtLen(w.median, u)}, thinnest ${fmtLen(w.thin, u)}.`);
  // Fit
  const c = project.chassis;
  if (!c) row('warn', 'Chassis fit', 'No chassis set, so the fit is not checked.', 'chassis', 'Set up');
  else {
    const a = lookup('arches');
    if (!a) row('wait', 'Chassis fit', 'Checking…');
    else {
      const r = fitReport(c, a);
      if (r.problems.length) row('bad', 'Chassis fit', `${r.problems.map((p) => ({ wheelbase: 'wheelbase', 'front-wide': 'front tyres stick out', 'rear-wide': 'rear tyres stick out', 'front-tall': 'front tyres too tall', 'rear-tall': 'rear tyres too tall' })[p] ?? p).join(', ')}.`, 'chassis');
      else row('ok', 'Chassis fit', `${esc(c.name)}: arches and tyres line up.`);
    }
    row(c.clearance >= 0.5 ? 'ok' : 'warn', 'Ground clearance', `The body is ${fmtLen(c.clearance, u)} above the track.`, 'chassis', 'Change');
  }
  const ps = postsStep();
  if (!ps) row(c ? 'warn' : 'info', 'Posts', 'No body posts yet.', 'posts', 'Add posts');
  else if (postInfo?.warnings?.length) row('warn', 'Posts', postInfo.warnings.join('; '), 'posts', 'Look');
  else row('ok', 'Posts', `${ps.params.posts.length} × ${esc(ps.params.type?.name ?? 'post')}.`);
  // Glazing
  const win = windowsStep();
  const winInfo = win && result.results.find((r) => r.id === win.id)?.info;
  if (win) {
    const pill = pillarWarnings(allWindows());
    const warns = [...(winInfo?.warnings ?? []), ...pill.map((p) => p.text)];
    row(warns.length ? 'warn' : 'ok', 'Windows', warns.length ? warns.join('; ') : `${allWindows().length} window${allWindows().length === 1 ? '' : 's'}, ${winInfo?.cut ?? 0} cut cleanly.`, 'windows', 'Look');
    const bk = buck.result;
    if (!bk) row('warn', 'Glazing buck', 'Not made yet.', 'buck', 'Make it');
    else if (buck.key !== buckKey()) row('warn', 'Glazing buck', 'Made before the last change: make it again.', 'buck', 'Make it');
    else if (bk.info.warnings.length) row('warn', 'Glazing buck', bk.info.warnings.join('; '), 'buck', 'Look');
    else row('ok', 'Glazing buck', `Ready, glue margin ${fmtLen(buckSettings().margin, u, 1)} everywhere.`);
  } else row('info', 'Windows', 'No windows drawn: a solid body to paint.', 'windows', 'Draw');
  // Weight and balance
  if (s.volume) {
    const g = (s.volume / 1000) * MATERIALS[pr.material].density;
    const cg = centreOfMass();
    let where = '';
    if (cg && c) {
      const share = ((cg[0] - c.frontX) / c.wheelbase) * 100;
      where = ` Centre of weight ${Math.round(share)}% of the way from the front axle to the rear, ${fmtLen(cg[2] - groundZ(), u, 1)} above the track.`;
    } else if (cg) where = ` Centre of weight ${fmtLen(cg[0] - result.stats.bounds.min[0], u, 1)} behind the nose.`;
    row('info', 'Weight', `${g.toFixed(1)} g in ${MATERIALS[pr.material].name}.${where}`);
  } else row('warn', 'Weight', 'Needs a closed body to work out.', 'openings', 'Close');
  const bad = rows.filter((r) => r.state === 'bad').length, warn = rows.filter((r) => r.state === 'warn').length;
  return `${head('Final check', bad ? `${bad} thing${bad === 1 ? '' : 's'} to fix before printing${warn ? `, ${warn} to look at` : ''}.` : warn ? `Printable. ${warn} thing${warn === 1 ? '' : 's'} worth a look.` : 'Everything checks out. Ready to export.')}
    <div class="plist">${rows
      .map(
        (r) => `<div class="prow fc-${r.state}"><span class="dot ${r.state === 'ok' ? 'ok' : r.state === 'bad' ? 'bad' : r.state === 'warn' ? 'w' : 'no'}"></span><span><b>${r.title}</b><small>${r.text}</small></span>${r.tool ? `<button class="btn sm ghost" data-act="final-go" data-v="${r.tool}">${r.label}</button>` : ''}</div>`,
      )
      .join('')}</div>
    <div class="row"><button class="btn primary sm" data-act="export">${icon('export')}Export STL</button>${buck.result ? `<button class="btn sm" data-act="buck-export">${icon('export')}Export buck</button>` : ''}</div>`;
}

const TOOL_MENU = { fix: 'repair', openings: 'repair', parts: 'repair', solid: 'repair', hollow: 'shell', paint: 'shell', chassis: 'chassis', posts: 'posts', windows: 'windows', buck: 'buck' };

function stepDetail(step, info) {
  const p = step.params,
    u = project.units;
  if (step.type === 'orient') return `front ${p.front}, roof ${p.up}${p.turn ? `, turned ${p.turn}°` : ''}`;
  if (step.type === 'scale') return `× ${round(p.factor, 4)}`;
  if (step.type === 'slice')
    return `${AXIS_NAMES[p.axis].toLowerCase()} at ${fmtLen(p.at, u)}${p.tilt ? `, tilted ${p.tilt}° along the ${LEAN_NAMES[p.lean]}` : ''} · keep ${p.keep === 'both' ? 'both' : KEEP_NAMES[p.axis][p.keep].toLowerCase()}${p.cap ? ' · closed' : ''}`;
  if (step.type === 'cutoff')
    return `${p.cuts.length} cut${p.cuts.length === 1 ? '' : 's'}${p.mirror ? ', mirrored' : ''}${p.open ? ' · left open' : ''}${info?.changed ? ` · ${info.changed.toLocaleString()} triangles off` : ''}`;
  if (step.type === 'delete')
    return p.label === 'parts' ? `${p.parts} part${p.parts === 1 ? '' : 's'} removed` : `${runCount(p.faces).toLocaleString()} triangles${p.patch === 'smooth' ? ' · patched' : ''}`;
  if (step.type === 'repair') {
    if (!info) return 'clean up faults';
    const bits = [
      [info.specks, 'specks removed'],
      [info.collapsed + info.doubled, 'broken triangles removed'],
      [info.split, 'touching spots untangled'],
      [info.flipped, 'triangles turned round'],
      [info.holes, 'holes closed'],
    ].filter(([n]) => n);
    return bits.length ? bits.map(([n, t]) => `${n.toLocaleString()} ${t}`).join(', ') : 'nothing needed fixing';
  }
  if (step.type === 'floor') return `${p.mode} at ${fmtLen(p.at, u)}${p.mode === 'squish' ? `, ${fmtLen(p.blend, u)} zone` : ''}${info?.pressed ? ` · ${info.pressed}% pressed` : ''}`;
  if (step.type === 'hollow')
    return `wall ${fmtLen(p.wall, u)}${Number.isFinite(p.top) ? `, roof ${fmtLen(p.top, u)}` : ''}${p.strokes?.length ? `, ${p.strokes.length} painted` : ''}${info?.oldWall ? ` · old wall was ${fmtLen(info.oldWall, u)}` : ''}${info?.solid ? ' · thin parts kept solid' : ''}`;
  if (step.type === 'hammer')
    return `${p.blows.length} blow${p.blows.length === 1 ? '' : 's'}${p.dollies?.length ? `, ${p.dollies.length} dolly spots` : ''}${info?.added ? ` · ${info.added.toLocaleString()} edges split` : ''}`;
  if (step.type === 'stretch')
    return p.axis === 'x' ? `${p.amount >= 0 ? 'longer' : 'shorter'} by ${fmtLen(Math.abs(p.amount), u)} between the arches` : `${p.amount >= 0 ? 'wider' : 'narrower'} by ${fmtLen(Math.abs(p.amount), u)}`;
  if (step.type === 'arches') return `${(p.which ?? []).join(' and ')} cut round the tyres`;
  if (step.type === 'smooth')
    return `${p.faces ? `${runCount(p.faces).toLocaleString()} selected triangles` : `${p.strokes.length} brush spot${p.strokes.length === 1 ? '' : 's'}`} · strength ${p.strength}${p.protect ? ' · inside only' : ''}`;
  if (step.type === 'addpart') return `${esc(p.name)} · ${p.join ? 'joined' : 'its own print'}${p.place?.pair ? ' · a pair' : ''}`;
  if (step.type === 'windows')
    return `${p.windows.length} window${p.windows.length === 1 ? '' : 's'}${info ? ` · ${info.cut} cut` : ''}${info?.warnings?.length ? ` · ${info.warnings.length} warning${info.warnings.length === 1 ? '' : 's'}` : ''}`;
  if (step.type === 'posts')
    return `${p.posts.length} × ${p.type?.name ?? 'post'}${p.length > 0 ? `, ${fmtLen(p.length, u, 1)} long` : ''}${info?.warnings?.length ? ` · ${info.warnings.length} warning${info.warnings.length === 1 ? '' : 's'}` : ''}`;
  if (step.type === 'solid')
    return `${info ? `${info.removed.toLocaleString()} triangles of inner skin removed` : 'inner skin removed'}${p.bottom != null ? ` · flat bottom at ${fmtLen(p.bottom, u)}` : ''}`;
  if (step.type === 'fill') return `${p.loops.length} opening${p.loops.length === 1 ? '' : 's'} · ${p.mode}`;
  if (step.type === 'reduce')
    return info ? `${info.after.toLocaleString()} of ${info.before.toLocaleString()} triangles · within ${fmtLen(info.moved, u, 3)}` : `keep ${Math.round(p.target * 100)}%`;
  return '';
}

function renderSteps() {
  const el = $('#steps');
  if (!project) {
    el.innerHTML = '<div class="muted" style="font-size:12px;padding:4px">Nothing yet.</div>';
    return;
  }
  const states = new Map((result?.results ?? []).map((r) => [r.id, r]));
  el.innerHTML =
    `<div class="sp fixed"><span class="n">1</span><span class="t">Import<small>${esc(project.source.fileName)}</small></span></div>` +
    project.steps
      .map((s, i) => {
        const r = states.get(s.id);
        const cls = [ui.editStep === s.id ? 'on' : '', s.enabled ? '' : 'off', r?.state === 'error' ? 'error' : ''].join(' ');
        const detail = r?.state === 'error' ? r.error : stepDetail(s, r?.info);
        const name = s.type === 'delete' && s.params.label === 'parts' ? 'Remove parts' : (STEP_NAMES[s.type] ?? s.type);
        return `<div class="sp ${cls}" data-act="edit-step" data-v="${s.id}" title="${esc(detail)}"><span class="n">${i + 2}</span>
          <span class="t">${name}<small>${esc(detail)}</small></span>
          <button data-act="toggle-step" data-v="${s.id}" title="${s.enabled ? 'Switch off' : 'Switch on'}">${icon(s.enabled ? 'eye' : 'eyeoff')}</button>
          <button data-act="remove-step" data-v="${s.id}" title="Remove this step">${icon('x')}</button></div>`;
      })
      .join('');
}

function renderStatus() {
  const el = $('#status');
  if (!result) {
    el.innerHTML = `<span class="sb"><span class="dot no"></span><b>Model</b>none open</span><span class="sb end">Anvil ${__ANVIL_VERSION__}</span>${footBrand}`;
    return;
  }
  const s = result.stats,
    u = project.units,
    b = s.bounds.size;
  const problems = [];
  if (s.openEdges) problems.push(`${s.openEdges.toLocaleString()} open edges`);
  if (s.faultyEdges) problems.push(`${s.faultyEdges.toLocaleString()} edge faults`);
  // Posts are pieces of their own that overlap the body; the slicer joins them.
  const postInfo = postsStep() && result.results.find((r) => r.id === postsStep().id)?.info;
  const joined = partSteps().reduce((n, x) => n + (x.enabled && x.params.join ? (x.params.place.pair ? 2 : 1) : 0), 0);
  const loose = s.parts - (postInfo?.made ?? 0) - joined;
  if (loose > 1) problems.push(`${loose} loose parts`);
  const broken = result.results.filter((r) => r.state === 'error').length;
  el.innerHTML = `
    <span class="sb" title="${problems.join(', ') || 'One closed piece, no faults'}"><span class="dot ${problems.length ? 'w' : 'ok'}"></span><b>Model</b>${s.triangles.toLocaleString()} triangles${problems.length ? ' · ' + problems.join(' · ') : ' · clean'}</span>
    <span class="sb"><span class="dot ok"></span><b>Size</b>${fmtLen(b[0], u)} × ${fmtLen(b[1], u)} × ${fmtLen(b[2], u)}</span>
    <span class="sb"><span class="dot ${selectedCount ? 'w' : 'no'}"></span><b>Selected</b>${selectedCount ? selectedCount.toLocaleString() : 'nothing'}</span>
    <span class="sb"><span class="dot ${broken ? 'bad' : 'ok'}"></span><b>Steps</b>${project.steps.length + 1}${broken ? ` · ${broken} could not be done` : ''}</span>
    ${chassisStatus()}
    ${wallStatus()}
    <span class="sb end">Anvil ${__ANVIL_VERSION__}</span>${footBrand}`;
}

// ------------------------------------------------------------ guides on the car

function applyGuide() {
  const editing = project?.steps.find((s) => s.id === ui.editStep);
  const slicing = result && ((ui.panel === 'slice' && !ui.editStep) || editing?.type === 'slice');
  if (slicing && ui.slice.at != null) {
    const s = ui.slice;
    viewport.planeGuide(s.axis, s.at, undefined, s.tilt && s.lean !== s.axis ? { tilt: s.tilt, lean: s.lean, pivot: s.pivot ?? slicePivot(s.lean) } : null);
  }
  else if (result && ui.solid?.flat && (editing ? editing.type === 'solid' : ui.panel === 'solid')) viewport.planeGuide('z', ui.solid.bottom);
  else viewport.planeGuide(null);
  // Cut off: the planes with their handles, and the part that goes in red.
  const cutting = result && ((ui.panel === 'cutoff' && !ui.editStep) || editing?.type === 'cutoff');
  const s = ui.cutoff;
  viewport.setCutter(cutting && s.cuts.length ? { cuts: s.cuts, active: s.active, mirror: s.mirror, mode: s.mode } : null, cutChanged);
  let pv = cutting && !editing && s.cuts.length ? cutoffPreviewNow() : null;
  // Make solid: the inner skin that goes, in red.
  if (!pv && result && ui.panel === 'solid' && !ui.editStep && lookups.solid.token === buildToken) pv = lookups.solid.value;
  if (pv?.faces) {
    viewport.paintSelection(pv.faces);
    ui.cutPainted = true;
  } else if (ui.cutPainted) {
    ui.cutPainted = false;
    viewport.paintSelection(selection);
  }
}

// ------------------------------------------------------------ selection

function setPointer(tool) {
  if (ui.pointer !== tool) clearMeasure();
  ui.pointer = tool;
  viewport.setOrbitButton(tool === 'look' ? 'left' : 'right');
  viewport.brushRing(null);
  if (['brush', 'lasso', 'connected'].includes(tool)) {
    ui.panel = 'select';
    ui.editStep = null;
  } else if (tool === 'paint') {
    ui.panel = 'paint';
  } else if (tool === 'hammer') {
    ui.panel = 'hammer';
    ui.editStep = null;
  } else if (tool === 'distance' || tool === 'wall') {
    ui.panel = 'measure';
    ui.editStep = null;
    clearMeasure();
  }
}

// Protect the outside: on by default, and only meaningful once the body has
// an inside (after Hollow). Then selections and smoothing leave the outer skin alone.
const protectActive = () => project.protect !== false && project.steps.some((s) => s.type === 'hollow' && s.enabled);

function applyFaces(faces, mode) {
  if (!selection) return;
  let outer = null;
  if (protectActive() && mode !== 'remove') {
    outer = lookup('skins');
    if (!outer) return toast('Finding the outside of the body… try again in a moment.');
  }
  if (mode === 'replace') selection.fill(0);
  const v = mode === 'remove' ? 0 : 1;
  for (const f of faces) {
    if (outer && outer[f] === 1) continue;
    selection[f] = v;
    if (project.mirror) {
      const m = viewport.mirrorOf(f);
      if (m >= 0 && !(outer && outer[m] === 1)) selection[m] = v;
    }
  }
  selectionChanged();
}

function selectionChanged() {
  let n = 0;
  for (let i = 0; i < selection.length; i++) n += selection[i];
  selectedCount = n;
  viewport.paintSelection(selection);
  const count = $('#sel-count');
  if (count) count.textContent = n.toLocaleString();
  for (const b of document.querySelectorAll('[data-act="sel-delete"], [data-act="smooth-sel"]')) b.disabled = !n;
  for (const b of document.querySelectorAll('#panel [data-act="tool"][data-v="smooth"]')) b.disabled = !n;
  renderStatus();
}

function connectedFaces(start) {
  const twins = result.twins,
    seen = new Uint8Array(selection.length),
    out = [start],
    stack = [start];
  seen[start] = 1;
  while (stack.length) {
    const f = stack.pop();
    for (let e = f * 3; e < f * 3 + 3; e++) {
      const t = twins[e];
      if (t < 0) continue;
      const g = Math.floor(t / 3);
      if (!seen[g]) {
        seen[g] = 1;
        out.push(g);
        stack.push(g);
      }
    }
  }
  return out;
}

function deleteSelected(patch) {
  if (!selectedCount) return toast('Select something first.');
  const faces = [];
  for (let f = 0; f < selection.length; f++) if (selection[f]) faces.push(f);
  const params = { faces: encodeRuns(faces), ...(patch === 'smooth' ? { patch: 'smooth' } : {}) };
  commit(() => project.steps.push({ id: newId(), type: 'delete', enabled: true, params }));
  toast(`Deleted ${faces.length.toLocaleString()} triangles${patch === 'smooth' ? ' and patched the hole' : ''}. Undo or switch the step off to bring them back.`);
}

// ------------------------------------------------------------ measuring

function clearMeasure() {
  ui.measure = [];
  viewport.clearOverlay();
}

function measureClick(hit) {
  const u = project.units;
  if (ui.pointer === 'distance') {
    if (ui.measure.length >= 2) clearMeasure();
    ui.measure.push(hit);
    viewport.marker(hit.point);
    if (ui.measure.length === 2) {
      const [a, b] = ui.measure;
      viewport.segment(a.point, b.point);
      viewport.label(a.point.clone().lerp(b.point, 0.5), fmtLen(a.point.distanceTo(b.point), u));
    }
  } else {
    clearMeasure();
    const t = viewport.thicknessAt(hit);
    viewport.marker(hit.point);
    if (t) {
      viewport.marker(t.end, 0x3b9cff);
      viewport.segment(hit.point, t.end, 0x3b9cff);
      viewport.label(hit.point, fmtLen(t.distance, u));
      ui.measure.wall = t.distance;
    } else ui.measure.wallMiss = true;
  }
  renderPanel();
}

// ------------------------------------------------------------ pointer on the car

const canvas = viewport.canvas;
let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !result || ui.pointer === 'look' || ui.busy) return;
  canvas.setPointerCapture(e.pointerId);
  const mode = e.altKey ? 'remove' : e.shiftKey ? 'add' : 'replace';
  drag = { x: e.clientX, y: e.clientY, mode, points: [[e.clientX, e.clientY]], moved: false };
  if (ui.pointer === 'paint') {
    drag.strokes = [];
    paintAt(e);
  }
  if (ui.pointer === 'hammer') {
    drag.blows = [];
    drag.dollies = [];
    hammerAt(e);
  }
  if (ui.pointer === 'line') lineDown(e);
  if (ui.pointer === 'smooth') {
    drag.strokes = [];
    smoothAt(e);
  }
  if (ui.pointer === 'brush') {
    drag.mode = e.altKey ? 'remove' : 'add';
    if (!e.shiftKey && !e.altKey && selectedCount === 0) selection.fill(0);
    brushAt(e);
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (!result) return;
  if (ui.pointer === 'brush') {
    const hit = viewport.pick(e);
    viewport.brushRing(hit, ui.brush);
    if (drag) brushAt(e, hit);
  }
  if (ui.pointer === 'paint') {
    const hit = viewport.pick(e);
    viewport.brushRing(hit, paintRadius());
    if (drag) paintAt(e, hit);
  }
  if (ui.pointer === 'hammer') {
    const hit = viewport.pick(e);
    viewport.brushRing(hit, hammerOptions().radius);
    if (drag) hammerAt(e, hit);
  }
  if (ui.pointer === 'post') viewport.brushRing(viewport.pick(e), postTypeById(postOptions().type).outer / 2);
  if (ui.pointer === 'line') lineMove(e);
  if (ui.pointer === 'smooth') {
    const hit = viewport.pick(e);
    viewport.brushRing(hit, smoothOptions().radius);
    if (drag) smoothAt(e, hit);
  }
  if (!drag) return;
  if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4) drag.moved = true;
  if (ui.pointer === 'lasso') {
    drag.points.push([e.clientX, e.clientY]);
    const r = canvas.getBoundingClientRect();
    $('#lasso polyline').setAttribute('points', drag.points.map(([x, y]) => `${x - r.left},${y - r.top}`).join(' '));
  }
});
canvas.addEventListener('pointerleave', () => viewport.brushRing(null));
canvas.addEventListener('pointerup', (e) => {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (ui.pointer === 'lasso') {
    $('#lasso polyline').setAttribute('points', '');
    if (d.points.length > 2) applyFaces(viewport.facesInPolygon(d.points, ui.frontOnly.lasso), d.mode);
    return;
  }
  if (ui.pointer === 'paint') {
    viewport.brushRing(null);
    if (d.strokes?.length) addStrokes(d.strokes);
    return;
  }
  if (ui.pointer === 'hammer') {
    viewport.brushRing(null);
    if (d.blows?.length || d.dollies?.length) addBlows(d.blows, d.dollies);
    return;
  }
  if (ui.pointer === 'line') {
    if (ui.win.drag || !d.moved) lineUp(e);
    return;
  }
  if (ui.pointer === 'smooth') {
    viewport.brushRing(null);
    viewport.clearOverlay();
    if (d.strokes?.length) addSmooth({ strokes: d.strokes });
    return;
  }
  if (d.moved) return;
  const hit = viewport.pick(e);
  if (ui.pointer === 'connected') {
    if (hit) applyFaces(connectedFaces(hit.face), d.mode);
    else if (d.mode === 'replace') applyFaces([], 'replace');
  } else if ((ui.pointer === 'distance' || ui.pointer === 'wall') && hit) measureClick(hit);
  else if (ui.pointer === 'post' && hit) placePost(hit);
  else if (ui.pointer === 'cutplace' && hit) placeCut(hit);
});

function brushAt(e, hit = viewport.pick(e)) {
  if (!hit) return;
  const faces = viewport.facesInSphere(hit.point, ui.brush, ui.frontOnly.brush);
  applyFaces(faces, drag.mode);
}

// ------------------------------------------------------------ actions

const actions = {
  async new() {
    if (project && !confirm('Start a new body? The current one is only kept if you saved it as a project file.')) return;
    project = result = selection = null;
    selectedCount = 0;
    history.clear();
    viewport.clear();
    clearMeasure();
    await clearLocal().catch(() => {});
    renderAll();
  },
  open: () => $('#file').click(),
  save() {
    if (!project) return;
    download(fileName('anvil'), encodeProjectFile(project), 'application/json');
    toast('Project saved as a file. It holds the original model and all your steps.');
  },
  export() {
    if (!result) return;
    download(fileName('stl'), encodeSTL(result, `SlotForge Anvil · ${project.name}`), 'model/stl');
  },
  undo() {
    const snap = history.undo(snapshot(project));
    if (!snap) return;
    project = restore(project, snap);
    ui.editStep = null;
    scheduleSave();
    rebuild();
  },
  redo() {
    const snap = history.redo(snapshot(project));
    if (!snap) return;
    project = restore(project, snap);
    ui.editStep = null;
    scheduleSave();
    rebuild();
  },
  menu(v) {
    ui.menu = v;
    renderSub();
  },
  tool(v) {
    ui.panel = v;
    ui.editStep = null;
    if (v !== 'windows') ui.win.draft = ui.win.editing = null;
    if (v === 'parts') ui.partsDrop = null;
    if (v === 'openings') ui.closeLoops = new Set();
    if (v === 'fix') ui.fixOpts = null;
    if (v === 'solid') ui.solid = null;
    if (['chassis', 'tyres', 'arches', 'stretch'].includes(v) && project.chassis) ui.look.chassis = true;
    if (v === 'select' && !['brush', 'lasso', 'connected'].includes(ui.pointer)) setPointer('brush');
    else if (v === 'hammer') setPointer('hammer');
    else if (v === 'posts') setPointer('post');
    else if (v === 'posteditor') ui.postDraft = null;
    else if (v === 'paint') {
      setPointer('paint');
      if (!ui.look.thickness) actions.look('thickness');
    }
    if (!['select', 'paint', 'hammer', 'posts'].includes(v) && ui.pointer !== 'look' && !['distance', 'wall'].includes(ui.pointer)) setPointer('look');
    if (v === 'cutoff' && !ui.cutoff.cuts.length) setPointer('cutplace');
    if ((v === 'select' || v === 'smooth') && protectActive()) lookup('skins');
    if (v === 'posts' && project.chassis) ui.look.chassis = true;
    applyGuide();
    renderAll();
  },
  pointer(v) {
    // The line tool draws windows: open the Windows panel with a new outline.
    if (v === 'line' && !ui.win.draft && !ui.win.editing) {
      ui.menu = 'windows';
      actions.tool('windows');
      return actions['win-new']();
    }
    if (v !== 'line' && (ui.win.draft || ui.win.editing)) ui.win.draft = ui.win.editing = null;
    setPointer(v);
    applyGuide();
    renderAll();
  },
  look(v) {
    ui.look[v] = !ui.look[v];
    if (v === 'original') viewport.setShowOriginal(ui.look.original);
    if (v === 'thickness') applyHeat();
    if (v === 'chassis') {
      drawGhost();
      renderFitBar(ui.panel === 'chassis' || ui.panel === 'tyres');
    }
    if (v === 'section') applySection();
    renderTools();
    renderSectionBar();
  },
  mirror() {
    commit(() => (project.mirror = !project.mirror), false);
    viewport.setShowCentre(project.mirror);
  },
  units(v) {
    commit(() => (project.units = v), false);
  },
  view(v) {
    ui.lastView = v;
    viewport.view(v);
    renderViewChrome();
  },
  persp(v) {
    ui.perspective = v === '1';
    viewport.setPerspective(ui.perspective);
    renderViewChrome();
  },
  'section-axis'(v) {
    ui.section.axis = v;
    const [lo, hi] = axisRange(v);
    ui.section.at = (lo + hi) / 2;
    applySection();
    renderSectionBar();
  },
  'section-flip'() {
    ui.section.flip = !ui.section.flip;
    applySection();
  },
  'orient-front'(v) {
    setOrient({ front: v });
  },
  'orient-up'(v) {
    setOrient({ up: v });
  },
  'orient-turn'() {
    const p = orientStep()?.params ?? { front: '+x', up: '+z' };
    setOrient({ front: (p.front[0] === '+' ? '-' : '+') + p.front[1] });
  },
  'orient-flip'() {
    const p = orientStep()?.params ?? { front: '+x', up: '+z' };
    setOrient({ up: (p.up[0] === '+' ? '-' : '+') + p.up[1] });
  },
  'orient-yaw'(v) {
    const p = orientStep()?.params ?? {};
    setOrient({ turn: Math.round(((p.turn ?? 0) + Number(v)) * 10) / 10 });
  },
  async 'orient-straighten'() {
    try {
      const { turn } = await call('straighten', { params: orientStep()?.params ?? { front: '+x', up: '+z' } });
      setOrient({ turn });
      toast(turn ? `Straightened: turned ${turn}°.` : 'The car already sits straight.');
    } catch (e) {
      toast(e.message, 'bad');
    }
  },
  'scale-mode'(v) {
    ui.scale.mode = v;
    if (v === 'length' && !ui.scale.length) ui.scale.length = result.stats.bounds.size[ui.scale.dim ?? 0];
    renderPanel();
  },
  'scale-dim'(v) {
    ui.scale.dim = Number(v);
    ui.scale.length = result.stats.bounds.size[ui.scale.dim];
    renderPanel();
  },
  'scale-to'(v) {
    ui.scale.to = Number(v);
    renderPanel();
  },
  'scale-apply'() {
    const f = scaleFactor();
    if (!(f > 0)) return;
    addOrUpdateStep('scale', { factor: f });
    if (ui.scale.mode === 'length') ui.scale.length = null;
  },
  'slice-axis'(v) {
    ui.slice.axis = v;
    ui.slice.at = null;
    ui.slice.lean = SLICE_LEAN[v];
    ui.slice.pivot = null;
    renderPanel();
    applyGuide();
  },
  'slice-tilt'(v) {
    const d = Number(v);
    ui.slice.tilt = d === 0 ? 0 : Math.max(-80, Math.min(80, round((ui.slice.tilt ?? 0) + d, 2)));
    renderPanel();
    applyGuide();
  },
  'slice-lean'(v) {
    ui.slice.lean = v;
    ui.slice.pivot = null;
    renderPanel();
    applyGuide();
  },
  'cut-place'() {
    setPointer('cutplace');
    renderPanel();
  },
  'cut-place-stop'() {
    setPointer('look');
    renderPanel();
  },
  'cut-pick'(v) {
    ui.cutoff.active = Number(v);
    renderPanel();
    applyGuide();
  },
  'cut-remove'() {
    ui.cutoff.cuts.splice(ui.cutoff.active, 1);
    ui.cutoff.active = Math.max(0, ui.cutoff.active - 1);
    renderPanel();
    applyGuide();
  },
  'cut-mode'(v) {
    ui.cutoff.mode = v;
    renderPanel();
    applyGuide();
  },
  'cut-flip'() {
    const c = ui.cutoff.cuts[ui.cutoff.active];
    c.normal = c.normal.map((x) => -x);
    renderPanel();
    applyGuide();
  },
  'cut-push'(v) {
    const c = ui.cutoff.cuts[ui.cutoff.active];
    const l = Math.hypot(...c.normal);
    c.at = c.at.map((x, i) => round(x + (Number(v) * c.normal[i]) / l, 4));
    renderPanel();
    applyGuide();
  },
  'cut-apply'() {
    if (!ui.cutoff.cuts.length) return;
    addOrUpdateStep('cutoff', cutoffParams());
  },
  'slice-keep'(v) {
    ui.slice.keep = v;
    renderPanel();
  },
  'slice-apply'() {
    addOrUpdateStep('slice', sliceParams());
  },
  'fix-apply'() {
    addOrUpdateStep('repair', { ...fixOptions() });
  },
  'fix-now'() {
    ui.editStep = null;
    addOrUpdateStep('repair', { clean: true, untangle: true, winding: true, specks: true, holes: true });
  },
  'part-keep'(v) {
    const id = Number(v);
    if (ui.partsDrop.has(id)) ui.partsDrop.delete(id);
    else ui.partsDrop.add(id);
    renderPanel();
  },
  'parts-apply'() {
    const c = lookup('check');
    if (!c || !ui.partsDrop?.size) return;
    const faces = [];
    for (let f = 0; f < c.partOf.length; f++) if (ui.partsDrop.has(c.partOf[f])) faces.push(f);
    const parts = ui.partsDrop.size;
    ui.editStep = null;
    commit(() => project.steps.push({ id: newId(), type: 'delete', enabled: true, params: { faces: encodeRuns(faces), label: 'parts', parts } }));
    ui.partsDrop = null;
  },
  'loop-close'(v) {
    const id = Number(v);
    if (ui.closeLoops.has(id)) ui.closeLoops.delete(id);
    else ui.closeLoops.add(id);
    renderPanel();
  },
  'loops-small'() {
    for (const o of lookup('openings') ?? []) if (o.small) ui.closeLoops.add(o.id);
    renderPanel();
  },
  'fill-mode'(v) {
    ui.fillMode = v;
    renderPanel();
  },
  'fill-apply'() {
    const list = lookup('openings');
    if (!list || !ui.closeLoops.size) return;
    addOrUpdateStep('fill', { loops: [...ui.closeLoops].sort((a, b) => a - b), mode: ui.fillMode, count: list.length });
    ui.closeLoops = new Set();
  },
  'solid-apply'() {
    const s = ui.solid;
    addOrUpdateStep('solid', { bottom: s?.flat ? round(s.bottom, 4) : null });
  },
  'reduce-apply'() {
    addOrUpdateStep('reduce', { target: ui.reduce.keep / 100, tolerance: reduceTolerance() });
  },
  'floor-mode'(v) {
    ui.floor.mode = v;
    renderPanel();
  },
  'floor-apply'() {
    const { mode, at, blend } = ui.floor;
    addOrUpdateStep('floor', { mode, at: round(at, 4), blend });
  },
  'print-process'(v) {
    const material = v === 'resin' ? 'resin' : 'pla';
    commit(() => (project.print = { ...project.print, process: v, material }), false);
    ui.hollow = null;
  },
  'top-toggle'() {
    hollowOptions().lighten = !hollowOptions().lighten;
    renderPanel();
  },
  'hollow-apply'() {
    const o = hollowOptions();
    const editing = project.steps.find((s) => s.id === ui.editStep && s.type === 'hollow');
    addOrUpdateStep('hollow', { wall: o.wall, top: o.lighten ? o.top : null, strokes: editing?.params.strokes ?? [] });
    if (!ui.look.thickness) actions.look('thickness');
  },
  'chassis-new'() {
    const a = lookup('arches');
    if (!a) return;
    commit(() => (project.chassis = suggestChassis(a)), false);
    ui.look.chassis = true;
    drawGhost();
    toast('A chassis that fits this body. Change any number to match yours.');
  },
  'chassis-remove'() {
    commit(() => (project.chassis = null), false);
    ui.look.chassis = false;
    drawGhost();
  },
  'fit-wheelbase'() {
    const a = lookup('arches');
    if (!a || a.arches.length < 2) return;
    commit(() => {
      project.chassis = { ...project.chassis, frontX: round(a.arches[0].x, 2), wheelbase: round(a.arches[1].x - a.arches[0].x, 2) };
    }, false);
  },
  'fit-front'() {
    const a = lookup('arches');
    if (!a?.arches.length) return;
    commit(() => (project.chassis = { ...project.chassis, frontX: round(a.arches[0].x, 2) }), false);
  },
  'fit-in'(v) {
    commit(() => {
      const t = project.chassis[v];
      const r = fitReport(project.chassis, lookup('arches'));
      project.chassis = { ...project.chassis, [v]: { ...t, inOut: round(t.inOut - r[v].stickOut - 0.1, 2) } };
    }, false);
  },
  'fit-small'(v) {
    commit(() => {
      const a = lookup('arches');
      const arch = a.arches[v === 'front' ? 0 : 1];
      const ground = a.bounds.min[2] - project.chassis.clearance;
      const t = project.chassis[v];
      project.chassis = { ...project.chassis, [v]: { ...t, diameter: round(arch.top - ground - 0.4, 1) } };
    }, false);
  },
  'lib-save'() {
    const c = project.chassis;
    if (!c) return;
    libraryChange((db) => saveChassis(db, c, c.stl ? project.chassisMesh?.bytes : null, c.libId ?? null), c.libId ? 'Chassis updated in your library.' : 'Chassis saved to your library.').then((id) => {
      if (id && id !== c.libId) commit(() => (project.chassis = { ...project.chassis, libId: id }), false);
    });
  },
  'lib-save-new'() {
    const c = project.chassis;
    libraryChange((db) => saveChassis(db, { ...c, name: `${c.name} (copy)` }, c.stl ? project.chassisMesh?.bytes : null), 'Saved as a new chassis.').then((id) => {
      if (id) commit(() => (project.chassis = { ...project.chassis, name: `${c.name} (copy)`, libId: id }), false);
    });
  },
  async 'lib-use'(id) {
    const db = await library();
    const row = listChassis(db).find((r) => r.id === id);
    if (!row) return;
    const stl = row.stlName ? readChassisStl(db, id) : null;
    useChassis({ ...row.data, libId: id }, stl, row.stlName);
    toast(`Using ${row.name}.`);
  },
  'lib-delete'(id) {
    const row = lib.list?.find((r) => r.id === id);
    if (!row || !confirm(`Remove "${row.name}" from your library? This cannot be undone.`)) return;
    libraryChange((db) => deleteChassis(db, id), 'Removed from your library.');
    if (project.chassis?.libId === id) commit(() => (project.chassis = { ...project.chassis, libId: undefined }), false);
  },
  async 'lib-share'(id) {
    const db = await library();
    const row = listChassis(db).find((r) => r.id === id);
    if (row) download(`${row.name.replace(/[\\/:*?"<>|]+/g, '-')}.anvilchassis`, encodeChassisFile(row.data, readChassisStl(db, id)), 'application/json');
  },
  'chassis-share'() {
    const c = project.chassis;
    if (c) download(`${c.name.replace(/[\\/:*?"<>|]+/g, '-')}.anvilchassis`, encodeChassisFile(c, c.stl ? project.chassisMesh?.bytes : null), 'application/json');
  },
  'chassis-import'() {
    $('#chassis-file').click();
  },
  'stl-load'() {
    $('#chassis-stl').click();
  },
  'stl-flip'() {
    commit(() => (project.chassis = { ...project.chassis, stl: { ...project.chassis.stl, flip: !project.chassis.stl.flip } }), false);
  },
  'stl-remove'() {
    commit(() => {
      const { stl, ...rest } = project.chassis;
      project.chassis = rest;
      project.chassisMesh = null;
    }, false);
  },
  'stretch-match'() {
    const a = lookup('arches');
    const r = a && fitReport(project.chassis, a);
    if (!r?.bodyWheelbase) return toast('Both wheel arches are needed to stretch between them.', 'bad');
    addBeforeHollow('stretch', { axis: 'x', amount: round(-r.wheelbaseOff, 3), ...stretchZone(a) });
  },
  'widen-fit'() {
    const a = lookup('arches');
    const r = a && fitReport(project.chassis, a);
    if (!r) return;
    const out = Math.max(r.front.stickOut, r.rear.stickOut, 0);
    addBeforeHollow('stretch', { axis: 'y', amount: round(out * 2 + 0.2, 2) });
  },
  'stretch-apply'(v) {
    const a = lookup('arches');
    const o = stretchOptions();
    if (v === 'x') {
      if (!a || a.arches.length < 2) return toast('Both wheel arches are needed to stretch between them.', 'bad');
      addBeforeHollow('stretch', { axis: 'x', amount: o.length, ...stretchZone(a) });
    } else addBeforeHollow('stretch', { axis: 'y', amount: o.width });
  },
  'stretch-fill'(v) {
    const a = lookup('arches');
    const r = a && project.chassis && fitReport(project.chassis, a);
    if (!r) return;
    const o = stretchOptions();
    if (v === 'x' && r.bodyWheelbase) o.length = round(-r.wheelbaseOff, 2);
    if (v === 'y') o.width = round(Math.max(r.front.stickOut, r.rear.stickOut, 0) * 2 + 0.2, 2);
    renderPanel();
  },
  'arch-pick'(v) {
    const o = archOptions();
    o[v] = !o[v];
    renderPanel();
  },
  'arch-cut'(v) {
    const o = archOptions();
    const which = v ? [v] : ['front', 'rear'].filter((k) => o[k]);
    if (!which.length) return;
    addBeforeHollow('arches', { cuts: which.map((k) => archCircle(k, o.gap)), which });
  },
  'arch-flare'() {
    const o = archOptions();
    const a = lookup('arches');
    if (!a) return;
    const blows = [];
    for (const k of ['front', 'rear'].filter((k) => o[k])) {
      const c = archCircle(k, o.gap);
      const side = a.arches[k === 'front' ? 0 : 1]?.halfWidth ?? result.stats.bounds.size[1] / 2;
      blows.push(...flareBlows({ ...c, side, amount: o.flare, head: o.head }));
    }
    if (blows.length) addBlows(blows, []);
  },
  protect() {
    commit(() => (project.protect = project.protect === false), false);
    toast(project.protect !== false ? 'Protect the outside is on: after Hollow, selecting and smoothing only touch the inside.' : 'Protect the outside is off: tools can change the outside too.');
    if (project.protect !== false) lookup('skins');
    renderTools();
  },
  final() {
    ui.menu = null;
    actions.tool('final');
  },
  settings() {
    const d = settingsDialog();
    if (!d.open) d.showModal();
  },
  'final-go'(v) {
    if (TOOL_MENU[v]) ui.menu = TOOL_MENU[v];
    actions.tool(v);
  },
  'smooth-sel'() {
    if (!selectedCount) return;
    const faces = [];
    for (let f = 0; f < selection.length; f++) if (selection[f]) faces.push(f);
    addSmooth({ faces: encodeRuns(faces) });
    toast(`Smoothing ${faces.length.toLocaleString()} triangles…`);
  },
  'ap-load'() {
    $('#part-file').click();
  },
  'ap-join'(v) {
    const [id, j] = v.split('|');
    const s = project.steps.find((x) => x.id === id);
    if (s) commit(() => (s.params = { ...s.params, join: j === '1' }));
  },
  'ap-export'(id) {
    const s = project.steps.find((x) => x.id === id);
    const m = s && partMesh(s.params.part);
    if (!m) return toast('The file of this part is missing.', 'bad');
    let pos = [], idx = [];
    for (const p of partPieces(m, s.params.place)) {
      const off = pos.length / 3;
      pos = pos.concat(Array.from(p.positions));
      for (const v of p.indices) idx.push(v + off);
    }
    download(`${s.params.name.replace(/[\\/:*?"<>|]+/g, '-')}.stl`, encodeSTL({ positions: Float32Array.from(pos), indices: Uint32Array.from(idx) }, `SlotForge Anvil · ${s.params.name}`), 'model/stl');
  },
  async 'ap-save'(id) {
    const s = project.steps.find((x) => x.id === id);
    const f = s && project.parts?.[s.params.part];
    if (!f) return;
    await changeLibrary((db) => savePart(db, { name: s.params.name, fileName: f.fileName, bytes: f.bytes, place: s.params.place })).catch((e) => toast(e.message, 'bad'));
    partLib.list = listParts(await library());
    toast(`${s.params.name} is in your library.`);
    renderPanel();
  },
  async 'ap-lib-use'(id) {
    const db = await library();
    const row = partLib.list?.find((r) => r.id === id);
    const stl = readPartStl(db, id);
    if (!row || !stl) return toast('That part could not be read from the library.', 'bad');
    loadPart(row.stlName, row.name, stl.slice().buffer, row.data.place);
  },
  async 'ap-lib-delete'(id) {
    const row = partLib.list?.find((r) => r.id === id);
    if (!row || !confirm(`Remove ${row.name} from your library? Bodies that use it keep their copy.`)) return;
    await changeLibrary((db) => deletePart(db, id)).catch((e) => toast(e.message, 'bad'));
    partLib.list = listParts(await library());
    renderPanel();
  },
  'win-new'() {
    ui.win.editing = null;
    ui.win.draft = { id: newId(), name: '', points: [], corners: [], normals: [], normal: [0, -1, 0], mirror: project.mirror, open: true };
    setPointer('line');
    renderAll();
  },
  'win-finish'() {
    const d = ui.win.draft;
    if (!d || d.points.length < 3) return;
    const normal = meanNormal(d.normals);
    const ys = d.points.map((p) => p[1]);
    // Mirrored only when it sits on one side of the centre line.
    const oneSide = Math.min(...ys) > 1 || Math.max(...ys) < -1;
    const w = { ...d, normal, name: windowName(normal), mirror: project.mirror && oneSide };
    ui.win.draft = null;
    setPointer('look');
    setWindows([...allWindows(), w]);
    toast(`${w.name} added${w.mirror ? ' on both sides' : ''}. Cutting it…`);
  },
  'win-cancel'() {
    ui.win.draft = null;
    setPointer('look');
    renderAll();
  },
  'win-edit'(id) {
    ui.win.draft = null;
    ui.win.editing = ui.win.editing === id ? null : id;
    setPointer(ui.win.editing ? 'line' : 'look');
    renderAll();
  },
  'win-done'() {
    ui.win.editing = null;
    setPointer('look');
    renderAll();
  },
  'win-state'(v) {
    const [id, state] = v.split('|');
    setWindows(allWindows().map((w) => (w.id === id ? { ...w, open: state === 'open' } : w)));
  },
  'win-mirror'(id) {
    setWindows(allWindows().map((w) => (w.id === id ? { ...w, mirror: !w.mirror } : w)));
  },
  'win-delete'(id) {
    if (ui.win.editing === id) ui.win.editing = null;
    setWindows(allWindows().filter((w) => w.id !== id));
  },
  'buck-make': () => makeBuckNow(),
  'buck-export'() {
    const r = buck.result;
    if (!r) return;
    download(fileName('stl').replace(/\.stl$/, ' buck.stl'), encodeSTL({ positions: r.positions, indices: r.indices }, `SlotForge Anvil · buck · ${project.name}`), 'model/stl');
    toast('Buck exported. Print it solid and smooth it before forming.');
  },
  'post-fixed'(v) {
    postOptions().fixed = v === '1';
    refreshPosts();
  },
  'post-follow': () => refreshPosts(),
  'post-remove'(v) {
    setPosts(currentPosts().filter((_, i) => i !== Number(v)));
  },
  'post-clear'() {
    setPosts([]);
  },
  'post-spots'() {
    const t = postTypeById(postOptions().type);
    const posts = currentPosts();
    const add = chassisSpots().filter((p) => !posts.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < t.outer));
    if (!add.length) return toast('The chassis spots already have posts.');
    setPosts([...posts, ...add]);
  },
  'post-save-spots'() {
    const c = project.chassis;
    const seen = new Map();
    for (const p of currentPosts()) {
      const s = { along: round(p.x - c.frontX, 2), side: round(Math.abs(p.y), 2) };
      seen.set(`${s.along}|${s.side}`, s);
    }
    commit(() => (project.chassis = { ...c, posts: [...seen.values()] }), false);
    toast(`${seen.size} post spot${seen.size === 1 ? '' : 's'} kept with ${c.name}. Save it to the library to use them on your next body.`);
  },
  'pe-kind'(v) {
    postDraft().kind = v;
    renderPanel();
  },
  async 'pe-save'(asNew) {
    const d = postDraft();
    try {
      checkPostType(d);
    } catch (e) {
      return toast(e.message, 'bad');
    }
    const id = await changeLibrary((db) => savePostType(db, d, asNew === true ? null : d.id)).catch((e) => toast(e.message, 'bad'));
    if (!id) return;
    postLib.list = listPostTypes(await library());
    d.id = id;
    postOptions().type = id;
    toast(`${d.name} is in your library.`);
    refreshPosts();
  },
  'pe-save-new'() {
    actions['pe-save'](true);
  },
  async 'pe-delete'() {
    const d = postDraft();
    if (!d.id || !confirm(`Remove ${d.name} from your library? Posts already on a body keep their sizes.`)) return;
    await changeLibrary((db) => deletePostType(db, d.id)).catch((e) => toast(e.message, 'bad'));
    postLib.list = listPostTypes(await library());
    if (postOptions().type === d.id) postOptions().type = 'screw';
    d.id = null;
    renderPanel();
  },
  'pe-fit'() {
    const d = postDraft();
    try {
      const m = fitTestPiece(d, ui.postTest.wall, ui.postTest.length);
      download(`${d.name.replace(/[\\/:*?"<>|]+/g, '-')} fit test.stl`, encodeSTL(m, `SlotForge Anvil · fit test · ${d.name}`), 'model/stl');
    } catch (e) {
      toast(e.message, 'bad');
    }
  },
  'pe-loose'() {
    const d = postDraft();
    try {
      const m = loosePost(d, ui.postTest.length);
      download(`${d.name.replace(/[\\/:*?"<>|]+/g, '-')} post.stl`, encodeSTL(m, `SlotForge Anvil · post · ${d.name}`), 'model/stl');
    } catch (e) {
      toast(e.message, 'bad');
    }
  },
  'hammer-mode'(v) {
    hammerOptions().mode = v;
    renderPanel();
  },
  'hammer-side'(v) {
    hammerOptions().side = v;
    renderPanel();
  },
  'dolly-clear'() {
    const steps = project.steps.filter((s) => s.type === 'hammer' && s.params.dollies?.length);
    if (steps.length) commit(() => steps.forEach((s) => (s.params = { ...s.params, dollies: [] })));
  },
  'paint-dir'(v) {
    ui.paint.dir = v;
    renderPanel();
  },
  'paint-clear'() {
    const step = hollowStep();
    if (!step?.params.strokes?.length) return;
    commit(() => (step.params = { ...step.params, strokes: [] }));
  },
  'sel-clear'() {
    selection?.fill(0);
    selectionChanged();
  },
  'sel-invert'() {
    for (let i = 0; i < selection.length; i++) selection[i] ^= 1;
    selectionChanged();
  },
  'sel-delete': deleteSelected,
  'measure-scale'() {
    const input = document.querySelector('[data-field="measure-real"]');
    const real = fromUnits(Number(input?.value), project.units);
    const [a, b] = ui.measure;
    if (!(real > 0) || !a || !b) return toast('Enter how long this distance should be.', 'bad');
    const factor = real / a.point.distanceTo(b.point);
    ui.editStep = null;
    addOrUpdateStep('scale', { factor });
    toast(`Scaled the body by ×${round(factor, 4)}.`);
  },
  'edit-step'(v) {
    const step = project.steps.find((s) => s.id === v);
    if (!step) return;
    ui.editStep = ui.editStep === v ? null : v;
    if (ui.editStep && step.type === 'slice') ui.slice.editingId = null;
    if (ui.editStep && step.type === 'orient') ui.menu = 'scale';
    if (ui.pointer !== 'look') setPointer('look');
    if (ui.editStep) ui.panel = STEP_PANEL[step.type];
    if (ui.editStep && STEP_MENU[step.type]) ui.menu = STEP_MENU[step.type];
    applyGuide();
    renderAll();
  },
  'stop-edit'() {
    ui.editStep = null;
    ui.panel = 'home';
    applyGuide();
    renderAll();
  },
  'toggle-step'(v) {
    commit(() => {
      const s = project.steps.find((x) => x.id === v);
      if (s) s.enabled = !s.enabled;
    });
  },
  'remove-step'(v) {
    commit(() => {
      project.steps = project.steps.filter((x) => x.id !== v);
      if (ui.editStep === v) ui.editStep = null;
    });
  },
};

function setOrient(change) {
  commit(() => {
    let s = orientStep();
    if (!s) {
      s = { id: newId(), type: 'orient', enabled: true, params: { front: '+x', up: '+z' } };
      project.steps.unshift(s);
    }
    const next = { ...s.params, ...change };
    if (next.front[1] === next.up[1]) {
      // Choosing the other axis's letter: swap them, so both stay valid.
      if (change.front) next.up = s.params.front;
      else next.front = s.params.up;
    }
    s.params = next;
    s.enabled = true;
  });
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const act = actions[el.dataset.act];
  if (!act) return;
  e.stopPropagation();
  act(el.dataset.v);
});

// Fields: range sliders update as they move, number fields when changed.
document.addEventListener('input', (e) => {
  const f = e.target.dataset?.field;
  if (!f) return;
  const v = Number(e.target.value);
  if (f === 'section-at') {
    ui.section.at = v;
    $('#section-val').textContent = fmtLen(v, project.units);
    applySection();
  } else if (f === 'slice-range') {
    ui.slice.at = v;
    const num = document.querySelector('[data-field="slice-at"]');
    if (num) num.value = round(toUnits(v, project.units));
    applyGuide();
  } else if (f === 'floor-range') {
    ui.floor.at = v;
    const num = document.querySelector('[data-field="floor-at"]');
    if (num) num.value = round(toUnits(v, project.units));
    floorGuide();
  } else if (f.startsWith('ch-')) {
    return;
  } else if (f === 'hammer-radius') {
    hammerOptions().radius = v;
    const el = $('#hammer-radius-val');
    if (el) el.textContent = fmtLen(v, project.units, 1);
  } else if (f === 'hammer-force') {
    hammerOptions().force = v;
    const el = $('#hammer-force-val');
    if (el) el.textContent = fmtLen(v, project.units, 2);
  } else if (f === 'smooth-radius') {
    smoothOptions().radius = v;
    const el = $('#smooth-radius-val');
    if (el) el.textContent = fmtLen(v, project.units, 1);
  } else if (f === 'smooth-strength') {
    smoothOptions().strength = v;
    const el = $('#smooth-strength-val');
    if (el) el.textContent = v;
  } else if (f === 'paint-radius') {
    ui.paint.radius = v;
    const el = $('#paint-radius-val');
    if (el) el.textContent = fmtLen(v, project.units, 1);
  } else if (f === 'reduce-keep-range') {
    ui.reduce.keep = v;
    const el = $('#reduce-keep-val');
    const edited = result.results.find((r) => r.id === ui.editStep)?.info;
    if (el) el.textContent = `${v}% · about ${Math.round(((edited?.before ?? result.stats.triangles) * v) / 100).toLocaleString()} triangles`;
  } else if (f === 'brush') {
    ui.brush = v;
    $('#brush-val').textContent = fmtLen(v, project.units, 1);
  }
});
document.addEventListener('change', (e) => {
  const f = e.target.dataset?.field;
  if (!f) return;
  if (f.startsWith('ch-')) return setChassisField(f.slice(3), e.target.value);
  if (f.startsWith('ap-')) {
    const [, id, key] = f.split('-');
    const s = project.steps.find((x) => x.id === id);
    if (!s) return;
    let v;
    if (key === 'pair') v = e.target.checked;
    else {
      v = Number(e.target.value);
      if (!Number.isFinite(v) || (key === 'scale' && !(v > 0))) return renderPanel();
      if (['x', 'y', 'z'].includes(key)) v = fromUnits(v, project.units) + (key === 'x' ? result.stats.bounds.min[0] : 0);
      v = round(v, 4);
    }
    commit(() => (s.params = { ...s.params, place: { ...s.params.place, [key]: v } }));
    return;
  }
  if (f === 'win-depth') {
    const v = fromUnits(Number(e.target.value), project.units);
    const step = windowsStep();
    if (step && v > 0) commit(() => (step.params = { ...step.params, depth: round(v, 3) }));
    return;
  }
  if (f.startsWith('bk-')) {
    const key = f.slice(3);
    const raw = Number(e.target.value);
    const v = key === 'draft' ? raw : fromUnits(raw, project.units);
    if (!Number.isFinite(v) || (v < 0 && !key.startsWith('trim') && !key.startsWith('cabin'))) return renderPanel();
    return setBuckSetting(key, round(v, 3));
  }
  if (f === 'post-type') {
    postOptions().type = e.target.value;
    return refreshPosts();
  }
  if (f === 'pe-from') {
    const t = postTypeById(e.target.value);
    ui.postDraft = { ...typeSizes(t), id: t.builtin ? null : t.id, name: t.builtin ? `My ${t.name}` : t.name };
    return renderPanel();
  }
  if (f === 'pe-name') {
    postDraft().name = e.target.value.trim() || 'My post';
    return;
  }
  if (f.startsWith('pe-') || f.startsWith('pt-') || ['post-length', 'post-float', 'post-base'].includes(f)) {
    const v = fromUnits(Number(e.target.value), project.units);
    if (!Number.isFinite(v) || v < 0) return renderPanel();
    if (f.startsWith('pe-')) postDraft()[f.slice(3)] = v;
    else if (f.startsWith('pt-')) {
      postDraft();
      if (v > 0) ui.postTest[f.slice(3)] = v;
    } else {
      const o = postOptions();
      if (f === 'post-length' && v > 0) o.length = v;
      if (f === 'post-float') o.float = v;
      if (f === 'post-base') o.base = v;
      return refreshPosts();
    }
    return renderPanel();
  }
  if (f.startsWith('st-') || f.startsWith('ar-')) {
    const v = Number(e.target.value);
    if (!Number.isFinite(v)) return;
    (f.startsWith('st-') ? stretchOptions() : archOptions())[f.slice(3)] = fromUnits(v, project.units);
    return renderPanel();
  }
  const v = Number(e.target.value);
  const u = project?.units;
  if (f === 'scale-from') ui.scale.from = v;
  else if (f === 'scale-to') ui.scale.to = v;
  else if (f === 'scale-factor') ui.scale.factor = v;
  else if (f === 'scale-length') ui.scale.length = fromUnits(v, u);
  else if (f === 'slice-at') {
    ui.slice.at = fromUnits(v, u);
    applyGuide();
  } else if (f === 'floor-at') {
    ui.floor.at = fromUnits(v, u);
    return renderPanel();
  } else if (f === 'floor-blend') {
    if (v > 0) ui.floor.blend = fromUnits(v, u);
    return renderPanel();
  } else if (f === 'hollow-wall') {
    if (v > 0) hollowOptions().wall = snapWall(fromUnits(v, u));
    return renderPanel();
  } else if (f === 'hollow-top') {
    if (v > 0) hollowOptions().top = snapWall(fromUnits(v, u));
    return renderPanel();
  } else if (f === 'paint-wall') {
    if (v > 0) ui.paint.wall = snapWall(fromUnits(v, u));
    return renderPanel();
  } else if (f === 'material') {
    commit(() => (project.print = { ...project.print, material: e.target.value }), false);
    return;
  } else if (f === 'nozzle') {
    if (v > 0) commit(() => (project.print = { ...project.print, nozzle: v }), false);
    ui.hollow = null;
    return;
  } else if (f.startsWith('fix-')) {
    fixOptions()[f.slice(4)] = e.target.checked;
    return;
  } else if (f === 'reduce-keep') {
    ui.reduce.keep = Math.min(95, Math.max(5, v));
    return renderPanel();
  } else if (f === 'reduce-tol') {
    if (v > 0) ui.reduce.tolerance = fromUnits(v, u);
    return renderPanel();
  } else if (f === 'orient-yaw') {
    if (Number.isFinite(v) && Math.abs(v) <= 180) setOrient({ turn: v });
    return;
  } else if (f === 'slice-cap') {
    ui.slice.cap = e.target.checked;
    return;
  } else if (f === 'slice-gap') {
    if (v >= 0) ui.slice.gap = fromUnits(v, u);
    return;
  } else if (f === 'cut-w' || f === 'cut-h') {
    const c = ui.cutoff.cuts[ui.cutoff.active];
    if (c && v > 0) c[f === 'cut-w' ? 'w' : 'h'] = round(fromUnits(v, u), 4);
    renderPanel();
    return applyGuide();
  } else if (f === 'solid-flat') {
    ui.solid.flat = e.target.checked;
    renderPanel();
    return;
  } else if (f === 'solid-bottom') {
    const v = fromUnits(parseFloat(e.target.value), project.units);
    if (Number.isFinite(v)) ui.solid.bottom = v;
    return applyGuide();
  } else if (f === 'cut-mirror' || f === 'cut-open') {
    ui.cutoff[f === 'cut-mirror' ? 'mirror' : 'open'] = e.target.checked;
    renderPanel();
    return applyGuide();
  } else if (f === 'slice-tilt') {
    if (Number.isFinite(v) && Math.abs(v) <= 80) ui.slice.tilt = v;
    renderPanel();
    return applyGuide();
  } else if (f === 'smooth-edges') {
    smoothOptions().keepEdges = e.target.checked;
    return;
  } else if (f === 'front-only') ui.frontOnly[ui.pointer] = e.target.checked;
  else return;
  if (f.startsWith('scale') || f === 'slice-at') renderPanel();
});

// Pointing at a part or an opening in a list shows it on the car.
document.addEventListener('mouseover', (e) => {
  const partRow = e.target.closest?.('[data-part]');
  const loopRow = e.target.closest?.('[data-loop]');
  if (partRow) {
    const c = lookups.check.value;
    if (!c || lookups.check.token !== buildToken) return;
    const id = Number(partRow.dataset.part);
    const mask = new Uint8Array(c.partOf.length);
    for (let f = 0; f < mask.length; f++) mask[f] = c.partOf[f] === id ? 1 : 0;
    viewport.paintSelection(mask, [0.23, 0.61, 1]);
  } else if (loopRow) {
    hoverLoop = Number(loopRow.dataset.loop);
    drawOpenings(true);
  }
});
document.addEventListener('mouseout', (e) => {
  if (e.target.closest?.('[data-part]') && !e.relatedTarget?.closest?.('[data-part]')) viewport.paintSelection(selection);
  if (e.target.closest?.('[data-loop]') && !e.relatedTarget?.closest?.('[data-loop]')) {
    hoverLoop = null;
    drawOpenings(ui.panel === 'openings' && !ui.editStep);
  }
});

// Put a chassis (from the library or a file) on this body.
function useChassis(data, stlBytes, stlName) {
  commit(() => {
    const c = { ...data };
    // Keep the axles where the arches are, if the chassis's own position is off this body.
    const a = lookups.arches.token === buildToken ? lookups.arches.value : null;
    if (a?.arches.length) c.frontX = round(a.arches[0].x, 2);
    if (stlBytes) {
      c.stl = { fileName: stlName ?? data.stl?.fileName ?? 'chassis.stl', flip: !!data.stl?.flip, along: data.stl?.along ?? 0, height: data.stl?.height ?? 0.5 };
      project.chassisMesh = { fileName: c.stl.fileName, bytes: stlBytes.buffer ? stlBytes.buffer.slice(stlBytes.byteOffset, stlBytes.byteOffset + stlBytes.byteLength) : stlBytes };
    } else {
      delete c.stl;
      project.chassisMesh = null;
    }
    project.chassis = c;
  }, false);
  ui.look.chassis = true;
  drawGhost();
}

$('#chassis-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const { chassis, stl } = decodeChassisFile(await file.text());
    useChassis(chassis, stl, chassis.stl?.fileName);
    const id = await libraryChange((db) => saveChassis(db, chassis, stl), `${chassis.name} added to your library.`);
    if (id) commit(() => (project.chassis = { ...project.chassis, libId: id }), false);
  } catch (err) {
    toast(err.message, 'bad');
  }
});

$('#chassis-stl').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const bytes = await file.arrayBuffer();
    readSTLMesh(bytes); // refuse a broken file before keeping it
    commit(() => {
      if (!project.chassis) project.chassis = suggestChassis(lookups.arches.value);
      project.chassis = { ...project.chassis, stl: { fileName: file.name, flip: false, along: 0, height: 0.5 } };
      project.chassisMesh = { fileName: file.name, bytes };
    }, false);
    ui.look.chassis = true;
    drawGhost();
    toast('Chassis STL loaded. If it faces the wrong way, use "Turn it around".');
  } catch (err) {
    toast(`That chassis file could not be read: ${err.message}`, 'bad');
  }
});

$('#name').addEventListener('change', (e) => {
  const name = e.target.value.trim() || 'Body';
  if (name !== project.name) commit(() => (project.name = name), false);
});
$('#name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') e.target.blur();
});

$('#part-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file || !project) return;
  try {
    await loadPart(file.name, file.name.replace(/\.stl$/i, ''), await file.arrayBuffer());
  } catch (err) {
    toast(err.message, 'bad');
  }
});

$('#file').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (file) openFile(file);
});

// Drop a file anywhere on the window.
const view = $('#view');
window.addEventListener('dragover', (e) => {
  e.preventDefault();
  view.classList.add('drag');
});
window.addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) view.classList.remove('drag');
});
window.addEventListener('drop', (e) => {
  e.preventDefault();
  view.classList.remove('drag');
  const file = e.dataTransfer?.files?.[0];
  if (file) openFile(file);
});

document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
  const ctrl = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (ctrl && key === 'z' && !e.shiftKey && !typing) return e.preventDefault(), actions.undo();
  if (ctrl && (key === 'y' || (key === 'z' && e.shiftKey)) && !typing) return e.preventDefault(), actions.redo();
  if (ctrl && key === 's') return e.preventDefault(), actions.save();
  if (ctrl && key === 'o') return e.preventDefault(), actions.open();
  if (typing || !result) return;
  if (ui.win.draft) {
    if (e.key === 'Backspace' || e.key === 'Delete') {
      const d = ui.win.draft;
      d.points.pop();
      d.corners.pop();
      d.normals.pop();
      return e.preventDefault(), renderPanel();
    }
    if (e.key === 'Enter') return actions['win-finish']();
    if (e.key === 'Escape') return actions['win-cancel']();
  }
  if (ui.win.editing && (e.key === 'Escape' || e.key === 'Enter')) return actions['win-done']();
  if (e.key === 'Delete' || e.key === 'Backspace') return deleteSelected();
  if (e.key === 'Escape') {
    if (ui.measure.length || ui.measure.wall) clearMeasure(), renderPanel();
    else if (selectedCount) actions['sel-clear']();
    else actions.pointer('look');
  }
  if (key === 'f') viewport.view(ui.lastView);
});

// ------------------------------------------------------------ messages

function toast(text, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = text;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), kind === 'bad' ? 7000 : 4500);
}

// ------------------------------------------------------------ theme

// The SlotForge app theme, shared with the other apps on this computer
// (src/app-theme.js, as in Foundry). index.html applies it before the first paint.
let themeState = loadTheme();
function syncTheme() {
  applyThemeState(themeState);
  for (const b of document.querySelectorAll('[data-act^="theme-"]'))
    b.setAttribute('aria-pressed', String(b.dataset.act === 'theme-' + themeState.theme));
  viewport.retheme();
}
function chooseTheme(theme) {
  themeState = { ...themeState, theme };
  saveTheme(themeState);
  syncTheme();
}
syncTheme();
// Another SlotForge app (or window) changed the shared theme.
addEventListener('storage', (e) => {
  if (e.key !== THEME_STORAGE_KEY || !e.newValue) return;
  themeState = readTheme(e.newValue);
  syncTheme();
});
actions['theme-light'] = () => chooseTheme('light');
actions['theme-dark'] = () => chooseTheme('dark');

// ------------------------------------------------------------ settings

// Settings (desktop app): Updates, the shared SlotForge update card (update-ui.js).
// The update window itself opens by itself when a newer version is published.
let settingsBox = null;
function settingsDialog() {
  if (settingsBox) return settingsBox;
  settingsBox = document.createElement('dialog');
  settingsBox.className = 'update-dialog settings-dialog';
  settingsBox.setAttribute('aria-labelledby', 'settings-title');
  settingsBox.innerHTML = `<div class="dialog-heading"><div><p class="help-crumb">SlotForge Anvil</p><h2 id="settings-title">Settings</h2></div>
    <button type="button" class="btn quiet" aria-label="Close">✕</button></div><div class="settings-body"></div>`;
  settingsBox.querySelector('.btn.quiet').onclick = () => settingsBox.close();
  settingsBox.querySelector('.settings-body').append(updatesHolder);
  document.body.append(settingsBox);
  return settingsBox;
}
const updatesHolder = document.createElement('div');
updatesHolder.className = 'st-updates';
globalThis.UpdateUI?.start({
  settings: updatesHolder,
  say: (message, bad) => toast(message, bad ? 'bad' : ''),
  appName: 'Anvil',
  keeps: 'your projects, library and settings stay where they are',
});

// ------------------------------------------------------------ start

renderAll();
const devOpen = import.meta.env.DEV && new URLSearchParams(location.search).get('open');
if (devOpen) {
  // Development only: open a test model by URL (see vite.config.js).
  fetch(devOpen)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(Error(`Could not fetch ${devOpen}`))))
    .then((b) => openFile(new File([b], decodeURIComponent(devOpen.split('/').pop()))))
    .catch((e) => toast(e.message, 'bad'));
} else {
  loadLocal()
    .then((saved) => {
      if (saved?.source?.bytes && Array.isArray(saved.steps))
        return startProject({
          name: saved.name,
          units: saved.units,
          mirror: saved.mirror,
          print: saved.print,
          chassis: saved.chassis ?? null,
          chassisMesh: saved.chassisMesh ?? null,
          buck: saved.buck ?? null,
          parts: saved.parts ?? {},
          protect: saved.protect !== false,
          source: saved.source,
          steps: saved.steps,
        });
    })
    .catch(() => {});
}
