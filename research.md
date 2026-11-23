# Anvil — research

*Concept phase, 23 Nov 2026. No code yet. This records what was researched, what it means for the app, and what is still open.*

Anvil is a focused STL editor that turns "any car model from the internet" into a printable slot car body. It is not a general 3D editor: every tool exists because a slot car builder needs it.

**How to read the evidence.** Three research passes fed this document: the slot car community (forums, rulebooks, shops), the mesh-editing technology, and a read-through of Foundry's code. Markers used below:

- **[found]** — read in a source during this research (links at the end).
- **[excerpt]** — from search-result excerpts only; SlotForum and HRW Forum blocked full page reads.
- **[inference]** — our own reasoning, not confirmed by a source.

---

## 1. Headline conclusions

1. **The gap is real.** No slot-car-specific body tool was found. Builders combine Tinkercad, Blender, Fusion 360, Meshmixer and slicer tricks, and Meshmixer (the tool closest to what they need) is no longer developed. **[found]**
2. **The number one pain is hollowing**, not editing. Getting a thin, even shell (about 0.8–1.0 mm) out of a solid or messy model is what people fail at most. Chassis fit comes second, posts third, windows fourth.
3. **Everything on the wish list is feasible.** Most of it is easy to moderate. The two hard items are cutting windows where the model has no window geometry, and generating a window buck. Both have a workable approach (sections 5 and 6).
4. **Accuracy depends on one design rule: never touch the outer skin unless the user asks.** The visible surface stays exactly as imported. Inner surface, posts, bucks and cut-outs are all derived from it. That way even a rough voxel-based step costs nothing visible.
5. **Foundry gives a real head start**: its geometry core can be copied. Its hollowing, repair and picking are too limited for dense, dirty car models and need replacing (section 7).

---

## 2. What the slot car world needs

### 2.1 Numbers that matter

| | 1/32 | 1/24 |
|---|---|---|
| Max body width | 64 mm (BSCRA sports/GT/saloon); one club 60 mm **[found]** | 83 mm (BSCRA), 82.6 mm / 3.25 in (US clubs) **[found]** |
| Wheelbase range of adjustable chassis | about 64–90 mm (Slot.it HRS2, Slot Classic) **[found]** | 101.6 mm (4.0 in) and 114.3 mm (4.5 in) common **[found]** |
| Rear ground clearance | 0.5 mm minimum (BSCRA, NZSCA); chassis around 1.3–1.6 mm **[found]** | 0.5 mm minimum **[found]** |
| Typical printed body weight | 11–20 g good, 25–30 g heavy, 33 g "accident" **[excerpt]** | 35 g *minimum* in one US hardbody class **[found]** |

Little was found for 1/43 and HO. A Carrera GO car is about 100 × 40 × 30 mm; an AFX Mega G+ long wheelbase is 43.1 mm. **[found]**

**Wall thickness.** The consensus for a modelled skin is 0.7–1.0 mm. Resin printers run 0.9–1.0 mm; FDM PLA holds at 1.2 mm; 0.5 mm proved too thin for one print service, which needed 0.7 mm. **[excerpt]**

**Body posts.** Post outside diameter decides the screw: M2.0 under 3.90 mm, M2.3 for 3.95–4.15 mm, M2.6 for 4.15–4.30 mm. Common screws are 2.2 × 9.5 mm (NSR) and M2.2 × 7 mm (Scaleauto). Oversized screws split posts. **[found]** Chassis differ in layout: two posts, three posts, or one central front plus one central rear. Post height is specific to each body and is found today by trial and error. **[excerpt]**

**Glazing.** Clear sheet is vac-formed over a buck. The most cited sheet is 0.5 mm (0.020 in) PETG; PVC of 0.25–0.5 mm is also used. Printed clear windows are widely rejected (layer lines, yellow cast). Layer lines on the buck transfer to the glazing, so the buck must be smooth and printed dense. **[found/excerpt]**

