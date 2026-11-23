# Anvil — plan

*23 Nov 2026. Follows [research.md](research.md), [features.md](features.md) and [foundry-reuse.md](foundry-reuse.md). No code is written until James says so.*

## 1. What we are making

Anvil is a free desktop app that turns a downloaded 3D car model into a printable slot car body: hollowed to a thin even wall, fitted to a chassis, with posts, window openings and a buck for vac-forming the glazing. It is part of the SlotForge family and reuses Foundry's plumbing.

**Decided**

| Topic | Decision |
|---|---|
| Price | Free |
| Platform | Desktop only, same stack as Foundry (Electron, three.js, Manifold) |
| Scales | 1/32 and 1/24 first; 1/43 and HO parked, scale built as a preset |
| Print targets | Resin and FDM |
| Chassis | Typed in or loaded from an STL, saved to a SQLite library; library starts empty |
| Glazing | One insert glued in from inside, with a user-set glue margin |
| Mesh kernel | Permissively licensed parts plus our own inner-wall engine, unless trial T1/T4 shows it is not good enough |

**Principles**

1. The outer skin is never changed unless the user asks. Everything else is derived from it.
2. Every action is a step that can be changed or switched off later.
3. Automatic detection always has an equally quick manual way.
4. Left and right stay mirrored unless the user switches it off.
5. The app says honestly what it did to the model and what it cannot fix.

## 2. Phases

| Phase | What | Status |
|---|---|---|
| 0 | Concept: research, features, reuse check | Done |
| 1 | UX design | Next |
| 2 | Technical trials | **Dropped** (decided 23 Nov 2026): straight to building |
| 3 | Build, in six milestones | Next, once the app has a name |

The questions the trials would have answered (section 4) are now answered inside the milestones that need them: T1 and T5 in M1–M3, T2 in M4, T3 and T4 in M5. If one fails there, the feature drops a tier as described in the risks.

## 3. Phase 1 — UX design

**Reference:** the SlotForge redesign previews at `..\Timing\docs\ui-reference\redesign-2026-11` (`editors.html`, `settings.html`, `systems.html`, `mainmenu.html`, `homecards.html`). Patterns to carry over:

- Dark graphite panels with the red accent, the SlotForge type set.
- The two-layer editor bar: back at top left, the name in large type, saved state, Undo / Redo and Save; below it the tools as icon buttons in named groups.
- Rarely used settings in one side panel instead of a row of fields.
- The settings sheet with a side list as table of contents, for the library and presets.

**Questions the UX phase must answer**

1. Guided stages or free toolbox, or stages as a rail with all tools still reachable?
2. Where the step list lives and how a step is reopened.
3. How the viewport shares space with tool settings, the heatmap legend and the section cut.
4. How the ghost chassis and tyres are shown and moved (handles, typed values, both).
5. How the surface line tool feels: adding points, corners, handles, mirroring.
6. How the check on import and the final check are presented.
7. Library screens: chassis, tyres, post types, add-on parts, presets, rule sets.

**Decided so far**

- 23 Nov 2026: the workspace is a **free toolbox**, not a list of stages. Eight menus (Repair, Scale, Chassis, Shell, Shape, Windows, Posts, Buck) hold every tool. Preview: [docs/ui-reference/workspace.html](docs/ui-reference/workspace.html). The **status bar** along the bottom is kept (decided). Shown but not yet confirmed: a second row with the chosen menu's tools, the menu names and order, and the step list under the tool settings. Later previews assume these until James says otherwise.

- 23 Nov 2026: tyre position along the car is measured from the front axle.
- 23 Nov 2026: **the UX phase sets the general direction only.** James does not want every screen drawn. The two previews ([workspace.html](docs/ui-reference/workspace.html), [chassis.html](docs/ui-reference/chassis.html)) are the direction; other screens follow their patterns and are worked out when they are built.

**The direction, in short**

