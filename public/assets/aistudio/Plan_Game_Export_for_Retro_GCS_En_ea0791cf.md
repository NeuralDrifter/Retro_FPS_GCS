# Plan: Game Export for Retro GCS Engine

## Goal
A user who builds a game in the GCS can click Export and download either
(a) a standalone project repo they can install, run, modify, and share, or
(b) a single HTML file that plays the game with no install.
The export contains the runtime and the game. It never contains the editor,
AI Studio config, or API keys.

## Ground rules for execution
- Work one phase at a time. Do not start the next phase until the current
  phase's acceptance checks pass.
- After each phase, report: files changed, what was removed or moved, and
  the result of each acceptance check.
- Do not change gameplay behavior. If a refactor changes how a game plays,
  stop and report it.
- Do not add dependencies beyond: three, jszip, vite (in exported projects),
  ws (in exported multiplayer servers only).
- If the codebase contradicts an assumption in this plan, stop and report
  the contradiction instead of working around it.

---

## Phase 0: Audit (no code changes)
Map the current codebase before touching it.

Tasks:
1. List every module and classify it as runtime (needed to play a game),
   editor (needed only to build a game), or shared.
2. List every import from a runtime or shared module into an editor module,
   and every import going the other way.
3. List where game state lives today: in-memory objects, IndexedDB,
   localStorage, blob URLs, base64 strings.
4. List every place the code reads AI Studio config, environment values,
   or API keys.
5. Describe how custom user logic is stored and executed (strings + eval,
   Function(), modules, other).
6. Describe the multiplayer protocol: transport, message types, where the
   server code lives.

Acceptance:
- A written report covering items 1 through 6.
- No files modified.

---

## Phase 1: Separate runtime from editor
Why: the export copies the runtime as-is. Any editor import in the runtime
drags the editor into every exported game or breaks the build.

Tasks:
1. Create /runtime. Move all runtime modules there.
2. Remove every import from /runtime into editor code. Where the runtime
   needs something the editor provides, invert it: the editor passes it in
   through a config object or callback.
3. Runtime exposes one entry point:
   createRuntime({ canvas, manifest, assetBaseUrl, config }) -> { start, stop, dispose }
4. The editor's play/preview mode uses createRuntime, the same way an
   exported game will.

Acceptance:
- A search of /runtime finds zero imports from outside /runtime except
  "three".
- The editor's preview mode plays an existing game with no behavior change.
- Report every import that was removed or inverted.

---

## Phase 2: Game manifest
Why: a game must be one serializable object so it can be written to disk
and loaded by a fresh runtime with no editor present.

Tasks:
1. Define a GameManifest type:
   - schemaVersion (integer, start at 1)
   - meta: title, author, description, createdAt, engineVersion
   - settings: resolution, physics, render options, anything game-wide
   - scenes, entities, components, materials
   - inputMap
   - multiplayer: { enabled: boolean, maxPlayers?, protocolVersion? }
   - assets: array of { id, type, path, mimeType }
   - scripts: array of { id, path }
2. Write serializeGame(editorState) -> GameManifest in the editor.
3. Write loadGame(manifest, assetBaseUrl) in /runtime.
4. Add a migration hook: loadGame checks schemaVersion and runs
   migrations if older. Version 1 has none; the hook exists for later.

Acceptance:
- Serialize an existing game, JSON.stringify it, JSON.parse it, load it into
  a fresh runtime. It plays identically to the editor preview.
- The manifest contains no functions, class instances, blob URLs, or
  base64 asset data.

---

## Phase 3: Assets as files
Why: exported repos should be diffable and editable. Inlined or blob assets
are neither.

Tasks:
1. Write collectAssets(editorState) -> array of { path, blob } covering
   every model, texture, audio file, and font the game uses.
2. Assign paths under assets/<type>/<slug>-<id>.<ext>.
3. The manifest references assets only by these relative paths.
4. The runtime resolves asset paths against assetBaseUrl.

