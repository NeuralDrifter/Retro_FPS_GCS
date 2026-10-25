---
name: refactor-legacy
description: Use when restructuring a multi-file codebase whose boundaries have rotted — circular dependencies, business logic scattered across layers, the same concept implemented several times, inconsistent conventions accreted over years. Structure-only work; behavior never changes. Triggers: restructure, reorganize this codebase, circular dependency, untangle, fix the architecture, clean up the structure, tech debt, spaghetti, layering violations. For one or a few giant files, use refactor-monolith instead.
---

# Refactor Legacy

You are restructuring a legacy codebase: many files, real users, and boundaries that have rotted — cycles, misplaced logic, duplicated concepts, three names for the same idea. Your job is to repair the architecture **while the program keeps working at every step**. The old structure stays alive until the new structure has proven itself; then the old structure dies.

These rules are language-agnostic. "Module" means the language's unit of organization; "architecture" means which modules exist, what each is for, and which may depend on which. Translate every example into the project's idioms.

---

## Core Philosophy

**Legacy code is an asset that works.** It survived contact with reality; its weird branches are often paid-for bug fixes and its structure, however rotten, encodes knowledge no document holds. You restructure it *because* it's valuable — code without a future doesn't earn a refactor. Contempt for the old code leads to rewrites, and rewrites lose the knowledge.

**Behavior preservation is the prime directive.** After every step the system does exactly what it did before — same outputs, same errors, same wire formats, same persisted data. Never mix restructuring with feature work or bug fixes. Found a bug? Note it in the plan file; fix it in a separate change.

**Boundaries first, contents later.** The disease is structural: modules that reach into each other, logic in the wrong layer, concepts smeared across files. Fix where code lives and what may depend on what. What the code looks like *inside* a module is the `clean-code` skill's job, afterward.

**Strangler, not surgeon-with-a-chainsaw.** New structure grows alongside old. Callers migrate one at a time. The old path keeps working until nothing uses it — then it's deleted, promptly. At every moment the system runs; there is no "it'll compile again by Friday" phase. This also survives a codebase under active development: small green steps merge; long-lived restructure branches die in merge hell.

**Small verified steps, forever recorded.** One move at a time, green between moves, one move per commit, everything tracked in a plan file. An agent's context ends; a campaign that lives only in your head dies with the session.

**When to use the sibling skill instead:** this skill assumes many files. If the problem is one or a few giant files, use `refactor-monolith` — decomposing those files comes first, and gives this skill its raw material. If a repo has both problems, monolith first, then this campaign.

---

## Non-Negotiable Rules

1. **Behavior does not change.** Including external contracts: API responses, serialized formats, database schemas, CLI output. Internal names can change; anything the outside world sees cannot.
2. **Never big-bang.** No rewrite, no "restructure branch" that diverges for weeks, no commit that moves twenty files. The system runs green at every commit.
3. **Safety net before surgery.** No structural move until a one-command build and test exist and characterization tests cover each seam you're about to cut.
4. **One move per commit, green between moves.** Each commit is one catalog move (or one named preparatory step), compiling and passing tests.
5. **A broken move gets reverted, not patched.** If it isn't an obvious wiring slip, revert to green and take a smaller step. Never stack fixes on a broken base.
6. **Old paths keep working until cutover — then they are deleted.** A migration that leaves both paths alive forever doubled the mess instead of halving it. Every parallel structure gets a deletion entry on the checklist the day it's created.
7. **Move code verbatim.** Relocation diffs show relocation, not rewriting. Polish belongs to the clean-code pass.
8. **Maintain the plan file.** Every finding, decision, and move lives there. Resuming agents read it first.
9. **Read before you cut.** Never move code you haven't read in full, including its callers.

**Violating the letter of these rules is violating their spirit.** "The schema change is invisible to users" means the behavior changed. "These three module moves are one logical move" means three commits.

---

## The Refactor Plan File

Before any code moves, create a plan file in the repo (e.g., `docs/refactor-plan.md`) and commit it. It is the campaign's memory: multi-week restructures span many sessions, and the plan file is how any agent or human resumes without re-deriving the map.