- SlotForge look and editor bar; project saves itself; red button is Export.
- Free toolbox: eight menus, the chosen menu's tools in a second row, always-needed tools on a strip on the car.
- "Look" toggles for thickness colours, section cut, ghost chassis and compare with original.
- Tool settings on the right, with the step list under them.
- Status bar along the bottom: one short entry per fact, green / amber / grey, each opening its menu.
- Problems are said in one plain sentence on the car, with the ways out as buttons and the best one first.
- Blue is always the ghost chassis; drag on the car or type the number.
- On import: one verdict in big type, what is wrong, what happens to the surface, one button.

**Deliverables:** the two previews above. No further previews unless a screen raises a real question.

## 4. Phase 2 — technical trials

Small throwaway experiments that settle the uncertain parts before the build depends on them.

| Trial | Question | Decides |
|---|---|---|
| T1 Inner-wall engine | Can we hollow five test models (one per class: clean solid, shell, single skin, multi-part, scan) to 1.0 mm with the outside untouched, in acceptable time and memory? | Own engine or licensed library |
| T2 Stretch and squish | Does a blended version of Foundry's stretch keep arches round and panels smooth? | Whether C5 and D0 stay Tier 1 |
| T3 Line tool and window cut | Can a clicked outline be cut cleanly, including a wraparound windscreen? | Window approach |
| T4 Smooth fill and buck | Does filling open windows give a believable glass surface, and does the buck release? | Buck approach; second input on the kernel choice |
| T5 Picking speed | Is brushing smooth on a body of over a million triangles? | Viewport foundation |

**Test models** (from James, 23 Nov 2026). The same rule applies to all of them:

| File | Where | What it is | What it tests |
|---|---|---|---|
| `Main3.stl` | Downloads | Modern SUV, 189 mm (1/24), one clean closed shell, ~3 mm walls, 157,000 triangles | Re-shelling thick walls, mirror removal, width limits |
| `datsun.stl` | Desktop | Widebody 240Z, 100 mm (about 1/43), hollow with open windows, 23,000 triangles, 4 parts, 148 edge faults (mirrors, wing) | Repair of small faults, separate parts, flared arches |
| `Corvette_Stingray.stl` | Desktop | Corvette, 45.7 mm long, scanned or sculpted look, hollow with open windows and posts, 518,000 triangles, 13 parts (12 specks), 56 edge faults, sits 13.8° off straight in the file | Straightening, heavy meshes, rough surfaces, debris, existing posts |

The models are only for testing and previews. It may be used for testing and previews but **must never ship with the app**: not in the installer, the repository, sample projects or published screenshots. Test models are kept outside the app's source folder.

**Needed first:** a test set of eight to ten real models, the kind builders actually download. James or his contact can supply these better than we can guess.

## 5. Phase 3 — build milestones

Each milestone ends in something usable. Feature codes are from [features.md](features.md).

| # | Milestone | Features | Done when |
|---|---|---|---|
| M1 | Base | A1, A2 (STL), A3, A4, A5, A7, A10, A11, A12; slice and join arrive with the Foundry code | A model loads, can be viewed, sectioned, measured, saved and reopened |
| M2 | Prepare | B1, B2, B2a, B2b, B2c, B3, B7 | Any test model ends up as one clean, oriented, scaled body, with an honest report |
| M3 | Shell | D0 (cut), D1, D2, D3, D3b, D4, I1, I2, I2a | A body is hollowed, tuned and exported for printing. **First version worth sharing with testers** |
| M4 | Chassis and posts | A6, C1, C1a, C1b, C2, C3, F1, F2, F3, F3a, F3b, F3e, F3f; C5 and D0 (squish) if T2 passed | A printed body screws onto a real chassis at the right height, tyres clear |
| M5 | Windows and buck | A9, G2, G3, G7, H1, H1a, H1b, H1c, H2 | Windows are cut and a formed insert fits inside the body · **Built** (forming test still to do) |
| M6 | Shape and finish | E1, E2, E3, E4, E8, E13, I0 | Version 1.0 · **Built** (E4 as overlapping pieces, see notes) |

**M1 status (23 Nov 2026): built.** Notes:

- Join (E4) moved to M6 with Add part (E8): joining only makes sense once a second part can be added.
- Slice leaves the cut open (right for a body shell); closing cuts comes with Repair in M2.
- Delete leaves an opening; patching comes with Repair.
- Known limit: when editing an earlier step, its guide plane and slider use the final model's size, not the model as it was at that step.
- Picking, brushing and lasso use a BVH (three-mesh-bvh) and are quick on the 157,000-triangle test car. Geometry runs in a worker.
- No Manifold yet: M1 does not need closed solids. It arrives with repair (M2) and the shell engine (M3).

**M2 status (23 Nov 2026): built, except Rebuild.** Notes:

- **Check** (B1) opens after every import: kind of model (solid, hollow shell, single skin, many parts), wall estimate, faults, parts and openings, and whether the outer surface stays exact.
- **Light fix** (B2): removes specks and broken or doubled triangles, untangles touching surfaces (paired by how they sit around the edge), turns inside-out areas round, closes small holes. Never moves the visible surface. Clears all faults on the Datsun and the Corvette.
- **Parts** (B2a), **Close openings** (E6, flat or smooth, moved up from Tier 2), **Reduce** (B2c, own quadric decimation; the Corvette halves in a few seconds).
- **Rebuild and its change map (B2, B2b) moved to M3.** They use the same grid engine as hollowing, and none of the test cars needs them.
- Steps are cached in the worker, so editing a late step does not redo a slow early one.
- Smooth patches are a relaxed membrane: they follow the rim but are not yet curvature-continuous. Good enough for holes; the window buck (M5) needs better.
- Honest limits shown: single skins and overlapping parts are named, with what comes later to fix them; very coarse models get a warning.

**M3 status (23 Nov 2026): Shell core built; Hammer next (M3b); Rebuild later.** Notes:

- **Floor line** (D0): Cut, or Squish (the lower body pressed up onto the line over a blend zone, then opened). Arches are not yet kept round while squishing; that comes with the chassis (M4).
- **Hollow** (D1): one way for every kind of model. An already-hollow model first loses its old inner skin; then a new wall is built inwards from the outer skin, which never moves, and joined along every opening. Needs an open underside (the floor line).
- **Telling the old outer skin from the inner one** was the hard part. Final rule: from just in front of a surface, look sideways and up (never down, since the underside is open); clearly open means outside. Where it is closed in (cabin, wheel wells, vents), the side of the wall further from the middle of the car is outside. Samples decide; triangles in between follow the nearest sample. An earlier "exact" reference turned out wrong because these bodies are open underneath.
- **Lighten the top** (D3b) and **Paint thickness** (D3): painted spots are stored with the Hollow step; checked to land exactly (1.00 → 0.60 mm where painted).
- **Thickness colours** (D2), **weight** (D4) and **print presets** (I2, I2a: resin or FDM, material, nozzle, FDM walls snap to whole lines).
- Main3: 127 g as imported → 28.7 g at 1.0 mm sills / 0.7 mm roof, one closed piece.
- **Thin parts stay solid** (fixed 23 Nov 2026): where the body is thinner than two walls (wings, flares, mirrors), the inner walls from both sides stop halfway and meet, so the part stays solid. The wall measure looks through that meeting point, so thickness colours show the real material. Share of the outer skin under half the wall: Corvette 34% → 22%, Datsun 21% → 17%, Main3 6% → 5%; what is left is mostly the cars' own shape being that thin (the Datsun's bonnet scoop was already under 0.6 mm before hollowing).
- **Known limits:** sharp recessed creases (Main3's window frames) still fold the inner wall into thin spots. Where inner walls meet in a solid part, the file has two touching inner surfaces; slicers read this as solid, but a strict mesh check may call it touching.
- **Rebuild** (B2) moves again, to after Hammer: none of the test cars needs it.
- **M3b: Hammer (E14), built 23 Nov 2026.** Shell › Hammer, three modes: Hammer (from behind: out, from outside: in), Dolly (painted areas the hammer leaves alone) and Planish (smooths hammer marks). Head size and force; mirrored. All blows live in one Hammer step that always sits before Hollow, so the wall is rebuilt evenly behind the hammered panel. Each blow is felt along the surface, not in a straight line, so the far side of a thin panel stays put. Where blows land, long edges are split (longest edge first) and slivers are flipped away, so panels bend smoothly instead of folding. The screen shows each blow at once; the real rebuild follows (about 2 s on the Datsun).
- **Not built yet:** the guided arch mode (flaring a wheel arch evenly along its edge). It needs the arch circles from the Chassis tools (M4), so it moves there.
- Found while building the hammer: the edge flipping used by smooth patches (Close openings) had its facing check reversed and never flipped; fixed. Hollow's skin sorting now uses fewer samples: about three times faster with the same result.

**M4 is split into slices** (23 Nov 2026):

| Slice | What | Status |
|---|---|---|
| M4a | Chassis typed in (C1), ghost tyres (C1b), fit check and readout on the car, ride height | **Built** |
| M4b | Chassis library in SQLite (A6), chassis STL as ghost (C1a) | **Built** |
| M4c | Wheel arches (C3), stretch and widen (C5), arch-round squish, guided arch hammer | **Built** (arch-round squish: by cutting the arches after squishing) |
| M4d | Posts (F1–F3f), fit test piece | **Built** (except F2 and the glazing warning, see notes) |

**M4a notes:**
- Anvil finds the wheel arches from the side (where the body's lower edge rises near its sides): Main3's are 114.5 mm apart, the Datsun's 48.7 mm.
- "New chassis that fits" suggests wheelbase, front axle, tyres that fill the arches, track width inside the body, deck and guide. Every number can be typed over; tyre pairs stay mirrored; "along" is measured from the front axle.
- The chassis is not a step: it is saved with the project (and in project files) and shown as a see-through blue ghost (Look › Chassis).
- One plain sentence on the car says what does not fit (wheelbase, front axle position, tyres sticking out, tyres too tall) with a button that fixes it. Stretch and re-cut arches show as greyed-out choices until M4c.
- Also fixed: print settings were not restored when Anvil reopened the last body.
- Portable Windows zip: `npm run dist:zip` (0.3.0 built before M4a).

**M4b notes:**
- The library is one SQLite database (sql.js, as in Foundry), loaded only when first opened and kept in the app's own storage on this computer. It holds chassis now; tyres, post types, presets and rule sets will join it.
- Chassis: save, update, save as new, use, remove; share one as an `.anvilchassis` file (with its STL inside) and load one, which also adds it to the library.
- Chassis STL: load a printed chassis's own file; Anvil turns it like a car and shows it in the ghost between the axles, standing on the track. Move along, height and "turn it around" place it. The STL travels with the project and the library, but not in undo (so undo stays quick).
- **Not built:** finding the axles and posts in a chassis STL automatically. The typed tyre numbers stay in charge of the fit.

**M4c notes:**
- **Stretch** (Chassis › Stretch, or "Shorten/Lengthen the body" on the fit line): between the arches only, with eased ends so there is no kink; the front arch stays, the rear arch moves as one piece, so both stay round. Datsun test: shortened 2.70 mm, arches 45.97 mm apart for a 46 mm chassis, fit line green.
- **Widen**: scales the body across the car (arches keep their side-view shape). "Widen the body" on the fit line works out the amount from the tyres.
- **Wheel arches › Cut**: removes the body inside a circle round each tyre (tyre radius + gap), on both sides. Only enlarges arches. Squish followed by an arch cut gives round arches again.
- **Wheel arches › Flare**: evenly spaced hammer blows along the arch edge from behind, both sides; they go into a Hammer step.
- **Order of steps:** stretch, arch cuts and new hammer blows are placed right before Hollow, after anything already there, because they are positioned on the body as it looks now. (Found and fixed while testing: flare blows first went into an earlier Hammer step, before the stretch, and would have landed 2.7 mm off on the rear arch.)
- **Not built:** moving an arch to a new place (cut a new one and close the old). Stretch covers most wheelbase differences.

**M4d notes:**
- **Posts › Posts**: click on the body to place a post (mirrored when Mirror is on and the spot is off the centre line). One Posts step at the end of the list, after Hollow, because posts hang from the finished wall.
- Each post is a round piece of its own that overlaps the body (slicers join overlapping pieces), with a flared top for strength. The top follows the underside of the wall across the whole flare and goes 60% into the wall, so it never shows outside.
- **Automatic length**: from the chassis deck plus a gap (or a typed height without a chassis) up into the body. **Fixed length**: hangs from the body, with a fine groove at the height Anvil worked out, to cut by hand.
- **Two ready-made types**: M2 screw post (4.0 mm, 1.6 mm hole, 6 mm deep) and brass tube / insert socket (4.6 mm, 3.1 mm socket).
- **Post editor**: your own types (screw hole or socket, sizes, flare) in the library (new `post_types` table; older libraries get it on opening). Exports a **fit test piece** (one post under a square of wall) and a **loose post**, each on its own.
- **Chassis spots**: "Keep these spots with the chassis" stores where the posts are (from the front axle, distance from the centre), so they travel with the chassis in the library and files. "Use the chassis's spots" places posts there on the next body; the spots show as blue marks.
- **Warnings**: no body above a post, very short post, fixed length too short to reach the chassis, post wall round the hole under 0.8 mm. If the chassis changes after placing, the panel offers "Follow the chassis".
- The status bar does not count posts as loose parts; the arch finder looks at the body without its posts.
- Main3 test: two posts after floor and 1 mm hollow, nothing pokes out of the roof.
- **Not built:** F2 (finding and removing posts that came with the model), the warning for a post under glass or the glazing insert (needs Windows, M5), and taper or step in the post editor.

**M5 notes (windows and buck, built 23 Nov 2026):**
- **Line tool (A9)**: click points on the body; a smooth curve (Catmull-Rom) runs through them, closed on the green first point or Enter. Ctrl-click makes a sharp corner, drag moves a point, Shift-click adds one, Alt-click removes one, Backspace takes the last one back. The strip's line button starts a new window. Not built: Bézier handles and snapping to creases; the smooth curve with corners covers windows so far.
- **Windows (G2, G3, G7)**: one Windows step after Hollow, before the posts. Each window has a name (guessed from where it faces: side window, windscreen, rear window), open or solid, and mirrored or not (on by default when it sits on one side of the centre line). Warning when two outlines come closer than 1.5 mm (thin pillar).
- **The cut**: straight through the wall along the direction the window faces, reaching from just in front of the glass to a set depth behind it (default twice the wall + 1 mm), so the far side of the car is never touched. The cut edge is closed between outer and inner skin. Where the skins touch (window-frame creases, as on Main3) the two edges join up; those pieces are unrolled flat and filled. Main3: side windows both sides and the windscreen cut with no open edges and no faults.
- **Buck (H1, H1a, H1b, H1c, H2)**: a height map of the body seen from above, moved inward by wall + sheet + fit allowance (an exact ball offset), so it cannot have undercuts. Only the cabin counts: between "cabin from/to" (defaults to the windows plus the glue margin) and where the body is on both sides at the trim line (so not under a door mirror). Cut at a trim line (front and back height; default: the glue margin below the lowest window, measured on the buck), standing on a skirt and a plinth, with draft (1°). Raised guide lines (0.15 mm) for every window outline and the trim line. Thinned where flat (about 40-55k triangles on Main3, within 0.01 mm). Exported on its own.
- **Checks**: red marks where the sheet could not follow the body (the buck is filled: shoulder below the windows, lips round the glass), amber where the glue margin is short, and a warning for posts that go through the insert.
- **Not built**: Close window and Recessed window (Tier 2, shown greyed), glazing ledge, guide lines confirmed by a real forming test (H1b still needs one), per-window bucks (Tier 3).

**M6 notes (shape and finish, built 23 Nov 2026):**
- **Delete selection (E1)**: "Delete, leave open" or "Delete and patch": the patch closes only the hole the deletion made, with a surface that bends with its edge. Where the hole touches itself at a corner, each side gets its own corner first.
- **Smooth (E2)**: brush (mirrored) or the current selection; strength 1-10; sharp edges (over 35°) and open edges stay put. A Smooth step at the end of the list; strokes with the same settings go into the last one.
- **Slice (E3)**: keep below, above or both (moved apart by a gap, to print in two); optionally closed flat, where outlines inside outlines become holes, so a hollow shell gets a ring. Also fixed: a corner lying exactly on the cut used to get a twin, which made the closing fail.
- **Add part (E8) and Join (E4)**: load an STL (wing, scoop, mirror, driver), place it with numbers (along, across, height, three turns, size, mirrored pair). Joined: added to the body as its own overlapping piece, which the slicer joins (like the posts). Its own print: shown see-through violet, exported on its own. Parts can be kept in the library (new `parts` table). The part files are stored with the project and its file. **Not built:** a true boolean union; overlapping pieces are left for the slicer to merge.
- **Protect the outside (E13)**: a toolbar button, on by default. Once the body is hollowed, selections and smoothing leave the outer skin alone (using the same outer/inner split as Hollow). Hammer and the arch tools work on the outside by design and ignore it.
- **Final check (I0)**: header button. Closed solid, loose pieces, wall against the print preset's minimum, chassis fit, ground clearance, posts, windows (cuts, pillars), glazing buck (made, current, margin, posts), weight and centre of weight (as a share of the wheelbase and height above the track). Each line has a button to the tool that fixes it.
- Main3 run: windows, a wing (joined and separate), smoothing inside only: all clean. The final check flags Main3's thin spots at the window-frame creases (thinnest 2% under the resin minimum), the known limit from M3.

**After 1.0**

- Tier 2: OBJ and 3MF import, reference image, keep outer skin only, make symmetrical, smooth facets, clearance check and cut-outs, trim lower edge, push / pull, fill, cut along a line, arch flare, thin-part check, engrave a line, braces, side-anchored posts, detect windows, glazing ledge, close window, recessed window, shrink compensation, rules check.
- Tier 3: ribs, fragile-detail removal, other mounts, per-window bucks, interior tray with driver busts, split for printing, build sheet, re-export at the other scale, drain holes.
- Parked: 1/43 and HO.

## 6. How we test

- **Test set:** the same eight to ten models run through every milestone.
- **Automatic tests:** geometry tests that run without the app, as Foundry does.
- **Real prints:** at M3 (does it print, what does it weigh), M4 (does it fit a real chassis) and M5 (does a formed insert fit, do trim guides transfer).
- **Outside testers:** James's contact and a few builders from M3 onward.

## 7. Risks

| Risk | What we do about it |
|---|---|
| Repair softens detail on rough models | Trial T1, the change map, and saying so up front |
| Own inner-wall engine takes too long or is not good enough | Decide after T1 and T4; fallback is asking MeshLib whether a free app qualifies |
| Stretch and squish distort the car | Trial T2; percentage readout; drop to Tier 2 if needed |
| Wraparound glass cuts badly | Trial T3 |
| Buck does not match real forming | Fit allowance setting and a real forming test at M5 |
| Scope: about 70 features | Tiers; nothing from Tier 2 starts before 1.0 |

## 8. Still open

1. ~~Protect the outside (E13)~~ **Decided: in.**
2. ~~Licence~~ **Decided:** same as the other SlotForge apps: source open, no reselling.
3. ~~The app's name~~ **Decided: Anvil** (23 Nov 2026), listed as "SlotForge Anvil". Working title was Bodyshop. Tagline: *Shape any car model into a light, printable slotcar body.* Coachbuilders hammered body panels over anvils and bucks, and it sits with SlotForge and Foundry.
4. Test models: James supplies more later (solid, game-style, scan). Who does the real prints and forming tests is still open.
4. Questions for the community listed in [research.md](research.md) section 9 (post preferences, common chassis, 1/24 mounting details).
5. Generic driver busts: who models them, or where freely licensed ones come from (Tier 3).