**Rules that touch the body** (they vary by club; BSCRA is used as the reference) **[found]**:

- Motor, chassis, gears and tyres must not be visible from above or through the windows.
- Transparent windows and a 3D driver are required.
- Wheels must be visible from the side up to at least wheel-centre height.
- Width limits as in the table.

### 2.2 What is wrong with downloaded models

- **Solid or far too thick.** Sellers often subtract a mock chassis from a solid body, which leaves heavy shells. Hollowing to a 1 mm skin is reported to save about 80% of the weight. **[excerpt]**
- **The slicer "shrink a copy" hack fails.** Scaling a duplicate down and subtracting it gives correct thickness only on faces square to the axes. Slanted and curved panels come out wrong. **[excerpt]**
- **Broken meshes.** Surface-only models with no thickness, scans "full of voids", files with "thousands of errors" that defeat Meshmixer. **[found/excerpt]**
- **Does not fit a chassis.** Files are "roughly scale correct, not to fit a specific chassis". People scale in the slicer to hit a wheelbase, which distorts width. **[excerpt]**
- **No posts.**
- **Wheel arches the wrong size**, especially after rescaling between scales. Tyre rub is fixed with a grinder. **[excerpt]**
- **Interior, suspension and underbody geometry in the way** (game-derived models). **[found]**
- **Fragile**, particularly across the front and rear arches. Builders add 1 mm ribs there. **[excerpt]**

### 2.3 Pain points, ranked by how often they came up

1. Hollowing to a thin, even shell.
2. Fitting the body to a chassis (wheelbase, width).
3. Mounting posts: none present, and height/position by trial and error.
4. Windows: making the buck, the vac-forming learning curve.
5. Brittleness, crash damage, warping.
6. Wheel arch size and tyre rub.
7. Broken, surface-only or scanned meshes.
8. Support removal and surface finish.
9. General CAD tools being awkward for organic car shapes.

The wish list from the community contact (adjust wall thickness locally, remove areas, smooth, push/pull, slice and join, posts, windows, bucks) matches this ranking closely. What it does not mention, and the research adds, is **chassis fit** and **automatic repair on import**.

---

## 3. Product concept

### 3.1 A guided workflow, not a toolbox

The lesson from existing tools: MeshLab's unguided filter list is the anti-pattern; 3D Builder's one-button "repair?" prompt and the slicers' two-slider hollowing are the models to follow. **[inference from tool survey]**

Proposed stages, each usable on its own and revisitable at any time:

| Stage | What the user does | What the app does |
|---|---|---|
| 1. Import and check | Drops in a file | Analyses it, says in plain words what kind of model it is, offers a one-click fix |
| 2. Orient and scale | Confirms front/up, picks a scale or types a real dimension | Auto-orients, finds the symmetry plane and the wheel arches, shows width against class limits |
| 3. Fit to chassis | Picks a chassis or types wheelbase and track | Shows a ghost chassis with wheels, guide and motor; offers wheelbase stretch and widening |
| 4. Clean | Removes interior, underbody, mirrors, wipers | Selection tools plus "keep outer skin only" |
| 5. Shell | Sets wall thickness, paints thinner or thicker zones | Builds the inner surface, opens the bottom, shows a thickness heatmap and estimated weight |
| 6. Arches and clearance | Drags arch circles, checks tyre and guide clearance | Cuts arches, flags collisions with the ghost chassis |
| 7. Windows | Accepts detected windows or draws outlines | Cuts openings, optional glazing ledge, mirrored left/right |
| 8. Posts and mounts | Clicks post positions (or takes them from the chassis) | Grows posts from the chassis deck up to the inner roof, correct height and screw hole |
| 9. Buck and extras | Asks for a window buck, interior tray buck | Generates printable forming plugs with draft check |
| 10. Export | Picks resin or FDM | Split and key if needed, drain holes, STL/3MF out |

Free tools (smooth brush, push/pull, slice, join, measure) stay available in every stage.