Acceptance:
- Every asset the game uses appears in collectAssets output.
- No asset appears that the game does not use.
- The runtime loads a game with assetBaseUrl pointing to a folder of these
  files.

---

## Phase 4: User scripts as files
Why: people sharing a game should be able to read what it runs, and
eval'd strings are a security and readability problem.

Tasks:
1. Each custom script exports as src/scripts/<slug>-<id>.js as an ES module
   with a documented export shape (for example: export default
   { onStart, onUpdate, onEvent }).
2. The manifest references scripts by path.
3. The runtime loads scripts through dynamic import, not eval or Function().
4. If Phase 0 found eval-based execution, migrate it here and report what
   changed.

Acceptance:
- No eval() or new Function() in /runtime.
- A game with custom scripts plays identically after export.

---

## Phase 5: Project (zip) export
Tasks:
1. Store runtime source in the app as raw strings (Vite ?raw imports or a
   build step that generates them). The exported runtime is readable source,
   not minified.
2. Use JSZip to produce:
   my-game/
     index.html
     package.json          (three, vite; scripts: dev, build, preview)
     vite.config.js
     src/main.js           (fetches /game.json, calls createRuntime)
     src/runtime/...       (verbatim runtime source)
     src/scripts/...       (user scripts)
     src/config.js         (serverUrl and other deploy-time values)
     public/game.json
     public/assets/...
     server/               (only if multiplayer.enabled)
       package.json        (ws)
       index.js
       README.md
     README.md
     LICENSE               (MIT for runtime code)
3. README covers: npm install, npm run dev, npm run build, deploying the
   build folder to static hosting, and (if multiplayer) running and hosting
   the server and setting serverUrl.
4. Name the zip from meta.title, slugified.

Acceptance:
- Unzip, npm install, npm run dev: the game plays.
- npm run build produces a static folder that plays when served.
- For a multiplayer game: start the server, open two clients, both connect
  and play.

---

## Phase 6: Single HTML export
Tasks:
1. Produce one .html file with: runtime inlined as a module script, manifest
   inlined as JSON, assets inlined as data URIs, user scripts inlined as
   module scripts, Three.js loaded from a CDN through an import map.
2. Multiplayer games in this format read serverUrl from a visible config
   block at the top of the file, with a comment explaining it.

Acceptance:
- Open the file directly from disk in Chrome and Firefox: the game plays.
- Report the file size for the largest test game.

---

## Phase 7: Export safety checks
Why: the export is a distribution path. Anything leaked here goes to every
person the game is shared with.

Tasks:
1. Before generating either format, scan every output file for:
   - API key patterns (AIza..., sk-..., bearer tokens, long hex/base64 secrets)
   - references to AI Studio config or environment objects
   - imports of any editor module
   - hardcoded URLs pointing at the creator's own servers
2. If any check fails, abort the export and show the user which file and
   which check failed.
3. Run the security hardening skill against the exporter code and the
   exported output. Report findings.

Acceptance:
- Plant a fake API key in a test game's script; export is blocked with a
  clear message.
- Clean games export with no warnings.

---

## Phase 8: Export UI
Tasks:
1. Export button opens a dialog: Project (zip) or Single HTML, game title
   field (prefilled), license field for user assets (default: none
   specified).
2. Progress indicator during asset collection and zip generation.
3. On failure, show the specific error from Phase 7 or the failed step.

Acceptance:
- Both export paths work end to end from the UI on the three test games.

---

## Test games
Use these for every acceptance check from Phase 2 onward:
1. Small single-player game, no custom scripts.
2. Single-player game with custom scripts and audio.
3. Multiplayer game.
If any of these don't exist, build minimal versions in Phase 0 and report
them.

## Out of scope
- Desktop exe packaging (Electron/Tauri). The project export is the input
  to that later.
- Gallery publishing.
- Hosting exported games on the creator's infrastructure.