```markdown
# Refactor Plan: <project>
Status: phase 4 of 5 | Started: <date>

## Map                       (from Phase 1)
- Dependency findings: cycles, hotspots, misplaced logic, duplicated concepts
  - CYCLE: orders <-> customers (via orders.discount -> customers.tier -> customers.history -> orders)
  - MISPLACED: refund rules live in http/handlers.*
  - DUPLICATE: 3 retry implementations (net.*, sync.*, jobs.*)

## Safety Net                (from Phase 2)
- Build: `<one command>`   Test: `<one command>`
- Characterization tests: <which seams they pin>

## Target Architecture       (from Phase 3)
- Layers/features and the dependency rule
- Destination for every module (the disposition table)

## Move Checklist            (from Phase 3, executed in Phase 4)
- [x] introduce-seam: payment gateway behind interface
- [x] break-cycle-by-inversion: orders <-> customers
- [ ] relocate-misplaced-logic: refund rules -> domain/billing
- [ ] strangler-fig: legacy report generator (DELETE OLD BY: end of checklist)
- ...

## Decisions & Discoveries
- <date>: retry variants differ — jobs.* swallows timeouts; canonical = net.* behavior; noted as candidate bug, NOT changed

## Deferred — hand off to the next campaign
- [ ] <what> — <why it was out of scope here> — <which skill owns it>
```

Update it in the same commit as every move. When resuming: read the plan file, verify the last checked move is actually green, continue.

**Deferred findings are obligations, not remarks.** What you notice and correctly decline to fix goes in the Deferred list with the skill that owns it, and the closing summary reproduces that list. A finding recorded only in prose survives only if someone rediscovers it — and the campaign that would have fixed it is usually the very next one.

**Read the previous campaign's Deferred list before designing.** A monolith or clean-code pass that ran before you will have left findings it was right to skip; several are boundary problems, which is your subject. That list is Phase 1 evidence you do not have to re-derive.

---

## The Campaign

Five phases, in order. Each phase's output is the next phase's input.

| Phase | Goal | Output |
|-------|------|--------|
| 1. Map | See the real structure, not the intended one | Dependency picture, cycles, hotspots, misplaced logic, duplicates |
| 2. Safety net | Make change safe to verify | One-command build+test, characterization tests at the seams, baseline commit |
| 3. Target architecture | Decide the destination and the route | Dependency rules, disposition table, risk-ordered move checklist |
| 4. Migrate | Execute moves incrementally | One green commit per move; old paths alive until cutover |
| 5. Consolidate | Make the new structure permanent | Old paths deleted, boundaries enforced, structure documented |

---

## Phase 1: Map

You cannot fix a structure you haven't seen. Map what *is*, not what the README claims.

**Build the dependency picture.** Extract the import/include relationships between modules — from the code itself, with language tooling where it exists or by reading imports where it doesn't. You need, per module: what it depends on, and what depends on it.

**Hunt for the four diseases:**

- **Cycles.** Module A depends on B depends on A (often through a longer chain). Cycles are the load-bearing rot: they make modules untestable alone, unownable, and unextractable. List every cycle with its full path — the path tells you where to cut.
- **Misplaced logic.** Business rules in HTTP handlers, domain decisions in the database layer, policy in UI code, infrastructure snuck into domain modules. Signature symptom: to change one business rule you must edit three layers.
- **Duplicated concepts.** The same idea implemented more than once — retry loops, date handling, validation, config reading. Signature symptom: a bug fixed in one copy and still alive in the others.
- **Inconsistent vocabulary.** One concept, many names (`user` / `account` / `member` for the same thing), or one name meaning different things in different modules. Vocabulary chaos is a boundary problem: nobody agreed what the concepts are.

**Find the hotspots.** Rank modules by churn (commit frequency, from version control history) × size. High-churn, high-size modules are where structure pays: restructuring code nobody touches is effort spent where it earns nothing. Hotspots also carry the highest regression risk — they get the strongest safety net.

Write all findings into the plan file's Map section. **Scope check:** if the map reveals a sprawl too large for one campaign, propose a scope — usually the worst cycle cluster or the hottest subsystem — and agree on it before designing. A bounded campaign that finishes beats a total one that doesn't.

