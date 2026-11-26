// Build sheet: a standalone HTML page with the recipe and the current mesh,
// to keep with the print or print out. Everything from the project is escaped;
// no STL is embedded.
import { MATERIALS, fmtLen, STEP_NAMES } from './project.js';
import { stepName } from './editor-operations.js';

export const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function buildSheet(project, result, now = new Date()) {
  const esc = escapeHTML,
    stats = result.stats,
    units = project.units;
  const len = (v) => fmtLen(v, units);
  const material = MATERIALS[project.print?.material];
  const mass =
    stats.openEdges === 0 && stats.faultyEdges === 0 && Number.isFinite(stats.volume) && stats.volume > 0 && material
      ? `${((stats.volume / 1000) * material.density).toFixed(2)} g (estimated from the mesh volume)`
      : 'Not available: needs a closed mesh and a known material';
  const states = new Map(result.results.map((r) => [r.id, r]));
  const c = project.chassis;
  const rows = project.steps
    .map((s, i) => {
      const r = states.get(s.id);
      return `<tr><td>${i + 2}</td><td>${esc(stepName(s))}<small>${esc(STEP_NAMES[s.type] || s.type)}</small></td><td>${esc(s.enabled ? (r?.state ?? 'not built') : 'off')}</td><td>${esc(s.editor?.notes || '')}${r?.error ? `<p class="bad">${esc(r.error)}</p>` : ''}${(r?.info?.warnings ?? []).map((w) => `<p class="warn">${esc(w)}</p>`).join('')}<details><summary>Settings (mm unless stated)</summary><pre>${esc(JSON.stringify(s.params, null, 2))}</pre></details></td></tr>`;
    })
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(project.name)}: Anvil build sheet</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:1100px;margin:32px auto;padding:0 20px;color:#20262c;background:#fff}table{width:100%;border-collapse:collapse}th,td{text-align:left;vertical-align:top;padding:10px;border:1px solid #ccd3da}small{display:block;color:#555}pre{white-space:pre-wrap;overflow-wrap:anywhere}h1{margin-bottom:0}.bad{color:#b3261e}.warn{color:#8a5a00}@media print{details>pre{display:block}tr{break-inside:avoid}body{margin:0}}</style></head>
<body><h1>${esc(project.name)}</h1><p>SlotForge Anvil build sheet · ${esc(now.toISOString())}</p><p>Source: ${esc(project.source.fileName)}. Units: ${esc(units)}.</p>
<h2>Body and print</h2><p>Length × width × height: ${stats.bounds.size.map(len).map(esc).join(' × ')}<br>Material: ${esc(material?.name ?? project.print?.material ?? 'unknown')} · Process: ${esc(project.print?.process ?? 'unknown')}<br>Printed weight: ${esc(mass)}<br>Mesh: ${esc(stats.triangles)} triangles · ${esc(stats.openEdges)} open edges · ${esc(stats.faultyEdges)} faulty edges.</p>
<p>The weight leaves out separately exported parts, lenses, bucks, hardware, paint and glazing; overlapping pieces can make it too high. This sheet records the mesh and the recipe. It does not check wall thickness, chassis clearance or fit: run Final check and look in the slicer before printing.</p>
<h2>Chassis</h2><p>${c ? `${c.name ? `${esc(c.name)} · ` : ''}Wheelbase ${esc(len(c.wheelbase))} · front axle at X ${esc(len(c.frontX))} · deck ${esc(len(c.deck))} · ground clearance ${esc(len(c.clearance))}` : 'No chassis set up.'}</p>
<h2>Steps</h2><table><thead><tr><th>#</th><th>Step</th><th>State</th><th>Notes and settings</th></tr></thead><tbody><tr><td>1</td><td>Import<small>${esc(project.source.fileName)}</small></td><td>ok</td><td></td></tr>${rows}</tbody></table></body></html>`;
}
