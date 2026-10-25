---
name: refactor-monolith
description: Use when decomposing a monolith — one or a few giant files where everything is tangled together, typically grown feature-by-feature with little design and few tests. Structure-only work; behavior never changes. Triggers: split this file, break up main, this file is huge, modularize, decompose, organize this project, too big, turn this into modules, extract modules. For many-file codebases with rotten boundaries, use refactor-legacy instead.
---

# Refactor Monolith

You are decomposing a monolith: one or a few giant files that do everything. Your job is to take it from a tangle to a set of small, focused modules with narrow interfaces — **without changing what the program does**. A refactor that alters behavior is not a refactor; it is a rewrite wearing a disguise.

These rules are language-agnostic. "Module" means whatever the language's unit of organization is — a file, a package, a namespace, a class file. Translate every example into the project's language and idioms.

---

## Core Philosophy

**Decomposition is discovery, not invention.** The modules already exist inside the monolith — clusters of functions that share state, sections that change together, code that serves one job. Your task is to find those seams and make them real, not to impose a textbook architecture the code never asked for.

**The monolith works. Respect it.** Every odd conditional and weird special case may be a bug fix somebody paid for. You move code; you do not "improve" it mid-move. Cleanup is a separate, later step with its own verification.

**Behavior preservation is the prime directive.** After every step, the program does exactly what it did before. Structure changes; observable behavior does not. Never mix refactoring with feature work or bug fixes — if you find a bug, note it in the plan file and fix it in a separate change after the campaign (or before it, if it blocks testing).

**Small verified steps beat big correct-looking leaps.** One move at a time. Compile and test after every move. Commit after every green. A hundred small safe steps finish; one giant rearrangement collapses under its own weight — especially for an agent, whose context can end mid-task. Any step you make must leave the repo in a state someone else could pick up.

**A module is one responsibility plus a narrow interface.** For every module you create you must be able to answer: what is its one job, what does it expose, and what does it depend on? If you can't answer in one sentence each, the boundary is wrong.

**When to use the sibling skill instead:** this skill is for *few huge files*. If the codebase already has many files but the boundaries are rotten — circular dependencies, misplaced logic, duplicated concepts — use `refactor-legacy`. If a repo has both problems, run this skill on the giant files first; good modules are the raw material the legacy skill reorganizes.

---

## Non-Negotiable Rules

1. **Behavior does not change.** Not output, not error messages, not exit codes, not file formats. If the user wants behavior changes, those happen in separate changes outside this campaign.
2. **Never big-bang.** No "rewrite it cleanly from scratch." No moving everything in one commit. Rewrites discard embedded bug fixes and institutional knowledge.
3. **Safety net before surgery.** No extraction begins until there is a one-command build and a one-command test that passes, plus characterization tests covering the main paths.
4. **One move per commit, green between moves.** Every commit compiles, passes tests, and represents exactly one catalog move (or one clearly-named preparatory step).
5. **A broken move gets reverted, not patched.** If a move fails and the fix isn't obvious in minutes, revert to the last green commit and take a smaller step. Never stack fixes on a broken base.
6. **Move code verbatim.** Extraction copies code as-is. No renaming sprees, no restyling, no "while I'm here" fixes during a move. Polish comes later, via the clean-code pass.
7. **Maintain the plan file.** Every move is recorded before it happens and checked off when green. The plan file is the campaign's memory.
8. **Read before you cut.** Never extract code you haven't read in full, including everything that references it.

**Violating the letter of these rules is violating their spirit.** "It's basically the same behavior" means the behavior changed. "These two moves are really one move" means two commits.

---

## The Refactor Plan File

Before any code moves, create a plan file in the repo (e.g., `docs/refactor-plan.md`) and commit it. This file is not bureaucracy — it is how a multi-session campaign survives context loss, and how any agent or human can resume mid-campaign without re-deriving everything.

The plan file contains:

```markdown
# Refactor Plan: <project>
Status: phase 3 of 5 | Started: <date>

## Responsibility Map        (from Phase 1)
- lines 1-140: arg parsing and config
- lines 141-600: TUI event loop and rendering
- ...

## Safety Net                (from Phase 2)
- Build: `<one command>`   Test: `<one command>`
- Characterization tests: <where, what they pin>

## Target Structure          (from Phase 3)
src/
  config.*      — load and validate configuration
  domain/*      — core types and rules (no I/O)
  ...
Dependency rule: main → ui/net/storage → domain → (nothing)

## Move Checklist            (from Phase 3, executed in Phase 4)
- [x] extract-leaf-module: string helpers → src/text
- [x] extract-data-types: Skill, Config → src/domain
- [ ] extract-pure-core: message formatting → src/render
- ...

## Decisions & Discoveries
- <date>: kept X and Y together because they share state Z
- <date>: found probable bug in retry loop (noted, NOT fixed — behavior preserved)

## Deferred — hand off to the next campaign
- [ ] <what> — <why it was out of scope here> — <which skill owns it>
```

Update it as part of every move's commit. When resuming a session: read the plan file first, verify the last checked move is actually green, then continue.

**Deferred findings are obligations, not remarks.** Everything you notice but correctly decline to fix — logic that is in the wrong module, a function that wants extracting, a region inconsistent with its siblings — goes in the Deferred list with the skill that owns it, and the closing summary repeats that list. A finding recorded only in prose depends on someone rediscovering it. Observed: a region implemented inline where every sibling was a named function was spotted and passed over by two consecutive campaigns, each noting it in prose, and was only fixed when a third campaign happened to re-find it. Two of those three passes would have handed it over in one line.

---

## The Campaign

Five phases, in order. Do not skip ahead; each phase's output is the next phase's input.

| Phase | Goal | Output |
|-------|------|--------|
| 1. Survey | Understand what lives in the monolith | Responsibility map |
| 2. Safety net | Make change safe to verify | One-command build+test, characterization tests, baseline commit |
| 3. Design | Decide the target structure | Module tree + dependency rules + ordered move checklist |
| 4. Extract | Execute moves in dependency order | One green commit per move |
| 5. Final pass | Verify structure matches design | Thin entry point, closed plan, handoff |

---

## Phase 1: Survey

**Read everything before deciding anything.** The whole file, top to bottom — not a skim, not a sample. For a multi-thousand-line file, read it in chunks and take notes as you go. Editing or planning against code you haven't read is how behavior changes silently.

Build the **responsibility map** — the inventory of distinct jobs hiding in the file:

- **Regions:** which line ranges serve which job (parsing, state, rendering, I/O, business rules, wiring)?
- **Shared state:** which globals, singletons, or long-lived structures do multiple regions touch? Shared mutable state is what welds responsibilities together — map it precisely, it determines extraction difficulty.
- **Call structure:** who calls whom? Which functions are leaves (call nothing else in the file)? Which are hubs (called from everywhere)?
- **Entry points:** where does execution start? What are the external surfaces (CLI, HTTP handlers, exported API)?
- **External dependencies:** which libraries does each region use? A region's imports are a strong hint about its job.

Also note — but do not act on — anything suspicious: probable bugs, dead code, duplicated logic. Record them in the plan file's Decisions & Discoveries section. Dead code may be deleted during Phase 4 as its own move (deletion is behavior-preserving only when you have verified nothing reaches it).

Write the responsibility map into the plan file. If the map shows fewer than two distinct responsibilities, stop — there is nothing to decompose, and the user needs to hear that instead of a make-work restructure.

---

## Phase 2: Safety Net

You cannot claim behavior is preserved unless something checks behavior. Build the net before touching structure:

1. **Baseline commit.** Ensure the working tree is clean and committed (or committed on a branch created for the campaign). Every future step needs a known-good point to revert to.
2. **One-command build, one-command test.** If building or testing requires ritual, script it now. You will run these dozens of times; they must be trivial to run and unambiguous to read.
3. **Run the existing tests.** Record what passes. If some tests already fail, record that too — those failures are the baseline, and your job is to not add new ones.
4. **Add characterization tests** where coverage is missing on the paths you'll disturb. A characterization test pins *current* behavior, right or wrong:
   - Drive the program through its real entry points (run the CLI with known inputs, call the public API, hit the handler) and assert on what it *actually does now* — capture the current output and make the test demand it.
   - Cover the main happy paths and the error paths that the code clearly intends.
   - Golden-master style works well for monoliths: capture full output for a set of representative inputs; the test diffs future output against the capture.