---

## Phase 2: Safety Net

Every seam you plan to cut needs something that screams if the cut changes behavior.

1. **Baseline commit.** Clean tree, known-good point, on a branch created for the campaign if conventions call for one.
2. **One-command build, one-command test.** Script the ritual away now; you'll run both dozens of times.
3. **Assess existing coverage against the plan.** Run the suite; record the baseline (including pre-existing failures — your job is to add no new ones). For each planned cut in the Map, ask: *if I broke this seam, would a test fail?* Where the answer is no:
4. **Add characterization tests at the seams.** A characterization test pins *current* behavior, right or wrong — capture what the code actually does and assert exactly that. Aim them at the seams you will cut, from the outside of the thing being restructured: the callers' view of a module about to move, the responses of an API whose internals will churn, golden-master output for a subsystem being strangled. Wrong-looking current behavior is *still what you pin*; note the suspicion in the plan file.
5. **Pin the external contracts.** Anything the outside world consumes — wire formats, schemas, file formats, CLI output — gets a test asserting it byte-for-byte where practical. These are the contracts rule 1 protects.

The net doesn't need to be complete; it needs to catch a broken move at every seam on the checklist. Commit it.

---

## Phase 3: Target Architecture

Design the destination from the map, not from a book. The right architecture for this codebase is usually the one it's already reaching toward — features that want to be whole, layers that want to be honest.

**Define the shape.** Name the layers or feature areas and give each a one-sentence responsibility. Typical shape, adapt to fit:

```
domain/      — types and business rules; depends on nothing else here
app/         — use cases orchestrating domain work; depends on domain
adapters/    — storage, network, external services; depends on domain contracts
ui/, api/    — delivery; depends on app
main         — wiring only
```

**Decide the physical layout separately from the logical one.** Modules are the logical unit; directories are how they sit on disk, and the two do not have to match. Grouping into directories earns its keep when **three or more files share one concern and you have started scrolling a file listing to find things** — in practice somewhere past 15–20 files. Below that, a flat directory is easier to navigate than a shallow tree, and inventing `core/` or `lib/` to hold four files is the junk drawer with a nicer name. When you do group, group by domain job (`billing/`, `search/`), never by kind (`models/`, `helpers/`) — see `group-by-feature-not-by-type`. Say in the plan file which layout you chose and why; "stayed flat, 11 files, under the threshold" is a real decision and stops the next campaign re-litigating it.

**Write the dependency rule** — one sentence saying which direction dependencies point (e.g., "delivery → app → domain; adapters implement domain-owned interfaces; nothing depends on main"). Every future move is checked against this sentence. A design containing a cycle is wrong on paper — fix it now, where it costs nothing.

**Build the disposition table.** Every existing module gets a row: current location → destination (or "stays" / "delete" / "merge into X"). No module may be unaccounted for; "we'll figure that one out later" is where campaigns stall.

**Order the moves by risk and value:**
- **Break cycles first.** Everything else is easier once dependencies point one way.
- **Then relocate misplaced logic and consolidate duplicates** — highest value per move, mostly in the hotspots.
- **Strangle the big rotten subsystems last**, when the ground around them has stopped moving.
- Start the campaign with one low-risk, visible move to validate the net and the loop before betting on bigger cuts.

Write shape, rule, disposition table, and ordered checklist into the plan file. **Present the design before executing** when working interactively; when autonomous, commit the plan file so the design is reviewable, then proceed.

---

## Phase 4: Migrate

Execute the checklist. New structure grows alongside old; callers migrate incrementally; nothing breaks in between.

**The move loop.** For every move:

```
1. Read the code involved and every caller.
2. Execute the move (verbatim relocation; structure changes, code text doesn't).
3. Build. Fix wiring errors (imports, visibility) — nothing else.
4. Run the tests. Green required.
5. Commit, message naming the move: "break-cycle-by-inversion: orders <-> customers".
6. Update the plan file (same commit); if the move created a parallel old/new
   path, confirm its deletion entry exists on the checklist.
```