### 3.2 Feature map

| Requested feature | How it would work | Difficulty | Expected accuracy |
|---|---|---|---|
| Wall thickness in chosen areas | Paint a target thickness on the body; only the inner surface moves | Heatmap easy, local edit moderate–hard | About ±0.05–0.1 mm on the inside; outside untouched |
| Remove unwanted areas | Brush, lasso, connected-part and "flat region" selection, then delete and patch; "keep outer skin only" for game models | Easy–moderate | Exact outside the removed area |
| Smooth rough surfaces | Smoothing brush and whole-region smoothing that does not shrink the part (Taubin), with an edge-protect option | Easy globally, moderate as a brush | Depends on triangle quality; long thin triangles need local remeshing first |
| Push / pull faces | Flat regions: extrude along the normal. Curved panels: soft move with falloff | Moderate | Good on flat areas, which are rare on car bodies; soft move is the realistic tool |
| Slice and join | Plane cut with automatic capping, alignment pins, union | Easy once the mesh is repaired | Exact |
| Add / remove body posts | Click to place; post grows to the inner surface; screw hole sized from the post-diameter table. Existing posts detected and removable | Easy | Exact |
| Add / remove windows | Auto-detect where geometry exists, draw outlines where it does not (section 5) | Detection moderate, drawing hard | Outline follows the user's curve exactly |
| Window buck | Section 6 | Hard | Section 6 |

Features the research adds:

- **Chassis fit with a ghost chassis.** Wheelbase stretch that keeps the arches round: the zones around each arch only slide, the zone between them stretches. Width works the same way. Side effect: doors and vents in the stretched zone get slightly longer. **[inference]**
- **Rules and weight readout.** Width against the class limit, estimated printed weight for the chosen material, "can you see the chassis from above" check.
- **Wheel arch tool.** Arches as draggable circles tied to the tyre diameter, with a clearance margin.
- **Arch reinforcement ribs** and optional thicker sills, because that is where bodies break.
- **Symmetry lock.** Every tool mirrors left/right by default. Cars are symmetric, and it halves the work.
- **Interior tray buck**, using the same engine as the window buck.

---

## 4. How accurate can it be across model qualities?

The app should classify every import and say honestly what to expect.

| Class | Typical source | What works | What it costs |
|---|---|---|---|
| A. Clean closed solid | CAD exports, good Printables/Cults files | Everything, at full precision | Nothing |
| B. Already a shell | Slot-car-ready or kit-style files | Everything; thickness can be measured and re-done | Nothing |
| C. Single skin, no thickness | Game-derived surfaces | Must be *thickened inward*, not hollowed. Works if the skin is mostly complete | Gaps need patching first |
| D. Many overlapping parts | Game models with interior, wheels, suspension | "Make solid" rebuild, or "keep outer skin only" | Rebuilt surfaces lose detail finer than the rebuild resolution (soft panel lines) |
| E. 3D scan | Photogrammetry, scanner output | Rebuild plus smoothing | Bumpy surface, holes; the result is only as good as the scan |

**Why the outer skin can stay exact.** Robust repair and hollowing work on a 3D grid (a "voxel" approach, as used inside PrusaSlicer and Blender). A grid fine enough to carry panel lines on a whole body is too heavy: at 0.05 mm a 1/32 body needs about 3.5 billion cells. At 0.1–0.2 mm it is comfortable. The way out is to use the grid only for surfaces nobody sees (the inside of the shell, the buck) and keep the original triangles for the outside. For classes A, B and most of C this means **zero loss on the visible surface**. Only D and E, where the outside itself must be rebuilt, lose fine detail, and the app should show a before/after before the user accepts.

**Automatic detection is a helper, never a gate.** Symmetry plane, orientation, wheel arches and windows will be found automatically on good models and missed on bad ones. Window detection is estimated at 50–70% **[inference]**. Every detection therefore needs a manual fallback that is just as quick: drag a circle, draw an outline.