5. **For hard-to-test monoliths** (GUI/TUI, network servers): test what you can from outside (startup, clean shutdown, one scripted interaction) and lean harder on the compiler and on smaller extraction steps. Thin coverage means small moves, not no net.

The net does not need to be beautiful or complete. It needs to catch a broken extraction. Commit it.

---

## Phase 3: Design the Target Structure

Now — and only now — design where the code will live. The responsibility map tells you what modules want to exist; do not design from imagination.

**Produce a module tree** with a one-line responsibility per module:

```
src/
  main.*        — parse args, wire modules, run; nothing else
  config.*      — load, validate, and expose typed configuration
  domain/       — core types and business rules; depends on nothing below
  storage.*     — persistence; hides file/db details behind domain terms
  net.*         — remote calls; hides transport behind domain terms
  ui/           — rendering and input; talks to domain types only
```

**Set the dependency rule and write it down.** Dependencies point one way: wiring → I/O layers → core logic → data types → nothing. No module in the tree may depend on a module above it, and nothing depends on `main`. If your design has a cycle, the design is wrong — fix it on paper now, where it costs nothing.

**Design checks — all must pass before proceeding:**
- Every region in the responsibility map has exactly one destination module.
- Every module's responsibility is one honest sentence without "and".
- Modules are named for what they do in the domain (`billing`, `render`, `parser`) — never `utils`, `helpers`, `common`, `misc`. A junk-drawer module is the monolith reborn under a new name.
- The tree is proportionate: a 2,000-line file usually wants 5–10 modules, not 30. Prefer fewer, fuller modules; you can split again later when a module earns it.
- Shared mutable state has a single designated owner module, with a plan for how others reach it (see `lift-shared-state`).

**Derive the move checklist** — the ordered list of catalog moves that gets from here to there (ordering rules in Phase 4). Write tree, rules, and checklist into the plan file.

**Present the design before executing** when working interactively: show the tree, the one-line responsibilities, and the move order, and get agreement. If running autonomously, commit the plan file so the design is reviewable, then proceed.

---

## Phase 4: Extract in Dependency Order

Execute the move checklist. **Order matters — extract things that depend on nothing first:**

1. **Leaf utilities** — helpers that call nothing else in the file. Zero risk, and each one shrinks the remaining problem.
2. **Data types** — structs, records, enums, constants and their intrinsic methods. Types anchor everything else; once they live in their own module, other extractions have somewhere to point.
3. **Pure logic** — computation and business rules, separated from I/O as they move.
4. **I/O wrappers** — storage, network, terminal, each behind an interface named in domain terms.
5. **Entry-point wiring last** — what remains in the original file should shrink toward pure wiring; formalize it at the end.

This order means every move lands on ground that has already stopped moving. Extracting the entry point first — the tempting "start at the top" — makes every subsequent move churn it again.

**The move loop.** For every move on the checklist:

```
1. Read the code to be moved, and every reference to it.
2. Execute the move (verbatim — structure changes, code text doesn't).
3. Build. Fix wiring errors (imports, visibility) — nothing else.
4. Run the tests. Green required.
5. Commit with a message naming the move: "extract-leaf-module: text helpers -> src/text".
6. Check the move off in the plan file (same commit).
```

If step 3 or 4 fails and the cause isn't an obvious wiring slip, **revert and split the move into smaller moves.** A move that keeps failing is telling you a hidden coupling exists that Phase 1 missed — map it (usually shared state), add the preparatory move (`parameterize-globals`, `lift-shared-state`), and retry.

**Reverting means going back to the last green commit, not editing your way out.** `git checkout -- <path>` restores one file; `git reset --hard` discards every uncommitted change in the tree. Both throw away uncommitted work, which is exactly what you want here and exactly why the per-move commits exist. If you are unsure of the commands or need to recover something you thought was lost, use the `git` skill — do not improvise with a half-remembered command on a repository mid-campaign.

### What breaks when code crosses a module boundary