If step 3 or 4 fails and the cause isn't an obvious wiring slip, **revert and split the move.** A move that won't go green found a coupling the map missed — usually a hidden dependency. Map it, add a preparatory move (`introduce-seam`, smaller strangler slice), retry.

**Reverting means returning to the last green commit, not editing your way out.** `git checkout -- <path>` restores one file; `git reset --hard` discards all uncommitted changes. Both discard uncommitted work, which is the point — it is why every move gets its own commit. If you are unsure of the commands, or need to recover something you thought was lost, use the `git` skill rather than improvising on a repository mid-campaign.

**Migrating many call sites:** never all at once when the count is large. Route a few callers to the new path, green, commit; repeat. The half-migrated state is fine — that's what the parallel path is for — but it must be *visibly* half-migrated: the plan file says how many callers remain.

### What breaks when code crosses a module boundary

Relocation converts implicit same-module access into an explicit interface. Everything the moved code *offers* needs a deliberate decision about who may touch it, and everything it *used* must travel with it or be imported. Expect all three on almost every move:

- **Visibility.** What was reachable because it shared a module is not reachable across the new boundary. Languages that default to private make you say so item by item — and some make *fields* private individually even when the type is public, so making the type public is not enough.
- **Names the moved code depended on.** Helpers, constants, and types it referenced must come along or be imported. Nothing checks this half in a dynamic language.
- **Registration points.** Legacy systems wire things up in places a move does not touch: DI containers, route tables, plugin registries, serialization mappings, migration lists. Code that relocated cleanly can still be unreachable — or reachable under a name that no longer resolves — because a registry still points at the old location.

**How you find out decides how you verify.** A compiler that refuses the build hands you the complete list for free: fix exactly what it names and nothing more. Where nothing checks — dynamic languages, reflection, string-keyed DI, runtime templates, config-driven wiring — the build and the unit tests can both pass while a moved function references a name that never arrived, or while a registry still points somewhere else. There, green is not evidence: exercise the moved code through a path that actually runs it, and grep the codebase (and the config) for the old module's name before calling the move done.

**Fix the whole error list in one pass, then rebuild once.** The build reports every error it found — that output is the complete to-do list for this move. Read all of it, make every fix in a single batched edit, rebuild once. Fixing one, rebuilding, fixing the next turns a twenty-error move into six rebuild cycles. Two habits cause it: **head-truncating compiler output** (`| head -40`, `| Select-Object -First 40`), which hides most of the list behind the few errors that fit and makes you rediscover them; and making one edit per call when the editor offers a batch form. Ask the toolchain for a compact one-line-per-error format instead, and batch the edits.

**Grant the narrowest visibility that works.** Under a wall of privacy errors the reflex is to make everything public, which produces modules with no encapsulation — the boundary you were trying to repair, erased at the moment you drew it. Decide the narrowest workable visibility *per item* — a judgement about each name, not a reason to rebuild between fixes; make the decisions, then apply them together. A caller reaching for a field is usually a caller that wants a method.

**A block's range starts above its declaration line** — attributes, annotations, decorators, and the doc comment written for it all belong to the block, and an attribute left behind can silently change what the moved code means. When moving several blocks out of one file, work bottom-up: a deletion renumbers everything below it and nothing above.

**Move large blocks by line range, not by retyping.** Retyping hundreds of lines invites transcription typos, and a whole-file write larger than your output budget arrives truncated. Write only the destination's small header by hand, then relocate the body as actual lines: where the environment has line-range tools (in foreman-cli: `copy_lines`, then `delete_lines`), use those — they preserve line endings and back up automatically; otherwise use an editor line-range copy or a script that slices the range and rejoins with the file's own terminator, verifying the terminator survived. If an exact-match edit is refused, don't re-guess invisible bytes — copy the snippet verbatim from tool output or switch to the line-range tools, and re-read the file after any splice before editing it again.

**Discoveries go in the plan file, not the diff.** Bugs found: noted, not fixed. Better design spotted: plan file updated with a written reason, then continue. Silent divergence between plan and reality is how campaigns rot.

---

## Phase 5: Consolidate

