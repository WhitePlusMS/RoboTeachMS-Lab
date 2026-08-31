[English](README.md) | [简体中文](README.zh.md)

# RoboTeachMS Lab · Industrial Robot Teaching & Programming Lab

> A browser-based 3D teaching and programming simulation workbench for industrial robots.
> RoboTeachMS Lab brings joint control, Cartesian Jog, end-effector manipulation, RAPID
> program execution, and point teaching into one observable, interactive, and verifiable
> learning environment.

## Project overview

RoboTeachMS Lab is a front-end-only industrial robot teaching and programming simulator.

The default application uses an **ABB IRB 1200-5/0.9 six-axis robot**. A real FBX model is
used for the 3D view, while a DH-based kinematics model drives forward/inverse kinematics
and trajectory calculations. Generic robot services are separated from vendor-specific
profiles, so KUKA, Inovance, and other manufacturers can be added without rewriting the
teaching workbench.

This project is intended for education and algorithm validation. It is not a complete RAPID
compiler, an ABB RobotStudio replacement, or a connection to a real robot controller.

## Features

| Module                         | Capabilities                                                                                                                                                                                              |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **3D robot scene**             | Three.js and FBX loading for the ABB IRB 1200 model; geometric fallback when the model cannot be loaded; scene orbit, zoom, pan, grid, world axes, and DH debug-chain display.                            |
| **Joint teaching**             | Independent J1–J6 control, direct angle input, selectable step sizes, single-step and press-and-hold movement, homing, random poses, and joint-limit enforcement.                                         |
| **Cartesian Jog**              | X/Y/Z and RX/RY/RZ control in World or Tool coordinates, with independent position/orientation increments and numerical IK with trajectory interpolation.                                                 |
| **End-effector gizmo**         | Translation and rotation dragging in the 3D scene; IK targets are solved from the ABB base pose and the gizmo follows DH forward-kinematics truth instead of FBX visual offsets.                          |
| **Forward/inverse kinematics** | DH forward kinematics, numerical Jacobian, damped least-squares IK, multi-seed gizmo solving, joint-limit validation, and unreachable-target diagnostics.                                                 |
| **RAPID editor**               | RAPID source editing, syntax and data diagnostics, source-range navigation, run/step/stop/continue, PP to Main, undo/redo, and execution logs.                                                            |
| **Program Data**               | `robtarget`, `tooldata`, `wobjdata`, `speeddata`, `zonedata`, `loaddata`, `num`, and `bool` views derived from the same RAPID parse result without a second hidden point state.                           |
| **Point teaching**             | New motion instructions start with an untaught `*` placeholder; users can select, record, modify, rename, and delete points, while named `robtarget` values can be shown and highlighted in the 3D scene. |
| **Motion execution**           | `MoveJ`, `MoveL`, and `MoveC` planning and execution with speed, zone, tool/work-object data, basic position functions, synchronized PP/MP pointers, and logs.                                            |
| **Local persistence**          | RAPID source is stored in browser `localStorage`; no backend or database is required.                                                                                                                     |

## RAPID teaching subset

The project intentionally implements a controlled RAPID teaching subset so the complete
**source → diagnostics → planning → motion execution** loop can be observed in a browser.

Currently supported:

- Module and `main` program structure; module-level `CONST robtarget` and basic `PERS`/`VAR` declarations.
- Basic parsing and validation for `tooldata`, `wobjdata`, `speeddata`, `zonedata`, and `loaddata`.
- `MoveJ`, `MoveL`, and `MoveC` motion instructions.
- `Offs(...)` and `RelTool(...)`, with basic tool and work-object transformations.
- `num` and `bool` scalars, literals, variables, parentheses, arithmetic, comparisons, `AND`, `OR`, and `NOT`.
- `IF` / `ELSEIF` / `ELSE` / `ENDIF`, `WHILE`, `FOR ... TO ... STEP ...`, and `EXITDO`.
- Lexical, syntax, name-resolution, data-validation, and motion-planning diagnostics mapped to source ranges.
- Loop-aware single stepping and a global loop-step limit to prevent teaching examples from blocking the page.

Not currently covered:

- Complete RAPID compiler semantics and the full set of ABB controller system instructions.
- `REPEAT ... UNTIL`, `TEST/CASE`, and a complete `PROC`/`FUNC` call system.
- I/O, real-controller communication, external axes, collision detection, and dynamics simulation.
- Arbitrary complex expressions for `Offs` / `RelTool`, runtime assignment of composite data, and a full debugger.

Unsupported teaching-subset syntax is reported through structured diagnostics and blocks unsafe
program execution. The editor diagnostics are the source of truth for the exact supported range.

## Technology stack

| Layer              | Technology                                                              |
| ------------------ | ----------------------------------------------------------------------- |
| Front-end          | Vue 3 with `<script setup>`                                             |
| Language           | TypeScript                                                              |
| Build tool         | Vite                                                                    |
| 3D rendering       | Three.js and `FBXLoader`                                                |
| Linear algebra     | `ml-matrix` and project matrix/rotation utilities                       |
| Code editing       | CodeMirror 6                                                            |
| State organization | Vue Composition API, application controllers, and shared contexts       |
| Unit tests         | Vitest, Vue Test Utils, and jsdom                                       |
| End-to-end tests   | Playwright                                                              |
| Code quality       | ESLint, TypeScript ESLint, `eslint-plugin-vue`, Stylelint, and Prettier |

