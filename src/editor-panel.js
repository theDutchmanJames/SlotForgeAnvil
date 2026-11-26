// Panels for Body shaping, Feature layout, step names and notes, and the
// build sheet. main.js hands in what they need through `api`; nothing here
// changes the project except through api.commit, so undo always works.
import { arrangeFeatures, layoutItems, shapeSteps, stepMetadata, stepName, supportsLayout } from './editor-operations.js';
import { buildSheet, escapeHTML as esc } from './build-sheet.js';
import { fromUnits, toUnits, snapshot } from './project.js';

const round = (v, d = 3) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : v);

export function createEditorTools(api) {
  // shape: the shaping fields being typed (mm and %), for the step in shapeKey.
  // generation: bumped whenever a preview stops; a late preview reply then knows it is stale.
  let shape = null,
    shapeKey = null,
    generation = 0,
    previewing = false;
  let layout = { step: '', item: 'all', x: 0, y: 0, z: 0, count: 1 };
  let search = '';

  const field = (key, label, value, unit = '') =>
    `<span class="fx">${label}<span class="num"><input type="number" step="any" data-editor="${key}" value="${esc(value)}" aria-label="${esc(label)}">${unit ? `<small>${esc(unit)}</small>` : ''}</span></span>`;
  const status = (text) => {
    const el = document.querySelector('#editor-preview-status');
    if (el) el.textContent = text;
  };

  function stopPreview() {
    generation++;
    if (previewing) {
      previewing = false;
      api.restoreView();
    }
    status('');
  }
  function reset() {
    stopPreview();
    shape = shapeKey = null;
    search = '';
    const input = document.querySelector('[data-editor="search"]');
    if (input) input.value = '';
    layout = { step: '', item: 'all', x: 0, y: 0, z: 0, count: 1 };
  }

  function shapePanel(editing) {
    const p = api.project(),
      r = api.result(),
      key = editing?.id ?? 'new',
      u = p.units;
    if (!r) return `${api.head('Body shaping', 'Waiting for the model…')}`;
    if (!shape || key !== shapeKey) {
      const b = r.stats.bounds;
      shape = editing ? { ...editing.params } : { from: round(b.min[0]), to: round(b.max[0]), blend: round(Math.max(0.05, b.size[0] * 0.15)), base: round(b.min[2]), front: 0, rear: 0, height: 0 };
      shapeKey = key;
    }
    const len = (k, label) => field(`shape-${k}`, label, round(toUnits(shape[k], u), u === 'in' ? 4 : 2), u);
    const pct = (k, label) => field(`shape-${k}`, label, shape[k], '%');
    return `${api.head(editing ? 'Change body shaping' : 'Body shaping', 'Taper or widen a stretch of the body, and raise or lower it above a chosen height. Both ends fade smoothly to no change. X runs from the nose back; width changes the same on both sides.')}
    <div class="f">Region<div class="g2">${len('from', 'Starts at X')}${len('to', 'Ends at X')}${len('blend', 'Blend at each end')}</div></div>
    <div class="f">Width<div class="g2">${pct('front', 'Change at the front')}${pct('rear', 'Change at the rear')}</div></div>
    <div class="f">Height<div class="g2">${len('base', 'Base height (Z)')}${pct('height', 'Change above the base')}</div><span class="muted" style="font-weight:400;font-size:12px">Below the base nothing moves, so the sills and the floor stay put.</span></div>
    <div class="row"><button class="btn sm" data-editor-act="shape-preview">${api.icon('eye')}Preview</button><button class="btn sm ghost" data-editor-act="shape-cancel">Cancel preview</button><button class="btn primary sm" data-editor-act="shape-apply">${editing ? 'Update shaping' : 'Apply shaping'}</button></div>
    <div class="muted" id="editor-preview-status" role="status" style="font-size:12px"></div>
    <div class="note">Plus makes it bigger, minus smaller. A new shaping step goes before Hollow and the fitted details, so walls are made on the shaped body. Windows, lights, posts and parts already placed do not follow the new shape: check them afterwards. A coarse mesh has fewer points to bend, so its blends are coarser.</div>
    <div class="muted" style="font-size:12px">A project with body shaping needs this version of Anvil or newer to open. To share it with an older Anvil, export the STL.</div>`;
  }

  function layoutPanel() {
    const p = api.project(),
      steps = p.steps.filter(supportsLayout),
      u = p.units;
    if (!steps.some((s) => s.id === layout.step)) {
      layout.step = steps[steps.length - 1]?.id ?? '';
      layout.item = 'all';
    }
    const step = steps.find((s) => s.id === layout.step),
      items = step ? layoutItems(step) : [];
    if (layout.item !== 'all' && Number(layout.item) >= items.length) layout.item = 'all';
    const head = api.head('Feature layout', 'Move posts, lights, windows, text or an added part by an exact amount, or repeat them in a row. Each copy sits one spacing further on. One click is one undo.');
    if (!step) return `${head}<div class="muted" style="font-size:12px">Place posts, lights, windows, text or an added part first.</div>`;
    const len = (k, label) => field(`layout-${k}`, label, round(toUnits(layout[k], u), u === 'in' ? 4 : 2), u);
    const itemName = (item, i) => item.name || item.label || (step.type === 'addpart' ? stepName(step) : `${stepName(step)} ${i + 1}`);
    return `${head}
    <div class="f">Placement step<select class="num" style="width:100%" data-editor="layout-step">${steps.map((s) => `<option value="${esc(s.id)}"${s.id === layout.step ? ' selected' : ''}>${esc(stepName(s))}${s.enabled ? '' : ' (off)'}</option>`).join('')}</select></div>
    ${step.type === 'addpart' ? '' : `<div class="f">Feature<select class="num" style="width:100%" data-editor="layout-item"><option value="all">All ${items.length} in this step</option>${items.map((item, i) => `<option value="${i}"${String(i) === layout.item ? ' selected' : ''}>${i + 1}: ${esc(itemName(item, i))}</option>`).join('')}</select></div>`}
    <div class="f">Offset, or spacing between copies<div class="g2">${len('x', 'X (along)')}${len('y', 'Y (across)')}${step.type === 'posts' ? '' : len('z', 'Z (up)')}${field('layout-count', 'Copies', layout.count)}</div>
      ${step.type === 'posts' ? '<span class="muted" style="font-weight:400;font-size:12px">Posts move in X and Y: their height follows the body.</span>' : ''}</div>
    <div class="row"><button class="btn sm" data-editor-act="layout-move">Move</button><button class="btn primary sm" data-editor-act="layout-copy">Repeat</button></div>
    <div class="note">${p.mirror ? 'Mirror is on: a light or text and its other side move together, mirrored across. ' : ''}Positions are measured as they are at this step. Lights, text and window outlines keep the direction they face and are not laid onto another panel: check them on curved panels. Copies are separate features, not linked.</div>`;
  }

  function metadataPanel(step) {
    const open = step.editor?.name || step.editor?.notes ? ' open' : '';
    return `<details class="editor-metadata"${open}><summary>Step name and notes</summary>
      <div class="f">Name<input type="text" maxlength="80" data-editor="step-name" value="${esc(step.editor?.name || '')}" placeholder="${esc(stepName({ type: step.type }))}"></div>
      <div class="f">Notes<textarea rows="3" maxlength="1200" data-editor="step-notes">${esc(step.editor?.notes || '')}</textarea></div>
      <div class="row"><button class="btn sm" data-editor-act="step-save">Save name and notes</button></div></details>`;
  }

  document.addEventListener('input', (e) => {
    const key = e.target.dataset?.editor;
    if (key === 'search') {
      search = e.target.value;
      api.renderSteps();
    }
    if (key?.startsWith('shape-')) stopPreview();
  });
  // Every other tool works on the committed body, never on the preview.
  document.addEventListener('click', (e) => e.target.closest?.('[data-act]') && stopPreview(), true);
  document.addEventListener('change', (e) => e.target.dataset?.field && stopPreview(), true);
  document.addEventListener('change', (e) => {
    const key = e.target.dataset?.editor;
    if (!key || !api.project()) return;
    const raw = String(e.target.value).trim(),
      v = raw === '' ? NaN : Number(raw);
    if (key.startsWith('shape-')) {
      stopPreview();
      const k = key.slice(6);
      shape[k] = ['front', 'rear', 'height'].includes(k) ? v : round(fromUnits(v, api.project().units), 4);
    } else if (key === 'layout-step' || key === 'layout-item') {
      layout[key.slice(7)] = e.target.value;
      if (key === 'layout-step') layout.item = 'all';
      api.render();
    } else if (key.startsWith('layout-')) {
      const k = key.slice(7);
      layout[k] = k === 'count' ? v : round(fromUnits(v, api.project().units), 4);
    }
  });
  document.addEventListener('click', async (e) => {
    const button = e.target.closest?.('[data-editor-act]');
    if (!button || !api.project() || api.busy()) return;
    const act = button.dataset.editorAct;
    try {
      if (act === 'shape-cancel') return stopPreview();
      if (act === 'shape-preview' || act === 'shape-apply') {
        const p = api.project(),
          editing = api.editing(),
          steps = shapeSteps(p.steps, shape, editing?.id);
        stopPreview();
        if (act === 'shape-apply') {
          const id = editing?.type === 'bodyshape' ? editing.id : steps.find((s) => !p.steps.some((old) => old.id === s.id)).id;
          api.commit(() => {
            p.steps = steps;
            api.selectStep(id);
          });
          return;
        }
        const ticket = generation,
          before = snapshot(p);
        status('Building the preview…');
        const result = await api.preview(steps);
        // Stale: stopped, another project, or the project changed meanwhile.
        if (ticket !== generation || p !== api.project() || before !== snapshot(p)) return;
        const errors = result.results.filter((r) => r.state === 'error');
        if (errors.length) throw Error(errors.map((r) => r.error).join(' '));
        api.showPreview(result);
        previewing = true;
        status('Preview only: Apply shaping keeps it, Cancel preview goes back.');
      } else if (act === 'layout-move' || act === 'layout-copy') {
        const p = api.project(),
          source = p.steps.find((s) => s.id === layout.step);
        const steps = arrangeFeatures(p.steps, layout.step, {
          item: layout.item,
          mode: act === 'layout-move' ? 'move' : 'copy',
          count: layout.count,
          delta: [layout.x, layout.y, source?.type === 'posts' ? 0 : layout.z],
          mirror: !!p.mirror,
        });
        api.commit(() => (p.steps = steps));
      } else if (act === 'step-save') {
        const step = api.editing();
        if (!step) return;
        const m = stepMetadata(document.querySelector('[data-editor="step-name"]')?.value, document.querySelector('[data-editor="step-notes"]')?.value);
        api.commit(() => {
          if (m.name || m.notes) step.editor = { ...step.editor, ...m };
          else delete step.editor;
        }, false);
      } else if (act === 'build-sheet') {
        const r = api.result();
        if (!r) return;
        api.download(buildSheet(api.project(), r));
      }
    } catch (error) {
      status('');
      api.error(error.message);
    }
  });

  return {
    shapePanel,
    layoutPanel,
    metadataPanel,
    stopPreview,
    reset,
    get search() {
      return search;
    },
  };
}