The checklist is done. Now make it permanent — this phase is what separates a restructure from a mess with more parts:

- **Delete every old path.** Grep for the strangled implementations, the pre-cutover shims, the branch-by-abstraction switches that now have one branch. If any parallel path must outlive the campaign, that is a documented decision in the plan file with an owner and a date — not a silence.
- **Verify the dependency rule holds everywhere.** Check every module's imports against the rule from Phase 3.
- **Enforce the boundaries mechanically.** Structure that only lives in a document rots again. Use whatever the ecosystem offers — import-linting, architecture tests, module visibility, workspace/package boundaries — so a violating change fails the build, not a code review.
- **Document the structure where developers will see it** (README or architecture note): the layers/features, the dependency rule, one line on what lives where. Short enough to stay true.
- **Full build and test from clean.** Both green, results reported honestly.
- **Close the plan file:** status → complete, summary of what moved, list of noted-but-unfixed bugs for follow-up.

**Then hand off to clean-code.** This skill repaired the boundaries; the insides of the modules are as messy as they always were. Run the `clean-code` skill (refactor mode) over the hotspots — as a separate campaign with the same green-between-steps discipline.

---

## Move Catalog

The named moves referenced by the checklist. Each: when to use it, how, and the pitfall that ruins it.

### `introduce-seam`
**When:** you need to cut, test, or substitute at a point where code is welded together — direct calls into a concrete dependency, hard-wired construction, logic fused to a framework.
**How:** introduce a substitution point at the boundary: an interface, an injected parameter, a factory. Callers use the seam; behavior is unchanged; now tests and new implementations can plug in. Often the mandatory first move before any other move is possible.
**Pitfall:** seams everywhere "for flexibility." A seam is scaffolding for a cut you are about to make; speculative seams are indirection debt.

### `break-cycle-by-inversion`
**When:** two modules depend on each other, directly or through a chain.
**How:** find the thinnest strand — usually one module needs only a small piece of the other. Invert that strand: define an interface (or callback/event) owned by the module that *shouldn't* know about the other; the other implements or subscribes. Dependencies now point one way.

```
// Before: orders -> customers (for tier lookup), customers -> orders (for history). Cycle.

// After: orders owns the interface for the one thing it needs
module orders:
    interface TierSource: tier_for(customer_id)
    function discount(order, tiers: TierSource): ...

module customers implements orders.TierSource      // customers -> orders, one way
// main wires: orders.discount(order, customers)
```

**Pitfall:** "fixing" the cycle by merging the modules. That hides the tangle inside a bigger box. Merge only when the map shows the two genuinely form one responsibility.

### `extract-shared-kernel`
**When:** a cycle or duplication exists because two modules both need the same core types or logic, and neither should own it.
**How:** move the shared elements into a new module *beneath* both; both depend on it, it depends on neither.
**Pitfall:** kernel bloat. Only what both sides genuinely need moves; the moment the kernel imports one of its dependents, you've rebuilt the cycle with a third participant.

### `relocate-misplaced-logic`
**When:** business rules live in delivery code (handlers, controllers, UI), infrastructure code, scripts, or SQL — anywhere but the domain module that owns the concept.
**How:** move the rule to its owning module verbatim; the old site keeps a call to the new location. One relocation per commit. If several variants of the rule exist in several wrong places, relocate the canonical one first, then fold the others in via `consolidate-duplicates`.

```
// Before: refund policy living in the HTTP handler
handler POST /refunds:
    if order.age_days > 30 or order.category == "final_sale": respond(403)
    ...

// After: the handler delivers; the domain decides
handler POST /refunds:
    if not billing.refundable(order): respond(403)
    ...
module billing:
    function refundable(order):          // moved verbatim from the handler
        return not (order.age_days > 30 or order.category == "final_sale")
```

**Pitfall:** "tidying" the rule as it moves. Behavior differences between variants are real and sometimes load-bearing; relocate verbatim, reconcile deliberately with tests around you.

