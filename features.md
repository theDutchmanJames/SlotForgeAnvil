# Anvil — feature set (working draft)

*Draft 1, 23 Nov 2026. For discussion; nothing here is decided unless marked. Background and evidence are in [research.md](research.md).*

**Decided so far:** free app · desktop only · 1/32 and 1/24 first (1/43 and HO parked) · resin and FDM · chassis typed in and saved to a SQLite library.

**Tier** is a proposal: **1** = needed for a first usable version, **2** = soon after, **3** = later.

---

## A. Foundation (what every tool depends on)

| # | Feature | What it does | Tier |
|---|---|---|---|
| A1 | Project | One file holding the original model plus the list of edit steps. Steps can be revised, switched off or deleted; undo/redo. The original outer skin is kept untouched | 1 |
| A2 | Import | STL first. OBJ and 3MF next, because they can carry separate parts, which helps find windows and interiors | 1 (STL), 2 |
| A3 | Viewport | Orbit, preset views, perspective/orthographic toggle, section cut to see the wall, see-through mode | 1 |
| A4 | Selection | Brush, lasso, connected part, flat region, grow/shrink. Mirrored left/right by default | 1 |
| A5 | Symmetry lock | Finds the car's centre plane; every tool mirrors across it unless switched off | 1 |
| A6 | Library | SQLite: chassis, tyres and wheels, post types, add-on parts, driver busts, scale presets, print presets, rule sets, saved projects. Import/export of single entries for sharing. **Decided: not seeded from the PartsCatalogue data**; tyres, wheels and chassis are typed in by the user | 1 (chassis, tyres, posts, presets), 2 |
| A7 | Measure | Point-to-point ruler, wall thickness probe, "set scale from this distance" | 1 |
| A9 | Surface curve tool | **Decided.** One shared line tool for windows, cut-outs, engraved lines and trim guides. No freehand drawing: the user clicks points on the body and the app runs a smooth curve through them on the surface. Each point is smooth or a sharp corner; Bézier handles for fine control; straight segments; points can be moved, added or deleted afterwards; optional snap to the model's own creases and panel lines; mirrored left/right | 1 |
| A10 | Units | **Decided.** Switch between millimetres and inches | 1 |
| A11 | Compare with original | **Decided.** Shows the untouched import next to or over the current body at any time | 1 |
| A12 | Autosave | The project saves itself and reopens exactly as left | 1 |
| A8 | Reference image | Side/top/front photo or blueprint behind the model for tracing windows and checking shape | 2 |

## B. Prepare the model

| # | Feature | What it does | Tier |
|---|---|---|---|
| B1 | Check | Plain-language report on import: solid, shell, single skin, many parts, or scan; what is wrong; what to expect | 1 |
| B2 | Repair | One-click fix: close holes, fix flipped parts, merge overlapping parts into one solid ("make solid") with before/after | 1 |
| B3 | Orient and scale | Auto front/up, then pick 1/32 or 1/24, or type a real dimension (wheelbase, length). Shows width against the class limit | 1 |
| B2a | Parts list | **Decided.** Multi-part models are listed with tick boxes; the app guesses the body; the user unticks wheels, interior, suspension. Glass-like parts are kept aside and offered as windows later | 1 |
| B2b | Change map | **Decided.** After a rebuild, colours the result by how far the surface moved from the original, before the user accepts | 1 |
| B2c | Triangle reduction | Thins very heavy files where it does not change the shape (exists in Foundry) | 1 |
| B5 | Make symmetrical | **Decided.** Copies the better half of a scan or damaged model over the other | 2 |
| B6 | Smooth facets | **Decided.** Rounds off the flat facets of low-detail models; slightly softens sharp edges | 2 |
| B7 | Honest limits | The check says up front when a model has large parts missing or is too coarse to give a good result | 1 |
| B4 | Keep outer skin only | Strips interior, engine, suspension and underbody from multi-part models | 2 |

## C. Fit to a chassis