## Architecture

### Layered architecture diagram

![ABB IRB1200 frontend architecture](docs/architecture/abb-irb1200.svg)

Four motion-input sources (Joint Jog, Cartesian Jog, end-effector gizmo, and RAPID) all
translate into the same `MotionCommand` submitted to a single `Motion Coordinator`, which
dispatches through a `Transport` layer (per-source synchronous call or a resident Worker)
into the single `robot-motion-core` planning function. See the interactive version at
[`docs/architecture/abb-frontend-architecture.html`](docs/architecture/abb-frontend-architecture.html).

### From RAPID source to robot motion

```text
RAPID source
    ↓
Lexer / Parser / Diagnostics
    ↓
Symbol table, Program Data, and structured motion instructions
    ↓
Program Executor
    ↓
MoveJ / MoveL / MoveC planning
    ↓
MotionRunner interpolation
    ↓
Joint state → DH forward kinematics → ABB pose → Three.js scene
```

### Layering principles

- `src/robotics/` contains generic kinematics, matrices, IK, trajectories, and motion execution; it does not depend on Vue, Three.js, or RAPID text.
- `src/robot-models/` provides vendor/model profiles, DH parameters, joint limits, and home poses. The main application currently uses `ABB_IRB1200_PROFILE`.
- `src/rapid/` handles RAPID lexing, parsing, diagnostics, symbol resolution, motion data, and planning.
- `src/application/` orchestrates page-level controllers, program control, joint control, Cartesian control, logs, and notices.
- `src/scene/` handles Three.js, FBX models, coordinate conversion, trajectories, point markers, and the end-effector gizmo.
- `src/components/` contains the Vue workbench, program editor, Jog panels, data panel, and 3D viewport.

### Coordinates and units

- The ABB base coordinate frame is the domain truth for kinematics and RAPID points.
- ABB positions use millimeters and UI angles use degrees; DH internals convert to radians where required.
- Three.js uses meters plus a scene-coordinate adapter. Display coordinates do not define RAPID or kinematics semantics.
- Tool/work-object transforms are applied before planning, so visual model coordinates are never treated as controller coordinates.

## Quick start

### Requirements

- Node.js 20 or newer
- npm 10 or newer

### Install and run

```bash
npm install
npm run dev
```

Open the URL printed by Vite in a browser.

### Build and preview

```bash
npm run build
npm run preview
```

### Common commands

```bash
# TypeScript / Vue type checking
npm run check

# Unit tests under src/
npm run test

# Playwright end-to-end tests
npm run test:e2e

# ESLint and Stylelint
npm run lint
npm run lint:style

# Formatting and format check
npm run format
npm run format:check
```

If Playwright browsers are not installed locally, run:

```bash
npx playwright install
```

## GitHub Pages deployment

Pushes to the `mater` branch trigger `.github/workflows/deploy-gh-pages.yml`. The workflow
installs dependencies with Node.js 20, builds the Vite application, and publishes `dist/`
to the `gh-pages` branch. The Vite base path is automatically set to `/RoboTeachMS-Lab/`
in GitHub Actions builds.

## Project structure

```text
.
├─ public/
│  ├─ brand/                         # RoboTeachMS Lab brand assets
│  └─ models/                        # ABB IRB 1200 FBX and other robot models
├─ src/
│  ├─ application/                   # Page controllers, program control, logs, notices
│  ├─ components/                    # Vue workbench, editor, and control panels
│  ├─ rapid/                         # RAPID lexer, parser, diagnostics, and planner
│  ├─ robotics/                      # Generic kinematics, IK, trajectories, MotionRunner
│  ├─ robot-models/                  # Robot profiles and model adapters
│  ├─ scene/                         # Three.js, FBX, coordinate adapters, and gizmo
│  ├─ theme/                         # Page and scene design tokens
│  ├─ testing/                       # Test clocks and test support
│  ├─ App.vue                        # Application orchestration entry
│  └─ main.ts                        # Vue application bootstrap
├─ e2e/                              # Playwright end-to-end scenarios
├─ index.html
├─ package.json
└─ vite.config.ts
```

## Roadmap

- Add KUKA, Inovance, and other vendor robot profiles, DH parameters, models, and command adapters.
- Extend the RAPID teaching subset and create shared abstractions for other vendor languages.
- Add more complete external-axis, tool/work-object, and industrial task-flow simulation.
- Add import/export and course-experiment records while keeping the browser-local teaching loop.

## License and scope

This project is licensed under the [GNU Affero General Public License v3.0](LICENSE).

All kinematics, parsing, planning, and simulation logic runs in the browser without a backend.
Robot models, vendor parameters, and programming-language features are organized for teaching
simulation and cannot replace safety validation on a real robot controller.