---

## 5. Windows when the model has no window geometry

**When geometry exists** (separate glass parts, recessed panes, a clear crease around the glass), the app can propose the windows and the user confirms.

**When the windows are fused smoothly into the body**, nothing in the mesh says where the glass is. The user draws it:

1. Click points around the window on the surface; the app joins them with a smooth curve lying on the body.
2. The app builds an invisible cutter by pushing that outline through the wall, and subtracts it. This does not depend on the quality of the triangles under the curve, which is what makes it robust.
3. The outline is mirrored to the other side automatically.
4. Optional: a glazing ledge, cut as a slightly larger second outline to part depth from the inside, so flat or formed glazing has a seat.

**Known difficulty:** wraparound screens. One straight cutter direction distorts the outline at the edges of a strongly curved windscreen. The cutter then has to follow the surface direction locally. This is solvable but is the fiddliest part of the window tool.

**Help for the user:** a side/front photo or blueprint overlay to trace from, and the outline stored as an editable object so it can be nudged later.

---

## 6. Window buck

A buck is the solid plug that clear sheet is vac-formed over. The community describes it as the glass surface copied from the body file with a supporting shape underneath. **[excerpt]**

### The counter-intuitive finding

**A body with solid, filled-in windows is the *easy* case.** The glass surface is already there. The hard case is a model whose windows are already open holes, because the missing surface has to be invented.

This drives a design rule: **Anvil keeps the body as it was before windows were cut.** The buck is always generated from that state plus the window outlines, not from the holed body.

### Pipeline

1. **Get a closed cabin surface.**
   - Windows still solid: use the surface as is.
   - Windows already open: bridge each opening with a smooth fill that continues the curvature of the surrounding body. Large windscreens are the risk here; the fill may come out flatter than the real glass. The user should be able to adjust the bulge.
2. **Choose the buck type.**
   - *One-piece cabin buck* (recommended default): the whole greenhouse as one plug, giving a single glazing insert glued in from inside, as commercial slot cars do. **[inference]**
   - *Per-window bucks*: for flush glazing sitting in the opening.
3. **Trim at the beltline** with a plane or painted boundary.
4. **Move the surface inward** by wall thickness plus sheet thickness, so the formed glazing sits behind the opening and fits inside the shell. Sources did not state this offset; it follows from the geometry. **[inference]**
5. **Remove undercuts and extend to a flat base.** Anything the sheet could not release from is filled straight down in the pull direction.
6. **Add draft and check.** Faces are coloured by release angle so the user sees problem areas.

### Honest limits

- Real cars have tumblehome and A-pillar undercuts. Removing them changes the buck's shape slightly near the beltline. The app must show where and by how much.
- The sheet thins as it draws, so the fit depends on the user's forming setup. A small "fit allowance" setting is needed, plus a printable test.
- Print advice belongs in the export step: dense infill, fine layers, and smoothing, because layer lines transfer to the glazing. **[excerpt]**

The same engine produces an **interior tray buck** (a shallow plug at the beltline with a driver shape), which the rules of many classes make necessary.

---

## 7. Foundry as a starting point

Foundry (`..\Foundry`, "SlotForge Foundry" v1.0.0) is plain JavaScript with Vite, Electron, three.js 0.187 and manifold-3d 3.5.5, built to a single offline HTML file. Its STL editor keeps the source STL plus an ordered list of edit steps and replays them in a Web Worker.

### Worth copying