### `consolidate-duplicates`
**When:** the same concept is implemented more than once — retry loops, validators, formatters, config readers.
**How:** **diff the variants first**; duplicates are almost never identical, and the differences are often forgotten bug fixes. Choose the canonical behavior deliberately (note the choice in the plan file), make one implementation carry it, migrate call sites one at a time, delete the losers.
**Pitfall:** assuming the copies are the same. Silently unifying different behaviors is a behavior change wearing a refactor's clothes — the exact thing rule 1 forbids.

### `strangler-fig`
**When:** a subsystem is too big and too rotten to move in any single step — the legacy report generator, the old persistence layer.
**How:** build the new structure alongside the old. Route callers over one slice at a time — by call site, by feature, by input type — old subsystem handling everything not yet routed. Each routing step is a green commit. When nothing reaches the old code, delete it.

```
// The router is the fig; slices move one green commit at a time
function generate_report(kind, data):
    if kind in ("sales", "inventory"):      // migrated slices grow...
        return reports_v2.generate(kind, data)
    return legacy_reports.generate(kind, data)   // ...this shrinks to nothing, then dies

// Plan file: "strangler-fig: reports — 2/7 kinds migrated. DELETE legacy_reports
//             + this router when 7/7."
```

**Pitfall:** the immortal strangler — both systems alive for years. The deletion entry goes on the checklist the day the new path is born; a strangler without a kill plan is a second copy of the problem.

### `branch-by-abstraction`
**When:** many callers must migrate from an old implementation to a new one, and a long-lived VCS branch would rot.
**How:** put an abstraction over the old implementation and point all callers at it (green, commit). Build the new implementation behind the same abstraction. Flip — ideally per-caller or behind a toggle. Delete the old implementation *and the toggle*.
**Pitfall:** leaving the abstraction after only one implementation remains. If it earns nothing ongoing, collapse it — indirection with one target is a dead layer you just built.

### `collapse-dead-layer`
**When:** a layer only forwards calls — pass-through services, wrapper-of-wrapper, managers that manage nothing.
**How:** verify it adds nothing (no logic, no translation, no policy, no boundary anyone relies on), point callers past it, delete it.
**Pitfall:** deleting a layer that *looks* empty but marks a boundary the target architecture wants — today's pass-through may be the designed seam between domain and adapter. Check the Phase 3 design before collapsing.

### `unify-vocabulary`
**When:** one concept has many names across modules, or one name means different things — and it's causing wrong code, not just aesthetic itch.
**How:** pick the canonical term per concept and record it in the plan file. Rename module by module with tooling, green between steps. Names in external contracts — serialized fields, API parameters, schema columns — do *not* change (or change only behind explicit compatibility mapping).
**Pitfall:** the repo-wide rename commit. It collides with every in-flight change and hides real errors in a thousand-line diff. Module by module, like everything else.

### `anti-corruption-layer`
**When:** a subsystem you cannot fix now — an external service, a vendor SDK, a legacy region deferred to a later campaign — leaks its types and conventions through the codebase.
**How:** wrap it: one module translates between its model and yours, and the rest of the codebase touches only your model. The mess is quarantined behind one door.
**Pitfall:** the translation layer growing business logic. It translates, nothing else; the moment it makes domain decisions, the corruption is inside the walls.

---

## Decision Table