| # | Feature | What it does | Tier |
|---|---|---|---|
| C1 | Ghost chassis | Typed or library chassis shown inside the body: wheels, axles, guide, motor box, post positions, deck height | 1 |
| C1a | Chassis STL as ghost | **Decided.** Load a printed chassis' own file as the ghost. The app tries to find axle and post positions; the user confirms or marks them | 1 |
| C1b | Ghost tyres | **Decided.** Tyres drawn on the ghost. Front pair and rear pair are each one group: X (along the car), Y (in/out, mirrored so both sides stay symmetrical) and Z (height), plus diameter and width per pair. X is measured from the front axle (**decided**): the front pair is the starting point at 0 and the rear pair's X is the wheelbase; sliding the whole chassis inside the body is done with Position body (C2). Moving a pair along X updates the wheelbase readout; Y updates track width; Z defaults to the tyre resting on the track surface. Sizes typed or picked from the library | 1 |
| C2 | Position body | Slide and raise the body over the chassis; ride height and ground clearance shown live | 1 |
| C3 | Wheel arches | Arches found automatically or dragged as circles; enlarge, move or re-cut to tyre size plus a margin | 1 |
| C4 | Clearance check | Highlights where tyres, guide, motor or gear touch the shell | 2 |
| C5 | Wheelbase stretch / widen | Lengthens or widens the body between the arches while the arches stay round. **Decided: Tier 1 if it proves feasible** (rated moderate to hard; needs an early technical trial) | 1 |
| C6 | Clearance cut-outs | Guide slot, motor/gear relief, chassis-edge trim as ready-made cuts | 2 |

## D. Shell

| # | Feature | What it does | Tier |
|---|---|---|---|
| D0 | Set the underside | The user drags a floor line up from below. Two modes (**decided**): **Cut** removes everything under the line. **Squish** compresses the lower body upward until its lowest point sits on the line, so sills, splitter and valance keep their shape instead of being chopped off. Squish only moves things vertically, inside a blend zone the user can adjust; length, width and everything above the zone stay exact. The app shows the compression as a percentage and keeps wheel arches round (they are exempt or re-cut). Same warp engine as wheelbase stretch (C5) | 1 |
| D1 | Hollow | Makes an even wall at a chosen thickness and opens the underside. Single-skin models are thickened inward instead. Already-hollow models are measured; the user keeps the wall or re-shells from the outer skin | 1 |
| D2 | Thickness heatmap | Colours the body by wall thickness; flags too thin to print and needlessly thick | 1 |
| D3 | Paint thickness | Paint areas thinner (roof) or thicker (sills, arches); only the inside surface moves | 1 |
| D3b | Lighten the top | One slider (**decided**) that thins the wall gradually from sills to roof, for example 1.2 mm at the sills down to 0.7 mm on the roof. Painted areas override it | 1 |
| D4 | Weight estimate | Grams for the chosen material, updated live, with a rough height of the centre of gravity | 1 |
| D5 | Trim lower edge | Cut the body's bottom edge to a height or to follow the chassis | 2 |
| D6 | Reinforcement ribs | Thin ribs inside across arches and other weak spots | 3 |

## E. Clean and shape