| Piece | Files | Why |
|---|---|---|
| STL read/write | `src/stl-mesh.js`, parts of `src/editor.js` | Self-contained |
| Mesh analysis and basic repair | `src/mesh-topology.js`, `src/mesh-repair.js` | Finds open edges, flipped parts, loose parts |
| Brush and lasso selection | `src/mesh-paint.js` | Screen-space picking of visible triangles |
| Smoothing and patching | `src/mesh-sculpt.js` | Smoothing with rim and sharp-edge protection |
| Worker plumbing with cancel | `src/worker-client.js`, `src/engine.worker.js` | Keeps the UI responsive during heavy work |
| Edit-history engine | core of `src/engine.js` | Every step can be revised, switched off or deleted |
| Section view | `src/geometry/section-view.js`, `src/section-control.js` | Seeing wall thickness in a cut is essential here |
| Viewport | `src/viewport.js` (trimmed) | Camera, views, picking |
| Reference car | `src/reference-car-mesh.js` | Test body and scale reference |
| Build and packaging | `vite.config.js`, Electron config, `src/theme.css` | Offline single-file build and the SlotForge look |
| Tests | `tests/*.test.js` for the above | Geometry tests run directly in Node |

Foundry also already has: plane split, profile cuts, push/pull on flat faces, union/subtract, screw-post detection, measure and "calibrate scale", print-plate fit and printer presets.

### Must be replaced or added

| Limit in Foundry | Why it matters for car bodies | Replacement |
|---|---|---|
| Hollowing by Minkowski difference from a flat opening face | Too slow on dense, non-convex bodies; needs a flat face | Grid-based inner surface (section 4) |
| Repair fills holes with flat caps only; rejects badly damaged meshes | Game models and scans are exactly that | "Make solid" rebuild and curved hole filling |
| Import refused unless the mesh is a closed solid | Classes C, D and E would never load | Accept anything, classify, then repair |
| 1,000,000 triangle cap, picking without an acceleration structure | Scans and detailed models exceed it; brushing would lag | Add three-mesh-bvh; raise the cap |
| STL only | 3MF and OBJ can carry separate parts and materials, which helps window detection | Add OBJ and 3MF import |
| Orthographic camera only | Fine for parts; a perspective option reads better on car shapes | Add toggle |
| `src/main.js` (5,450 lines) and `src/inspector.js` hold all UI and state | Not reusable | New UI, designed in the UX phase |

---

## 8. Technical direction

**Recommended: a desktop app on the same stack as Foundry, with three layers.**

1. **three.js + three-mesh-bvh** for display, picking, painting and analysis.
2. **manifold-3d** (Apache-2.0, already in Foundry) in a worker for all exact cuts, joins and primitives. It only accepts clean closed solids, which is why repair comes first.
3. **A grid/distance-field kernel** for repair, hollowing, variable thickness and bucks.

For layer 3 there are two routes:

| Route | For | Against |
|---|---|---|
| **MeshLib** | One library with offset, smooth hole filling, undercut removal and curve projection; has a JavaScript build | Free only for education and non-commercial research; commercial use is an annual fee, price on request. Whether its JavaScript build exposes all needed functions is unconfirmed |
| **Own kernel on permissive parts** (own sparse distance field, or OpenVDB as a native helper; Manifold's `levelSet`) | No licence cost or dependency risk | More engineering, especially smooth hole filling |

**Decision (23 Nov 2026): Anvil will be free.** That does not settle MeshLib on its own: its free tier is worded for education and non-commercial research, and a free app distributed to the public is not clearly either. Working assumption: build on the permissive route, and ask MeshLib whether a free hobby app qualifies before relying on it. MeshLib can still be used privately for prototyping the hard algorithms (smooth hole fill, undercut removal).

CGAL and the libigl boolean module are GPL and should be avoided unless that is acceptable.

A pure three.js + Manifold app without layer 3 would work only for class A and B models. Layer 3 is what makes "any model from the internet" true.

### Top risks

1. **Repair quality on bad input.** Rebuilding softens panel lines; single-skin models need thickening, not hollowing.
2. **Window buck fairness and undercuts**, including openings in already-hollow shells, which have a double rim.
3. **Window cutting on strongly curved glass.**
4. **Memory and speed** of the grid kernel in the browser engine; Manifold's WebAssembly build is single-threaded.
5. **MeshLib licence cost** versus the effort of an own kernel.
6. **Long thin triangles** in CAD-exported STLs breaking smoothing, stretching and painting; a local remesh step is needed.
7. **Unreliable auto-detection** unless every detection has a quick manual override.

---

## 9. Open questions

**For James**

1. ~~Free or paid?~~ **Free** (decided 23 Nov 2026). Still open: does it ship under the SlotForge source-available licence like Foundry?
2. ~~Desktop or browser?~~ **Desktop only**, like Foundry (decided 23 Nov 2026). This allows a native helper for the grid kernel if the in-app engine proves too slow or memory-limited.
3. ~~Which scales first?~~ **1/32 and 1/24 first; 1/43 and HO parked** (decided 23 Nov 2026). Scale is still built as a preset (width limit, default wall, post and screw sizes, tyre sizes, sheet thickness) so the parked scales can be added later without rework. Notes for when they return:
   - The research found little for 1/43 and HO; their presets need a second research pass or community input.
   - HO bodies usually mount with snap-on tabs rather than screw posts, so the mounting tool would need a tab/clip type.
   - Wall thickness does not scale down with the car: a printable wall stays around 0.6–1.0 mm, which is proportionally much thicker at HO and leaves less room inside. **[inference]**
4. ~~Chassis library or typed dimensions?~~ **Both, as one thing** (decided 23 Nov 2026). Typing dimensions *creates* a chassis; saving it puts it in the library. The library is a SQLite database, as in Foundry (which uses sql.js for its Library).
   - A chassis record holds: name, maker, scale, wheelbase (fixed or min–max), front and rear track, tyre diameters and widths, guide position, post positions and deck height, motor/pod clearance box, notes.
   - The library starts small or empty and grows with use. No measured data per commercial chassis is needed up front.
   - Chassis can be exported and imported as a small file, so the community can share measured chassis.
   - The same database can hold scale presets, print presets, tyre/wheel sizes and the user's body projects.
   - `..\SlotForgeRelated\PartsCatalogue` was checked (23 Nov 2026). It is a shop-style parts catalogue in the SlotForge catalogue format: 12 brand folders, with NSR, Slot.it and ScaleAuto as zips only.
     - 401 chassis entries carry name, reference, maker and the car they fit, but **no wheelbase, track or post positions**. They can seed chassis *names*; the dimensions still have to be measured or typed.
     - 482 tyres, of which about 213 state a diameter or size, and 592 wheels, many with diameter and width. These are usable as a tyre and wheel pick list for the ghost chassis.
     - 43 body-mount products (post covers, floating mounts) confirm that post spacers and floating mounts are common hardware.
5. ~~Resin, FDM, or both?~~ **Both** (decided 23 Nov 2026). Print target is a preset: default wall (about 0.9–1.0 mm resin, 1.2 mm FDM), drain holes for resin, split and orientation advice per process.

**To ask the community**

1. One-piece glazing insert or per-window flush glazing: which do builders actually want?
2. Post preferences: printed posts, or sockets for brass tube and threaded inserts?
3. Which chassis do people fit printed bodies to most?
4. Typical sources of their models (which sites, which kinds of file). This tells us the real mix of classes A–E.
5. 1/24 mounting details (pin tube sizes, clip mounts), which this research could not confirm.

**Still unverified**

- Guide position conventions relative to the front axle.
- Lexan body weights for comparison.
- Flat acetate window templates as an alternative to forming.
- Full SlotForum and HRW threads (only excerpts were readable).

---

## 10. Suggested first version

In priority order, following the pain ranking:

1. Import anything, classify, repair.
2. Orient, scale, symmetry.
3. Shell with heatmap, weight estimate and painted thickness.
4. Ghost chassis, arches, posts.
5. Windows by drawing, with mirror.
6. One-piece window buck.
7. Later: wheelbase stretch, per-window bucks, interior tray buck, smoothing brush refinements, split-and-key export.

---

## Sources

**Slot car community and rules**

- https://slotblog.net/topic/88902-designing-and-3d-printing-a-modern-slot-car-body/
- https://slotblog.net/topic/88253-designing-and-3d-printing-a-simple-slot-car-body/
- https://slotblog.net/topic/101485-3d-printing/
- https://www.slotforum.com/threads/3d-printed-bodies-for-1-7-wheelbase.152978/page-2
- https://www.slotforum.com/threads/in-your-opinion-what-is-the-best-filament-or-resin-for-our-cars-aesthetics-strength-and-lightness.218012/
- https://www.slotforum.com/threads/3d-prints-too-brittle.218505/
- https://www.slotforum.com/threads/3d-resin-printing-for-the-uninitiated.205607/page-2
- https://www.slotforum.com/threads/vacuum-forming.210992/
- https://www.slotforum.com/threads/printing-clear-windows.214439/
- https://www.slotforum.com/threads/mrslotcar-patriot-evolution-1-32-chassis.191677/
- https://www.hrwforum.com/forum/-1-32-scale/154217-printing-slotcar-bodies
- https://www.hrwforum.com/forum/hrw-all-scales/3d-slot-forum/123888-3dp-vacuforming
- https://www.hrwforum.com/forum/hrw-all-scales/3d-slot-forum/240638-printing-clear-windows
- https://www.hrwforum.com/forum/hrw-all-scales/3d-slot-forum/173701-any-list-of-3dp-bodies-that-fit-to-mfg-s-slot-car-chassis-s
- https://www.hrwforum.com/forum/hrw-all-scales/3d-slot-forum/250975-printing-1-32-resin-bodies-with-the-new-elegoo-saturn-4-ultra/page3
- https://slotracer.online/community/showthread.php?tid=2565
- https://slotracer.online/community/printthread.php?tid=4152
- https://slotracer.online/community/showthread.php?tid=2125
- https://www.slotcarcorner.com/products/scc-body-sccrews-m2-3-x-6mm
- https://slotcarcorner.com/products/3a3d-1-32-resin-2gen-camaro
- https://slotcarracing.org.uk/rules/carstd.htm
- https://slotcarracing.org.uk/rules/intro32.html
- https://sites.google.com/site/zomaxxraceway/fcr-hardbody-class-rules
- https://hobbiesplus.co.nz/images/2025%20NZSCA%20rule%20book%20for%20RTR.pdf
- https://res.cloudinary.com/slotcarcorner/image/upload/v1653082639/Sideways_Group_5.pdf
- https://cults3d.com/en/3d-model/various/1-32-dirt-late-model-slot-car-body-and-chassis
- https://beamng.com/posts/1078581/
- https://forums.autodesk.com/t5/meshmixer-forum/problem-converting-surface-to-solid/m-p/9594669

**Mesh technology**

- https://github.com/elalish/manifold
- https://registry.npmjs.org/manifold-3d/latest
- https://github.com/gkjohnson/three-bvh-csg
- https://github.com/gkjohnson/three-mesh-bvh/releases
- https://meshlib.io/license/
- https://meshlib.io/documentation/MeshLibJsSetupGuide.html
- https://meshlib.io/documentation/Cpp/group__FillHoleGroup.html
- https://meshlib.io/documentation/Cpp/namespaceMR_1_1FixUndercuts.html
- https://raw.githubusercontent.com/AcademySoftwareFoundation/openvdb/master/README.md
- https://doc.cgal.org/latest/Manual/packages.html
- https://doc.cgal.org/latest/Alpha_wrap_3/
- https://www.dgp.toronto.edu/projects/fast-winding-numbers/
- https://help.prusa3d.com/en/article/hollowing_117285
- https://docs.blender.org/manual/en/4.1/addons/mesh/3d_print_toolbox.html

**Foundry**

- `..\Foundry\README.md`, `docs\GUIDE.md`, `docs\REMAKE-PLAN.md`, `docs\PERFORMANCE.md`, `docs\AUDIT-2026-11-21.md`, and the source files named in section 7.
