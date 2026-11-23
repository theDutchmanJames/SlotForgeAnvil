# Anvil — what to reuse from Foundry

*23 Nov 2026. Based on reading Foundry's source at `..\Foundry\src` (v1.0.0). Nothing was run or changed. Feature codes refer to [features.md](features.md).*

## The short version

Foundry's STL editor works, and its **plumbing** carries over almost whole: reading and writing STL, the background worker, the step list with undo, the viewport, the section cut, brush selection, the library database pattern, settings, theme and packaging.

Its **shape tools** carry over only in part. They were built for clean, flat-faced parts such as track pieces. A car body is a thin, curved shell, often from a rough file. Tools that depend on flat faces (push/pull on a face, hollow from a flat opening, post detection on a flat face) need a new approach or a rework.

The **car-specific features are new**: the inner-wall engine (hollowing, painted thickness, heatmap), heavy repair, ghost chassis and tyres, the surface line tool, windows and bucks.

Levels used below:

- **As is** — copy the file, little or no change.
- **Adapt** — copy and modify; the core logic is right.
- **Idea** — the approach is worth following, the code is too tied to tracks or flat faces.
- **New** — nothing in Foundry to start from.

---

## Plumbing

| Need | Foundry code | Level | Notes |
|---|---|---|---|
| Read / write STL | `stl-mesh.js`, `parseSTL` / `encodeSTL` in `editor.js` | As is | Import must stop rejecting non-solid files; the 1,000,000-triangle cap needs raising |
| Background worker with cancel | `worker-client.js`, `engine.worker.js` | As is | |
| Step list, revise / switch off / delete, replay (A1) | core of `engine.js` (`editBodies`, preview and resume logic), schema checks in `project.js` | Adapt | Remove track, planner and kit branches |
| Undo / redo, autosave (A12) | snapshots in `main.js`, store in `project.js` | Idea | Logic is simple but buried in `main.js`; rewrite cleanly |
| Viewport, preset views (A3) | `viewport.js`, `view-orientation.js`, `view-selector.js` | Adapt | Strip track colours and overlays. Add perspective toggle and fast picking (three-mesh-bvh) |
| Section cut (A3, D2) | `geometry/section-view.js`, `section-control.js` | As is | Exactly what is needed to look at the wall |
| Crease lines on the model | `surface-features.js` | Adapt | Also a starting point for snap-to-crease in the line tool (A9) |
| Brush and lasso selection (A4) | `mesh-paint.js`, grow / shrink in `mesh-sculpt.js` | Adapt | Selects visible triangles only; "select through" and mirrored selection are new |
| Flat-region and connected selection (A4) | `surfaceRegion` in `editor.js`, `face-selection.js` | As is | |
| Move / rotate / scale / mirror, drag handle | `transformPair` in `engine.js`, `solid-move-handle.js`, `solid-move.js` | As is | The handle also serves ghost tyres, posts, add-on parts and driver busts |
| Library database (A6) | `library-database.js`, `library-store.js`, `library-dialog.js` | Adapt | sql.js setup, versioned schema, file import/export with checks are reusable. All tables are track-specific and need replacing; the `stl_parts` shelf is close to what add-on parts need |
| Settings, printers, materials (I2) | `settings.js` | Adapt | Has FDM printer plates and filament densities (used for weight). Resin printers and resins are missing |
| Theme and look | `theme.css`, `app-theme.js`, `ui.js` | As is | Keeps the SlotForge family look |
| Build, offline single file, desktop shell, updates | `vite.config.js`, `desktop/main.cjs`, `update-ui.js`, packaging config | As is | |
| Tests | `tests/*.test.js` for the files above | As is | Geometry tests run directly in Node |
| App shell, panels, state | `main.js` (5,453 lines), `inspector.js` | New | Not reusable; redesign in the UX phase |

## Prepare (B)

| Feature | Foundry code | Level | Notes |
|---|---|---|---|
| B1 Check | `analyseMesh` in `mesh-topology.js` | Adapt | Already finds open edges, loose parts, flipped areas. Add the plain-language verdict and model classification |
| B2 Light fix | `mesh-repair.js`, `capBoundaries` | Adapt | Fills holes with flat caps only. Curved hole filling is new |
| B2 Rebuild ("make solid") | none | New | The grid-based kernel |
| B2a Parts list | `separate` in `engine.js` (splits loose bodies) | Adapt | |
| B2b Change map | none | New | |
| B2c Triangle reduction | `simplifySolid` in `geometry/shell-simplify.js` | As is | |
| B3 Orient and scale | transform step, "lay face on plate", "calibrate scale" from a measured distance | Adapt | Auto-orientation and symmetry detection are new |
| B5 Make symmetrical | mirror plus `combineBodies` | Idea | |
| B6 Smooth facets | none | New | |

## Fit to chassis (C)