| # | Feature | What it does | Tier |
|---|---|---|---|
| E1 | Remove area | Select, delete, and patch the hole smoothly or leave it open | 1 |
| E2 | Smooth | Brush and whole-selection smoothing that keeps sharp edges if asked | 1 |
| E3 | Slice | Cut with a plane; keep one side or both, with caps | 1 |
| E4 | Join | Merge parts into one (for example a separate bonnet or spoiler) | 1 |
| E5 | Push / pull | **Replaced by Hammer (E14)** (23 Nov 2026) | – |
| E6 | Fill / patch | Close an opening with a surface that follows the surrounding shape | 2 |
| E8 | Add part from file | **Decided.** Load a second STL (wing, spoiler, scoop, driver), place it, join it or keep it separate. Add-on parts can be saved in the library | 1 |
| E9 | Cut along a line | **Decided.** Draw an outline with the surface curve tool (A9) and lift that piece out as its own part | 2 |
| E10 | Arch flare | **Part of Hammer (E14)** as its guided arch mode | – |
| E11 | Thin-part check | **Decided.** Highlights parts too thin to print or survive a crash, with one-click thicken | 2 |
| E12 | Engrave a line | **Decided.** Draw a line with the surface curve tool and sink it in, to restore panel lines lost in scaling. Width and depth set by the user | 2 |
| E14 | Hammer | **Decided** (23 Nov 2026, suggested by James's slot car friend). A body panel hammer: tap or drag to push the panel out or in, strongest under the head and fading to its edge; head size and force; from outside (in) or from behind (out); mirrored; a dolly (painted area the hammer leaves alone); planishing (smoothing out hammer marks); a guided arch mode that flares a wheel arch evenly. Works on the outer skin, before Hollow, so Hollow rebuilds an even wall behind it. Adds triangles where a panel stretches. Replaces E5 push/pull and E10 arch flare. **Built** (M3b), except the guided arch mode, which moves to M4 with the arch circles | 1 (M3b) |
| E13 | Protect the outside | Lock that keeps the outer skin unchanged while working inside a hollowed body; on by default inside. **Decided** | 1 |
| E7 | Remove fragile details | Quick removal of mirrors, wipers, aerials, with the stump patched | 3 |

## F. Mounting

| # | Feature | What it does | Tier |
|---|---|---|---|
| F1 | Add post | Click a spot, or take positions from the chassis. The post grows from the chassis deck up to the inside of the body at the right height, with a screw hole sized for the chosen screw | 1 |
| F2 | Remove post | Existing posts are detected and can be deleted, with the inside patched | 1 |
| F3 | Post options | Two post types from the start (**decided**): a printed post with screw hole, and a socket for brass tube or a threaded insert. Also diameter, screw size, base fillet for strength, height allowance for body float | 1 |
| F3a | Post editor | **Decided.** The user designs their own post: outside diameter, hole diameter and depth, length, base fillet, optional taper or step. Saved to the library as a reusable post type. A post can be placed in the body at a **fixed length** (for example 20 mm) instead of automatic height, to be cut to length by hand, or exported loose to print separately and glue in. Optional cut mark: a fine groove at the height the app calculated | 1 |
| F3b | Automatic height | Posts from the chassis markers grow from the chassis deck to the inside of the body, with a float gap setting. Mirrored when off-centre | 1 |
| F3c | Braces | **Decided, as an option.** Braces from a tall post to the nearest wall | 2 |
| F3d | Side-anchored post | **Decided, Tier 2.** For open cockpits or a window overhead: the post is held by an arm from the nearest wall | 2 |
| F3e | Fit test piece | **Decided.** Export one post on a small patch of wall to test screw or insert fit before printing the body | 1 |
| F3f | Post warnings | Post under glass or colliding with the glazing insert, post outside the body, post wall too thin for the screw | 1 |
| F4 | Other mounts | Side tabs, pin tubes and clip mounts for 1/24; magnet pockets | 3 |

## G. Windows

| # | Feature | What it does | Tier |
|---|---|---|---|
| G1 | Detect windows | Proposes windows where the model has glass parts, recesses or clear edges | 2 |
| G2 | Draw window | Click an outline on the surface; editable afterwards; mirrored | 1 |
| G3 | Open window | Cuts the outline through the wall | 1 |
| G4 | Glazing ledge | A small step inside the opening for the glazing to sit on | 2 |
| G5 | Close window | Fills an existing opening smoothly (solid window for painting, or as the basis for a buck). Stays Tier 2 (**decided**) | 2 |
| G6 | Recessed window | **Decided, as an option.** Sinks the window a fraction of a millimetre for a crisp paint edge, for builders who paint the glass instead of vac-forming | 2 |
| G7 | Window list | Every window is a named, editable item with a state: solid, open, closed or recessed. The uncut body is always kept as the basis for the buck. Warns when a pillar between windows gets too thin | 1 |

## H. Bucks and inserts

| # | Feature | What it does | Tier |
|---|---|---|---|
| H1 | Cabin window buck | **Default glazing type decided: one insert glued in from inside.** One plug for the whole cabin above a beltline the user drags; set sheet thickness (0.5 mm default) and fit allowance; undercuts removed; raised base | 1 |
| H1a | Glue margin | **Decided.** The user sets how far the glazing overlaps the body around every opening (the gluing lip), for example 3 mm. The buck and trim line are extended to guarantee it, including below the windows. Places where the margin cannot be met (posts, thin pillars) are highlighted | 1 |
| H1b | Trim guides | **Decided.** Window outlines and the trim line are raised as fine lines on the buck so they transfer to the formed sheet. Needs a real forming test to confirm 0.5 mm sheet picks them up | 1 |
| H1c | Post check | Warns when the glazing insert would collide with a body post | 1 |
| H2 | Release check | Colours areas the sheet could not release from, and shows where the buck was changed to fix it | 1 |
| H3 | Per-window bucks | Separate plugs for flush glazing | 3 |
| H4 | Interior tray | Tier 3 confirmed. The tray is made from the cabin's inside outline at the beltline, as a buck for vac-forming or a thin printed part. The driver is not generated: a few generic driver busts (helmet, shoulders, arms, steering wheel) ship in the library, users can add their own, and the chosen one is placed, scaled and either merged into the tray or exported as a separate part | 3 |

## I. Check and export

| # | Feature | What it does | Tier |
|---|---|---|---|
| I0 | Final check | One screen with a green/amber/red mark per item: printable (closed solid, minimum wall, thin parts), fit (tyres, guide, motor, clearance, posts), glazing (glue margin, posts), weight and centre of gravity. Each item jumps to the tool that fixes it | 1 |
| I1 | Export | Body, bucks, loose parts and fit test piece as separate STL files or one zipped kit (3MF later), each turned the way it prints best, with a short note. Supports are left to the slicer | 1 |
| I2 | Print preset | Resin (about 1.0 mm default wall) or FDM (about 1.2 mm), with a minimum wall warning | 1 |
| I2a | Nozzle-aware walls | For FDM, wall thickness snaps to what the nozzle lays down cleanly (for example 0.8 or 1.2 mm on a 0.4 mm nozzle). **Decided** | 1 |
| I2b | Shrink compensation | A small percentage per printer preset so posts and gaps come out at size. **Decided** | 2 |
| I3 | Rules check | Width, length, clearance, wheels covered from above, against a chosen rule set. Rule sets are editable and saved in the library; BSCRA ships as an example. **Decided** | 2 |
| I4 | Split for printing | Cut into parts with alignment pins when the body does not fit the printer or prints better in halves | 3 |
| I5 | Build sheet | One page: chassis, tyres, screws, post heights, sheet thickness, glue margin, weight | 3 |
| I6 | Re-export at the other scale | Re-make a finished 1/32 project at 1/24 or the reverse. Wall, windows and buck follow; chassis fit and posts are redone. **Decided** | 3 |
| I7 | Drain holes | Only for a buck hollowed to save resin. An open-bottomed body shell does not trap resin and needs none (correction to draft 1) | 3 |

---

## Deliberately not in Anvil

- Designing a chassis (Foundry and CAD tools do that; Anvil only shows one as a ghost).
- Sculpting a car from scratch.
- Liveries and decals (the SlotForge family has separate apps).
- Slicing and support generation (left to the slicer).

---

## Open points per feature

Settled 23 Nov 2026: "add windows" means both opening (G3) and closing (G5); wheelbase stretch (C5) and both post types (F3) move to Tier 1 if feasible; the interior tray (H4) stays Tier 3 and uses library driver busts.

1. **H1 buck type:** one-piece cabin buck assumed as the default; per-window bucks later. To confirm with builders.
2. **I3 rule sets:** which ones to ship (BSCRA is the only one fully read so far).
3. ~~E13 protect the outside~~ **Decided: in.**
4. **C5 wheelbase stretch and D0 squish** share one warp engine. There is no separate trial phase, so this is proven while building M4; if it does not work well enough it moves to Tier 2.
5. **H1b trim guides** need a real forming test.

All nine groups were worked through on 23 Nov 2026.