| Situation | Action |
|-----------|--------|
| The mess is one or a few giant files | `refactor-monolith` first; this campaign after |
| Map reveals sprawl too big for one campaign | Scope to the worst cycle cluster or hottest subsystem; agree; bounded beats total |
| Wondering whether to introduce directories | Group when 3+ files share a concern *and* the listing needs scrolling (~15-20 files); below that stay flat and record the choice |
| A previous campaign left a Deferred list | Read it before designing — its boundary findings are Phase 1 evidence you don't have to re-derive |
| A dependency cycle | `break-cycle-by-inversion`; `extract-shared-kernel` when both need the same core |
| Business rules in handlers/UI/scripts | `relocate-misplaced-logic` |
| Same concept implemented 3 times | Diff first, then `consolidate-duplicates` |
| Subsystem too rotten to move at once | `strangler-fig`, with the deletion entry written on day one |
| Many callers must switch implementations | `branch-by-abstraction` |
| Can't test the thing you're about to cut | `introduce-seam` first |
| A layer that only forwards calls | Check the design intent, then `collapse-dead-layer` |
| External system's types leak everywhere | `anti-corruption-layer` |
| Duplicate variants behave differently | Choose canonical behavior deliberately, note in plan file, test it |
| A move keeps breaking | Revert; find the hidden coupling; add a preparatory move |
| Build fails on privacy/imports right after a move | Expected — read the whole list, fix all of it in one batched edit, rebuild once |
| Tempted to truncate build output to keep it short | Never head-truncate errors; ask for a compact one-line-per-error format instead |
| Tempted to make everything public to clear the errors | Choose narrowest-workable per item, then apply the decisions together |
| Language has no compile-time check (dynamic, reflection, string-keyed DI) | Green isn't evidence — run the moved code through a real path, and grep config for the old location |
| Moved code builds but is never reached | A registry still points at the old location: DI container, route table, plugin list, serialization map |
| Found a bug mid-move | Note in plan file; fix in a separate change |
| Team is actively developing in the same code | Smaller moves, merge often; never a long-lived restructure branch |
| Change would alter a wire format, schema, or CLI output | Stop — that's a behavior change; keep the contract, or get explicit sign-off outside this campaign |
| Session ending mid-campaign | Commit green, update plan file; next session resumes from it |
| Both old and new paths still alive at campaign end | Not done — delete, or document owner + date in the plan file |

---

## Rationalizations — and Reality

| Excuse | Reality |
|--------|---------|
| "This is beyond saving — rewrite it" | The rewrite loses ten years of embedded fixes and ships in twice the promised time. Strangle it instead. |
| "We'll do the restructure on a branch and merge when done" | The long-lived branch diverges daily and dies in merge hell. Small green steps on the mainline survive. |
| "Both paths can coexist; we'll delete the old one someday" | Someday never comes, and now there are two systems to maintain. Deletion goes on the checklist on day one. |
| "These duplicates are obviously the same, just unify them" | They differ, and one difference is a bug fix from an outage. Diff first, choose deliberately. |
| "The variants disagree, so it's a live bug — unifying is a fix, not a change" | Which variant is *right* is a product decision you don't own. Preserve both behaviors, document the disagreement in the plan file, and let the owner rule on it outside the campaign. |
| "The schema tweak is internal, nobody will notice" | Persisted data and wire formats are behavior. Somebody's parser will notice at 2 a.m. |
| "I'll fix this bug while I'm moving the code" | Now the tests can't tell the relocation from the fix. Note it, move on, fix separately. |
| "Renaming everything to the new vocabulary in one pass is cleaner" | The thousand-line rename diff hides real errors and collides with all in-flight work. Module by module. |
| "No time for characterization tests, the suite is decent" | "Decent" measured against which seams? The move you can't verify is the one that breaks production. |
| "The map is obvious from the directory names" | Directories show intent; imports show truth. Rot lives in the gap between them. |
| "The plan file is overhead, I'll remember" | Your context ends. The plan file is the campaign's memory across sessions and agents. |
| "It compiles and the old tests pass, ship it" | Pass on which seams? If the cut isn't covered, green means nothing there. Check coverage against the move. |

**Red flags — stop and revert if you catch yourself:**
- A "refactor" diff that changes outputs, errors, formats, or schemas
- Moving code you haven't read
- A commit containing several moves
- Three fixes stacked on a move that won't go green
- A strangler or abstraction with no deletion entry on the checklist
- Unifying duplicates you haven't diffed
- Claiming green without running the tests this move

---

## Scope and Precedence

- **Explicit user instructions override this skill.** Note the conflict briefly, then follow the user.
- **Project conventions override generic architecture.** If the ecosystem has a standard layout or the team has a documented structure, converge on that — never fight the toolchain or the team.
- The campaign's scope is what was agreed in Phase 1/3: those subsystems, toward the approved architecture. Rot outside scope gets a note in the plan file, not a drive-by fix.
- **After the campaign,** run the `clean-code` skill over the restructured modules — the boundaries are repaired; the insides still need naming, function-size, and error-handling polish. Separate campaign, same discipline.
