# GridForge 3D: Export Bug Report and Fix Plan

**From:** Claude (Opus 5.5, by Anthropic), working with Michael P. Burgus in Claude Code on his Windows machine
**To:** Argon, in Google AI Studio
**Date:** 2026-10-27

Hi Argon. I'm Claude. Michael asked me to look at two games exported from the GridForge 3D app you built with him, because neither would start. I ran both exports and traced each failure to its root cause. This report covers what I found, the evidence, and the changes the main app needs.

The app is good work: tile-grid levels, procedural textures, an event system with triggers and actions, a combat HUD, and two export formats. The bugs below are all in the **export pipeline**, not the editor or the engine logic. They're the kind that only show up when you run the exported output outside the app.

---

## Bug 1: Vite project export is missing the runtime (blocker)

**Symptom:** `npm run dev` / `npm run build` fails, and nothing renders.

**Evidence:** `src/main.js` line 5:

```js
import { startGame } from './runtime/index.ts';
```

The exported `src/` folder contains only `main.js`. There is no `src/runtime/` folder. A real build fails with:

```
[UNRESOLVED_IMPORT] Could not resolve './runtime/index.ts' in src/main.js
```

**Fix:** The project exporter must write the full runtime source tree into `src/runtime/`: `index.ts` and everything it imports, transitively. Vite compiles `.ts` natively, so no extra config is needed. The `three` dependency in `package.json` is already correct (`^0.186.1`).

**Related:** `main.js` passes `dracoDecoderPath: '/draco/'`, but no `public/draco/` folder is exported. That's harmless for procedural-only levels. For any level that includes Draco-compressed `.glb` models, either copy the decoder files into `public/draco/` or skip setting the path when no compressed models are used.

---

## Bug 2: Single-HTML export crashes on load (blocker)

**Symptom:** The page shows "Click to Play", but clicking does nothing.

**Evidence:** In headless Chrome, the inline script throws as soon as the page loads:

```
TypeError: Failed to construct 'URL': Invalid URL
```

The bundled Three.js DRACO loader code runs this at module level:

```js
new URL("../libs/draco/draco_decoder.wasm", import.meta.url)
```

The single-file bundle is a classic IIFE `<script>`, not a module, so the bundler replaced `import.meta` with an empty object. In the output it is `var Yo={}`, which makes `import.meta.url` `undefined`. `new URL(relative, undefined)` throws, the script stops, and the bootstrap function that attaches the Click to Play handler never runs.

**Verified workaround:** Changing `var Yo={}` to `var Yo={url:document.baseURI}` fixes it. With that one change, the page loads with zero exceptions and renders the level: corridor, skybox, weapon model.

**Proper fix (choose one) in the single-HTML build step:**

1. **Preferred:** Bundle as ESM (`format: 'esm'`) and inline it as `<script type="module">…</script>`. `import.meta` then stays valid.
2. Keep the IIFE format, but define the value at build time, e.g. esbuild `define: { 'import.meta.url': 'document.baseURI' }`, or the equivalent in whatever bundler the app uses.
3. Avoid code paths that compute `new URL(..., import.meta.url)` at module level, e.g. load the DRACO loader lazily only when a level actually contains compressed models.

If the bundler printed a warning like *"import.meta is not available in the configured target environment and will be empty"*, that warning was this bug.

---

## Bug 3: Click to Play overlay may be detached (needs verification)

After the patched single-HTML export boots, `#click-to-play` is no longer in the DOM. The engine appears to clear `#game-container` during `startGame()`. The bootstrap code then attaches its click handler to the overlay element it grabbed beforehand:

```js
overlay.addEventListener('click', () => { overlay.style.display = 'none'; game.lockPointer(); });
```

If that element has been removed, the handler can never fire, and pointer lock for mouse aiming may never engage unless the engine also locks on canvas click. I couldn't test pointer lock headlessly.

**Fix if confirmed:** Either have `startGame()` append its canvas and HUD without clearing the container, or have the runtime own the overlay: create it after mounting and call `lockPointer()` from its click handler.

---

## Change request: rename the "Pie3D" runtime

Michael wants the runtime name changed. "Pie3D" is too close to Pie in the Sky Software's 3D Game Creation System, the classic DOS tool that inspired GridForge. Known occurrences:

- The README template: "Engine: GridForge 3D / Pie3D Runtime"
- The `main.js` header comment: "launches the Pie3D game runtime"
- The CSS class `pie3d-combat-hud-root`, plus any other `pie3d-` prefixes
- Probably type names, folder names and comments in the runtime source

Michael will choose the new name. Candidates so far: ForgeCore, Anvil Runtime, GridCore, Crucible Engine. Apply the rename across the editor, the runtime and both export templates, so no "Pie3D" string appears in any exported file.

---

## Acceptance checks

An export is good when all of these pass:

1. **Vite project:** `npm install && npm run build` succeeds, and `npm run dev` shows the level.
2. **Single HTML:** Opening the file directly (`file://`) gives zero console exceptions, and the level renders.
3. **Click to Play:** Clicking hides the overlay and locks the mouse; moving the mouse turns the view.
4. **Gameplay smoke test:** The level-start message appears, and the keycard, push wall and exit switch events all fire.
5. **Rename:** Searching both exports for `pie3d` (case-insensitive) finds nothing.

Thanks, Argon. Michael will bring the updated code back to me for review and testing.

— Claude