| Feature | Foundry code | Level | Notes |
|---|---|---|---|
| C1 Ghost chassis, C1b ghost tyres | `reference-car-mesh.js`, `setReferenceCar` in `viewport.js` (draws a non-exported scale model) | Idea | The "display only, never exported" mechanism is the same |
| C1a Chassis STL as ghost | STL import | Adapt | Finding axles and posts in it is new |
| C3 Wheel arches | cylinder cuts via existing booleans | Adapt | Arch detection is new |
| C5 Wheelbase stretch, D0 Squish | `stretchReference` in `geometry/heal-stretch.js` | Adapt | **Closest match in Foundry.** It cuts the part at two planes, scales the middle and moves the ends rigidly, which is the same principle. Missing: smooth blending at the cuts, keeping arches round, and it needs a clean solid |
| C4 Clearance check | boolean intersect | Idea | |

## Shell (D)

| Feature | Foundry code | Level | Notes |
|---|---|---|---|
| D1 Hollow | `hollowFromOpening` in `geometry/shell-simplify.js` | New | Foundry's version needs a flat opening face and uses a slow exact method. Not suitable for curved bodies |
| D2 Heatmap, D3 paint thickness, D3b lighten the top | none | New | |
| D4 Weight | volume per part and material densities already computed | Adapt | |
| D6 Ribs | `geometry/reinforcement.js` | Idea | Track-specific |

## Clean and shape (E)

| Feature | Foundry code | Level | Notes |
|---|---|---|---|
| E1 Remove and patch | `mesh-sculpt.js` ("remove and patch"), `healFeature` in `heal-stretch.js` | Adapt | Patches are flat; smooth patch is new |
| E2 Smooth | `smoothPatch` in `mesh-sculpt.js` | Adapt | Works on a selection, with edge protection. A live brush and non-shrinking smoothing are new |
| E3 Slice | `splitOp`, `trimFace` in `editor.js` | As is | |
| E4 Join, E8 add part from file | `combineBodies`, `alignmentMatrix` in `geometry/assembly.js` | As is | |
| E5 Push / pull | `editFaceHeights` in `editor.js`, `face-handle.js` | Adapt | Flat faces only. Soft pull on curved panels is new |
| E6 Fill | `capBoundaries` | Idea | Flat only |
| E9 Cut along a line, E12 engrave a line | `text-relief.js` (raised or engraved text, also on curved surfaces), `profileEdit` | Idea | Worth studying how text follows a curved surface |
| E10 Arch flare, E11 thin-part check | none | New | |

## Mounting (F)

| Feature | Foundry code | Level | Notes |
|---|---|---|---|
| F1 Add post, F3a post editor | cylinders in `geometry/create-solids.js`, holes in `create-features.js` and `hole-modify.js` | Adapt | Growing a post up to a curved inner surface is new |
| F2 Remove post | `geometry/post-selection.js` | Idea | Finds posts standing on a flat face. Posts under a curved roof need another method |
| F3e Fit test piece | `fit-samples.js` | Idea | Same purpose, but the code is all track joints. Zip packing (fflate) is reusable |

## Windows and bucks (G, H)

| Feature | Foundry code | Level | Notes |
|---|---|---|---|
| A9 Surface line tool | Bézier handling in `drawings/curves.js` and the sketcher | Idea | Those are flat 2D curves; curves lying on a body are new |
| G3 Open window | extrude a 2D outline and subtract (`profileEdit`) | Adapt | Works once the outline exists; wraparound glass needs more |
| G5 Close window | none | New | Needs smooth curved fill |
| H1 Window buck, H2 release check | `wall-edge-modify.js` has draft on flat walls | New | |

## Check and export (I)

| Feature | Foundry code | Level | Notes |
|---|---|---|---|
| I1 Export, zipped kit | `encodeSTL`, `printableSTL` and `packKit` in `kit.js` | Adapt | `kit.js` is tied to track parts; keep the packing approach |
| Fit on the print plate | `geometry/plate.js` | As is | |
| I0 Final check, I3 rules | none | New | |

---

## Count

| Level | Feature rows |
|---|---|
| As is | 14 |
| Adapt | 21 |
| Idea | 10 |
| New | 13 |

The 13 "new" rows are a minority by count but hold most of the difficult work: the grid kernel behind repair, hollowing and bucks, plus the surface line tool.

## Three gaps to plan around

1. **Foundry refuses anything that is not a clean closed solid.** Anvil must accept everything and repair it. Manifold, the kernel Foundry uses for all cutting and joining, has the same requirement, so repair has to come before any Foundry-derived tool is used.
2. **No fast picking.** Foundry tests every triangle on each click. Fine for track parts, too slow for brushing on a dense body.
3. **Flat-face assumptions** run through push/pull, hollow, post detection, hole filling and draft.

## Suggested way to start

Copy the plumbing first and get a body on screen with section cut, selection and the step list working. Then build the new inner-wall engine as a separate module beside it. That gives a usable base early and keeps the risky work isolated.
