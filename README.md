# SlotForge Anvil

**From any 3D car model to a body you can race.** Anvil scales a model to 1/32 or 1/24, repairs it, hollows it to an even wall, fits it to your chassis, cuts the windows and gives you a print-ready STL for resin or FDM. Free, for Windows, macOS and Linux. Part of the SlotForge app family.

Free to use and share; source open, no reselling. See [LICENSE](LICENSE).

## Run it

Needs Node.js 22 or newer. Install once (this also fetches the Electron desktop runtime):

```
npm install
```

Desktop app (builds the page, then opens the Anvil window):

```
npm start
```

In a browser while working on the code: `npm run dev`, then open http://127.0.0.1:5173.

Tests: `npm test`.

## What it does today (milestone M1)

- Open an STL car model (drop it on the window or use Open). Anvil guesses which way is front and up; check it under **Scale › Orient**.
- **Scale**: from one scale to another (it guesses the file's scale from the car's length), to a length, or by a factor. **Measure › distance** can also set the scale from a known length.
- **Shape › Slice**: cut with a flat plane and keep one side. **Shape › Delete selection**: brush, lasso or connected-part selection, mirrored across the centre line.
- **Look**: section cut (shows the wall in red) and the original model for comparison.
- **Measure**: distances and wall thickness.
- Every action is a step you can change, switch off or remove. Undo and redo.
- The project saves itself on this computer. **Save project** writes an `.anvil` file holding the original model and all steps. **Export STL** writes the body.
- Millimetres or inches.

## Added in milestone M2

- **Repair › Check** opens after every import: what kind of model it is, how thick its walls are, and what is wrong with it.
- **Repair › Light fix**: removes specks and broken triangles, untangles touching surfaces, turns inside-out areas round and closes small holes, without moving the surface you see.
- **Repair › Parts**: tick which loose parts to keep; point at one to see it on the car.
- **Repair › Close openings**: close chosen openings with a flat or smooth patch.
- **Repair › Reduce**: fewer triangles where the surface allows it, within a distance you set.
- **Scale › Orient** straightens a car that sits at an angle in the file, and guesses the front from the lower nose.

## Added in milestone M3

- **Shell › Floor line**: cut the underside open at a height, or squish the lower body up onto the line so sills and valances keep their shape.
- **Shell › Hollow**: an even wall built inwards from the outside, which does not move. An already-hollow model gets its old inner wall replaced. Optional "lighten the top": the wall thins from the sills up to the roof.
- **Shell › Paint thickness**: paint thinner or thicker spots on the wall.
- **Shell › Hammer**: hammer panels out or in like a real body panel, hold areas with a dolly, and planish out the marks. The wall is rebuilt evenly behind it.
- **Look › Thickness**: colours the body by wall thickness, red where it is too thin to print.
- Printing in resin or FDM (material, nozzle); the status bar shows the thinnest wall and the weight.

## Added in milestone M4

- **Chassis › Chassis**: Anvil finds the wheel arches and suggests a chassis that fits; type over any number with your own chassis's. Shown as a blue ghost inside the body (Look › Chassis).
- **Chassis › Tyres**: front and rear pair, mirrored, with position, size and how far they sit inside the body.
- A line on the car says what does not fit (wheelbase, axle position, tyres sticking out or too tall) and fixes it with one click.
- **Library**: save your chassis and pick it again for the next body; share one as an `.anvilchassis` file.
- **Chassis STL**: load your printed chassis's file to see the real chassis inside the body.
- **Chassis › Stretch**: lengthen or shorten the body between the arches (the arches stay round), or widen it.
- **Chassis › Wheel arches**: cut the arches round the tyres with a gap, or flare them out with evenly spaced hammer blows.
- **Posts › Posts**: click on the body to place screw posts or brass-tube sockets (mirrored). They reach from the chassis deck into the wall, or hang at a fixed length with a cut mark. Keep the spots with your chassis to reuse them.
- **Posts › Post editor**: your own post types in the library, plus a fit test piece and a loose post to print first.

## Added in milestone M5

- **Windows › Windows**: draw each window with the line tool (click points round it; a smooth line runs through them). Open windows are cut through the wall with a clean edge; solid ones only mark the window. Side windows are mirrored.
- **Buck › Window buck**: one plug for the whole cabin to vac-form a glazing insert that is glued in from the inside. Set the trim line, glue margin, sheet thickness and fit allowance; the buck shows on the car with marks where it had to change, and exports as its own STL with raised guide lines.

## Added in milestone M6

- **Shape › Delete selection**: delete and leave the hole open, or delete and patch it.
- **Shape › Smooth**: smooth with a brush or smooth the selection; sharp edges stay.
- **Shape › Slice**: keep one side or both (to print in two), and optionally close the cut.
- **Shape › Add part**: load a wing, scoop, mirror or driver, place it, and join it to the body or keep it as its own print. Keep parts in your library.
- **Protect outside** (toolbar): once the body is hollowed, selecting and smoothing only touch the inside.
- **Final check** (top bar): one list of everything that matters before printing, each with a button to the tool that fixes it.

## Downloads and builds

| | Installer | Portable |
|---|---|---|
| Windows | `SlotForgeAnvil-<version>-Setup-x64.exe` | `SlotForgeAnvil-<version>-Portable-x64.exe`, or `…-Windows-x64.zip` (unzip anywhere, run `SlotForgeAnvil.exe`) |
| macOS (Intel and Apple silicon) | `SlotForgeAnvil-<version>-mac-universal.dmg` | `…-mac-universal.zip` |
| Linux (x64 and arm64) | `SlotForgeAnvil-<version>-linux-<arch>.deb` | `…-linux-<arch>.AppImage` |

- Windows: `npm run dist:win` builds all three here into `dist/desktop/v<version>/`; `npm run dist:zip` builds only the zip.
- macOS and Linux are built by GitHub (`.github/workflows/native-release.yml`) when a release is published; they are tested on each system and attached to the same release. `npm run dist:mac` and `npm run dist:linux` work on those systems too.
- The macOS app is not notarised: the first time, right-click it and choose Open.
- `npm run test:desktop` starts the built desktop app twice on a throwaway data folder and checks that it opens.

Updates work as in the other SlotForge apps (`desktop/update-check.cjs` and `src/update-ui.js`, the same files as Foundry's): an installed or portable copy asks GitHub for the newest release a few seconds after it starts. A newer version opens a window with the release's **What's new** section, Skip and Download. Download saves the file for this copy in Downloads; it never installs anything. **Settings** (the gear in the top bar) has Updates, with Check now and the switch for the check at start. Release notes need a `## What's new` section with `- **Title:** text` lines for the window to show them.

Release: set the version in `package.json`, `npm run dist:win`, tag `v<version>`, publish a GitHub release with the Windows files attached; the macOS and Linux files follow.

## Development notes

- Car models used for testing are never added to this project or to a build.
- `anvil.local.json` (not committed) may name a folder of test models for development: `{ "testModels": "C:/path/to/models" }`. The dev page can then open one with `?open=/@fs/C:/path/to/models/car.stl`.
- Planning documents: [research.md](research.md), [features.md](features.md), [foundry-reuse.md](foundry-reuse.md), [plan.md](plan.md).