Extraction converts implicit same-file access into an explicit interface. Everything the moved code *offers* now needs a deliberate decision about who may touch it, and everything the moved code *used* must travel with it or be imported. Expect all three of these on almost every move:

- **Visibility.** What was reachable because it shared a file is not reachable across the boundary. Languages that default to private make you say so item by item — and some make *fields* private individually even when the type itself is public, so "I made the struct public" does not mean callers can use it.
- **Names the moved code depended on.** Helpers, constants, and types it referenced need to come along or be imported. This is the half that nothing checks in a dynamic language.
- **The entry point.** While the original file is being carved up, the file holding `main` (or the framework's entry symbol) can briefly stop providing it. If that happens, the move was cut too coarse — take a smaller slice rather than patching around it.
- **Tests colocated with the monolith.** When the language keeps unit tests beside the code (in-file test modules, sibling test files), a region's tests reference internals that just moved. Left at the old site, they force the new module to widen visibility for exactly one caller — the stranded tests — and the "thin" entry file ends up mostly tests. Move a region's tests to its new module in the same move or the one immediately after; visibility opened only to serve a stranded test is a boundary drawn wrong. This is part of the move, not a judgement call to weigh at the end: one test module is one small relocation — a line-range copy, an import line, a line-range delete — and putting six of them off until the end turns six small moves into one intimidating one. If you find yourself pricing the effort, that is the signal you deferred it too long.

**How you find out decides how you verify.** A compiler that refuses the build hands you the complete list for free: fix exactly what it names and nothing more. Where nothing checks — dynamic languages, reflection, dependency injection by string name, templates resolved at runtime — the build *and* the unit tests can pass while a moved function references a name that never arrived. There, green is not evidence. Exercise the moved code through a path that actually runs it before you commit the move.

**Fix the whole error list in one pass, then rebuild once.** The build reports every error it found, so treat that output as the complete to-do list for this move: read all of it, make every fix in a single batched edit, and only then rebuild. Fixing one error, rebuilding, fixing the next is the most expensive way to do this and it is the default trap — a twenty-error move becomes six rebuild cycles instead of one.

Two things make the trap easy to fall into. First, **never head-truncate compiler output** (`| head -40`, `| Select-Object -First 40`): errors carry several lines of context each, so the first N lines show you a quarter of them and hide the rest, and you will "discover" the same failures repeatedly. Ask the toolchain for a compact form instead — most compilers have one that prints a line per error. Second, **use your editor's batch form** if it has one, so twenty fixes are one call rather than twenty.

**Grant the narrowest visibility that works.** Faced with a wall of privacy errors the reflex is to make everything public, which leaves you with a module that has no encapsulation — most of the value of the move, gone. Decide the narrowest workable visibility *per item* — that is a judgement about each name, not a reason to rebuild between fixes; make all those decisions, then apply them together. If a caller needs a field, ask whether it should be calling a method instead; the errors are a free design review of the interface you just created.

### Moving a large block without retyping it

A move is a *relocation*, and the worst way to relocate a few hundred lines is to type them out again. Retyping invites transcription typos that surface later as baffling exact-match failures, and a whole-file write larger than your output budget arrives truncated — or not at all. Both have burned real campaigns. Two rules keep big moves byte-faithful:

- **Assemble the destination, don't dictate it.** Write only the new module's small parts by hand — header comment, imports — then bring the body across as *actual lines*. Where the environment has line-range tools (in foreman-cli: `copy_lines`, then `delete_lines`), that is the whole job — copy the block into the new file, verify, delete it from the source; both preserve line endings and back up automatically. Only without such tools fall back to an editor's line-range copy or a script that slices the file's lines and rejoins with its own terminator — and then check the terminator survived (count CR bytes before and after). Finish with the wiring fixes — visibility, imports — as small exact-match edits.
- **Delete by line range, not by reproduction.** Removing the moved block from the source by exact-matching hundreds of lines fails on the first invisible byte — a backslash, a tab, a trailing space. Confirm the range boundaries by reading them, then `delete_lines` (or splice without the range and re-verify the terminator).
- **A block starts above its declaration line.** Its range includes whatever binds to it: attributes, annotations, decorators, doc comments, the explanatory comment written for it. Starting the range at the `mod`/`def`/`class`/`fn` line strands those at the old site and drops them from the new one — and an attribute left behind can silently change what the moved code means. Read the lines *above* your intended start before fixing the range.
- **Work bottom-up when moving several blocks out of one file.** Removing a range renumbers everything below it and nothing above, so taking the last block first keeps every remaining range valid and saves re-reading the file between moves.

Exact-match editors compare bytes. If a snippet is refused, do not re-guess escaping — that loop does not converge; re-read the exact lines and copy them verbatim from the tool output, or switch to the line-range approach. And after any splice, re-read the file before further exact-match edits: an editor that tracks staleness will rightly refuse to touch a file that changed underneath it.

**Discoveries during extraction** go in the plan file, not in the diff. Found a bug? Note it. See a better structure than the design? Update the design in the plan file — with a written reason — then continue. Silent divergence between plan and reality is how campaigns rot.

---

## Phase 5: Final Pass

The checklist is done. Before declaring victory:

- **The entry point is thin.** `main` (or equivalent) parses inputs, constructs and wires modules, invokes the top-level operation, handles top-level errors. If logic remains, extract it — that's one more move, not a shrug.
- **Reality matches the plan.** Walk the target tree in the plan file against the actual repo. Divergences are either fixed or documented with reasons in the plan file.
- **The dependency rule holds.** Check every module's imports against the rule. Where the language has tooling to enforce import direction, wire it in so the structure defends itself.
- **No junk drawer appeared.** If a `utils` module snuck in, distribute its contents to modules named for what the code does.
- **Full build and test from clean.** One command each, both green, output reported honestly.
- **Close the plan file:** status → complete, with a short summary of what moved where, **and the Deferred list reproduced in full** — that list is the next campaign's input, so it belongs where the next reader starts, not buried mid-file.

**Then hand off to clean-code.** This skill organized the code; it did not polish it. Run the `clean-code` skill (refactor mode) over the new modules for naming, function size, and function-level cleanup — as a separate campaign with the same green-between-steps discipline.

---

## Move Catalog

The named moves referenced by the checklist. Each: when to use it, how, and the pitfall that ruins it.

### `extract-leaf-module`
**When:** a cluster of functions calls nothing else in the monolith (string helpers, math, formatting, validation predicates).
**How:** create the module, move the cluster verbatim, update references, build, test, commit.
**Pitfall:** improving the code as it moves. Move first, polish in the clean-code pass. The diff for an extraction should show relocation, not rewriting.

### `extract-data-types`
**When:** types (structs, records, enums, constants) are used across many regions.
**How:** move type definitions plus their *intrinsic* behavior — constructors, accessors, conversions, validation of their own invariants — into a domain/types module that depends on nothing.
**Pitfall:** dragging business rules along because they're methods on the type. "Is this true of the data itself, or is it something the application does *with* the data?" Only the former moves.

### `extract-pure-core`
**When:** decisions and computation are interleaved with I/O — parsing mixed with file reads, business rules mixed with network calls.
**How:** carve out the computation as pure functions: data in, data out, no I/O, no globals, no clock. The calling code keeps the I/O and feeds the core.

```
// Before: decision welded to I/O
function process_orders(path):
    for line in read_file(path):
        order = parse(line)
        if order.total > limit and not order.flagged:   // the business rule
            append_file("flagged.txt", order.id)

// After: pure core, shell feeds it
function orders_to_flag(orders, limit):                 // pure — trivially testable
    return [o.id for o in orders if o.total > limit and not o.flagged]

function process_orders(path):                          // shell — mechanical
    orders = [parse(line) for line in read_file(path)]
    append_file("flagged.txt", orders_to_flag(orders, limit))
```

**Pitfall:** passing one giant context object into every core function. Pass exactly what each function needs; the parameter list documents the real dependencies, and a bloated one is a boundary drawn in the wrong place.

### `separate-io-shell`
**When:** a region both performs effects (disk, network, terminal) and decides what to do — the larger-scale sibling of `extract-pure-core`.
**How:** restructure so a thin imperative shell gathers input → calls the pure core for decisions → mechanically applies the effects the core requested.
**Pitfall:** a shell that makes decisions. If the shell contains an `if` about business state, that decision belongs in the core.

### `parameterize-globals`
**When:** functions read or write module-level mutable state, hiding their real inputs and outputs.
**How:** one global at a time: add it as an explicit parameter (or field on a context passed explicitly), update all callers mechanically, then move the state to its owner.

```
// Before: hidden input and output
current_theme = "dark"                      // module-level mutable global
function render_status(): use current_theme ...

// After: the dependency is visible and the owner is explicit
function render_status(theme): ...
// caller (eventually the ui module, which owns theme state):
render_status(ui_state.theme)
```

**Pitfall:** the god-context — one struct holding all former globals, passed to everything. That is the same coupling with extra ceremony. Split contexts by concern so each function receives only its own.

### `lift-shared-state`
**When:** two responsibilities you want to separate both mutate the same state — the classic reason a monolith "can't" be split.
**How:** decide which module owns the state. The owner exposes a narrow interface (a few named operations); the other party calls it. If ownership is genuinely unclear, the state may be its own small module both depend on — below both in the tree.
**Pitfall:** "sharing" by making the state public in its new module. That relocates the coupling without narrowing it. The interface is the point: named operations, not raw access.

### `group-by-feature-not-by-type`
**When:** designing the target tree (Phase 3), or when a tree drifts toward `models/`, `helpers/`, `managers/`.
**How:** name and group modules by domain job — `billing`, `search`, `render` — so related code lives together and a feature change touches one place. Group by kind only for genuine infrastructure shared by all features.
**Pitfall:** `utils` as a destination. Code that "doesn't fit anywhere" hasn't been understood yet; understand it, then place it.

### `introduce-facade`
**When:** a region has so many callers scattered through the monolith that extracting it would touch everything in one move.
**How:** two moves instead of one. First: define a small facade — the narrow interface you *want* — in front of the region, and mechanically point every caller at it (green, commit). Second: move the implementation behind the facade freely; callers never notice.

```
// Move 1: callers now touch only the facade (implementation unmoved)
function save_session(state):  _write_session_v2(state, GLOBAL_PATH, legacy_mode)
// 40 call sites: _write_session_v2(...) -> save_session(state)     [green, commit]

// Move 2: implementation relocates behind the facade; zero caller churn
module storage: save_session(state) -> ...                          [green, commit]
```

**Pitfall:** a facade that mirrors the messy internals one-to-one. Design the facade as the interface the callers deserve; the mess stays hidden behind it until the clean-code pass.

### `thin-entry-point`
**When:** closing out (Phase 5), when `main` still holds logic.
**How:** `main` keeps exactly four jobs: read config/args, construct and wire modules, invoke the top-level operation, handle top-level errors. Everything else moves to the module that owns it.
**Pitfall:** "setup helpers" parked next to main that are really business logic with a beard. If it makes a domain decision, it belongs in a domain module.
**Also:** carving up the entry-point file can briefly delete the entry point itself — the build then reports no `main` rather than anything about what you moved. Treat that as the move being too coarse and take a smaller slice; don't chase the error.

### `split-config-from-logic`
**When:** environment reads, flag parsing, and magic constants are scattered through the logic.
**How:** one config module reads and validates everything once at startup into a typed structure; logic receives values as parameters or module config — and can no longer secretly depend on the environment.
**Pitfall:** passing the entire config object everywhere. Each module receives only its own settings; a module that takes the whole config is coupled to every setting in the program.

---

## Decision Table

| Situation | Action |
|-----------|--------|
| Monolith, but also many files with bad boundaries | This skill first on the giant files, then `refactor-legacy` |
| No tests and no easy way to add them | Golden-master at the entry points; smaller moves; never "skip the net" |
| Tests already failing before you start | Record as baseline; add no new failures; don't fix during the campaign |
| A move keeps breaking the build | Revert; find the hidden coupling; add a preparatory move (`parameterize-globals`, `lift-shared-state`) |
| Build fails on privacy/imports right after a move | Expected — read the whole list, fix all of it in one batched edit, rebuild once |
| Tempted to truncate build output to keep it short | Never head-truncate errors; ask for a compact one-line-per-error format instead |
| Tempted to make everything public to clear the errors | Choose narrowest-workable per item, then apply the decisions together |
| An exact-match edit keeps being refused on a big block | Stop re-guessing invisible bytes; copy verbatim from tool output, or move by line range (`copy_lines`/`delete_lines`) |
| Destination module is hundreds of lines | Assemble it: write the small header, relocate the body with `copy_lines` — never retype what you can move byte-for-byte |
| Language has no compile-time check (dynamic, reflection, string-keyed DI) | Green isn't evidence — run the moved code through a real path before committing |
| Tests for a moved region still live in the old file | Move them to the region's new module (same move or the next); don't widen visibility to serve a stranded test site |
| Build reports the entry point missing | The move was too coarse; revert and take a smaller slice |
| Two regions share mutable state | `lift-shared-state` before separating them |
| Extraction would touch 50 call sites at once | `introduce-facade` first, then move behind it |
| Found a bug mid-extraction | Note in plan file; do not fix in this campaign |
| See a better design mid-campaign | Update the plan file with reasons, then proceed — never diverge silently |
| Can't name a module honestly without "and" | Split the module in the design |
| Tempted to create `utils/` | Understand the code, then place it by job |
| A function could be "improved" while moving | Move verbatim; polish in the clean-code pass |
| Session ending mid-campaign | Commit green, update plan file — next session resumes from it |
| Code region looks unreachable | Verify nothing reaches it, then delete as its own move |
| User asks for a feature mid-refactor | Finish or pause the campaign at a green commit; feature work is a separate change |

---

## Rationalizations — and Reality

| Excuse | Reality |
|--------|---------|
| "Faster to rewrite this cleanly from scratch" | The rewrite loses every embedded fix and takes 3× the estimate. Extraction keeps the program working the whole way. |
| "I'll do these five extractions in one commit" | When the build breaks you won't know which move did it. One move, one commit. |
| "There are no tests, so I'll just be careful" | Careful is not a verification strategy. Golden-master tests take an hour and catch what care misses. |
| "This code is so bad, behavior preservation doesn't matter" | Bad-looking code often encodes real fixes. Preserve first; judge later with tests around you. |
| "I'll fix this little bug while I'm in here" | Now the diff changes behavior and structure at once, and the tests can't tell you which broke. Note it, move on. |
| "I put the bug fix in its own clearly-labeled commit, so it's fine" | A labeled behavior change is still a behavior change inside a campaign that promised none. The label doesn't make it in scope — note it in the plan file; ship it as a separate change after. |
| "Renaming things as I move them is basically free" | Renames double the diff and hide relocation errors inside it. Verbatim moves are auditable at a glance. |
| "I'll just retype the block into the new file" | Hundreds of retyped lines mean transcription typos and truncated writes. Relocate the actual bytes by line range. |
| "The plan file is overhead, I'll remember" | You are an agent; your context ends. The plan file is the campaign's memory across sessions and agents. |
| "One shared `utils` module is convenient" | The junk drawer is how the last monolith started. Every function has a real home; find it. |
| "It compiles, that's verification enough" | Compilers check types, not behavior. Run the tests, every move. |
| "The design is obvious; skip the survey" | Designs from imagination miss the shared state that makes extraction fail on move three. Survey first. |

**Red flags — stop and revert if you catch yourself:**
- A "refactor" diff that changes what code *does*, not just where it lives
- Editing code you haven't read
- Three fixes stacked on a move that won't go green
- A commit containing two moves
- Writing `utils`, `helpers`, `common`, or `misc` as a module name
- Claiming green without having run the tests this move

---

## Scope and Precedence

- **Explicit user instructions override this skill.** Note the conflict briefly, then follow the user.
- **Project conventions override generic structure.** If the language ecosystem has a standard layout, use it — never fight the toolchain.
- The campaign's scope is what was agreed: the monolithic file(s), toward the approved target tree. No drive-by restructuring of code outside scope.
- **After the campaign,** run the `clean-code` skill over the new modules for function-level polish — naming, size, comments, error handling. This skill organizes; that one refines.
