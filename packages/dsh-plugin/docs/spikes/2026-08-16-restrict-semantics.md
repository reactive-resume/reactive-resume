# Spike: does `ctx.tools.restrict()` reach a child scope's tools?

**Verdict up front:** `restrict reaches child-scope tools: NO`

The plugin's own `apply(ctx, config)` — a bare Cordis plugin context that
never mints a `dsh-scope` scope — cannot call `ctx.tools.restrict()` at all.
It throws. When the arrangement is fixed so `restrict()` is at least
callable (a real agent-style scope), it still refuses to touch a tool the
bridge registered inside that same scope's own layer. Neither path reaches
the topology this plugin needs. The `tools` config key must not ship in
0.1.0.

## Environment and bootstrapping

Scaffolded a throwaway workspace at `/tmp/dsh-spike` (deleted after this
spike; nothing there is part of the plugin repo).

```bash
mkdir -p /tmp/dsh-spike && cd /tmp/dsh-spike && pnpm init
```

**Version resolution problem.** `pnpm add @deepseek-ai/cordis @deepseek-ai/dsh-tools @deepseek-ai/schemastery`
with no version pins resolves `dsh-tools` to its `next` dist-tag
(`0.1.0-rc.6`), whose peer chain requires `@deepseek-ai/dsh-agent` and
`@deepseek-ai/dsh-session`, both of which peer-depend on
`@deepseek-ai/dsh-type-meta` — a package that returns a plain 404 from the
public npm registry (confirmed directly: `npm view @deepseek-ai/dsh-type-meta`
→ `404 Not Found`). Pinning `dsh-tools` to `0.0.1-rc.1` (the version this
plugin actually targets — confirmed via `npm view @deepseek-ai/dsh-tools
dist-tags`, where `latest` is `0.0.1-rc.1`) does not by itself fix this: pnpm
still auto-installs peer dependencies for the lockfile, so the same
`dsh-type-meta` 404 recurs indirectly through `dsh-agent`'s and
`dsh-session`'s peer graph.

**Fix that worked:** disable pnpm's peer auto-install and add only the
packages `dsh-tools`'s _compiled_ `lib/index.js` actually imports at
runtime (checked directly — `import type` lines don't need the package on
disk, real `import` lines do):

```
import { Service } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { AnonymousEntries, NamedEntries, ScopedLayers, scopeOf, scopeTarget } from "@deepseek-ai/dsh-scope";
import { CallId, HarnessError, assertNever, deepFreeze } from "@deepseek-ai/dsh-llm";
import { isJsonValue, snapshotJsonValue } from "@deepseek-ai/dsh-session";
```

`.npmrc`:

```
auto-install-peers=false
strict-peer-dependencies=false
```

Install commands, in order (each added only after the previous run's
`ERR_MODULE_NOT_FOUND` named the next missing runtime import):

```bash
pnpm add @deepseek-ai/cordis@^4.0.1-rc.1 @deepseek-ai/dsh-tools@0.0.1-rc.1 @deepseek-ai/schemastery@^3.18.1-rc.1 \
  --config.auto-install-peers=false --config.strict-peer-dependencies=false
pnpm add @deepseek-ai/dsh-scope@0.0.1-rc.1 @deepseek-ai/dsh-llm@0.0.1-rc.1 @deepseek-ai/dsh-session@0.0.1-rc.1 \
  --config.auto-install-peers=false --config.strict-peer-dependencies=false
pnpm add @deepseek-ai/dsh-system-prompt@0.0.1-rc.1 @deepseek-ai/dsh-invariants@0.0.1-rc.1 \
  --config.auto-install-peers=false --config.strict-peer-dependencies=false
pnpm add @deepseek-ai/dsh-timeout@0.0.1-rc.1 \
  --config.auto-install-peers=false --config.strict-peer-dependencies=false
```

`dsh-system-prompt` and `dsh-invariants` were needed for a second reason,
not just a `dsh-tools` runtime import: `ToolRegistry.inject = ["systemPrompt"]`
and its constructor calls `ctx.systemPrompt.tools(...)` immediately, so a
`systemPrompt` service must be mounted on `ctx` _before_ `ToolRegistry` is.
`dsh-timeout` surfaced one level further down, as a real (non-type) import
inside `dsh-llm`'s compiled output.

None of the packages actually needed at `0.0.1-rc.1` depend on
`dsh-type-meta` — only `dsh-agent` and `dsh-session`'s _peer_ list does
(`dsh-session` doesn't import it at runtime, so it was never installed and
never missed). Final resolved set: `cordis@4.0.1`, `dsh-tools@0.0.1-rc.1`,
`schemastery@3.18.1`, `dsh-scope@0.0.1-rc.1`, `dsh-llm@0.0.1-rc.1`,
`dsh-session@0.0.1-rc.1`, `dsh-system-prompt@0.0.1-rc.1`,
`dsh-invariants@0.0.1-rc.1`, `dsh-timeout@0.0.1-rc.1`.

**Dead end worth recording:** before finding the npm-registry version-pin
fix, I found a fully-resolved install of these packages already on disk at
`~/.local/share/mise/installs/node/24.19.0/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/*`
(the globally-installed `dsh` CLI's own bundled `node_modules`). That
install is `dsh-tools@0.1.0-rc.6`, not `0.0.1-rc.1` — a different minor
line with a renamed class (`ToolRuntime`, not `ToolRegistry`) and a
different `register`/`restrict`/`schemas` signature (`scope?: ScopeKey`
parameter instead of implicit calling-context resolution). I did **not**
use this install for the verdict below — it's the wrong pinned version for
this plugin — but it's why the bootstrapping path above took several
iterations: I initially assumed the API surface from that install, then had
to re-derive it from the actually-pinned `0.0.1-rc.1` types.

## The actual `ToolDefinition` shape (0.0.1-rc.1)

The brief's guessed shape (`parameters`, bare `async execute() { return
{content:[...]} }`) doesn't compile against `node_modules/@deepseek-ai/dsh-tools/lib/types/index.d.ts`.
The real shape:

```ts
export interface ToolDefinition extends ToolSchema {
	// ToolSchema = { name: string; description: string; parameters: Record<string, unknown> }
	readonly output: ToolOutputDefinition; // MANDATORY, not optional
	execute(args: unknown, exec: ToolRunContext): Promise<unknown>; // returns the canonical value, not ContentBlock[]
	finalizeContent?(...): ContentBlock[] | undefined;
	timeoutMs?: number;
	isConcurrencySafe?(args: unknown): boolean;
	presentCall?(args: unknown): ToolCallView | undefined;
	presentResult?(args: unknown, result: ToolResult): ToolResultView | undefined;
}
interface ToolOutputDefinition {
	readonly schema: JsonSchemaNode;             // enforced JSON Schema subset
	render(args: unknown, value: JsonValue): ContentBlock[]; // projects the canonical value to model-facing content
	presentationMeta?(args: unknown, value: JsonValue): JsonValue;
}
```

`execute()` returns the tool's canonical JSON value (validated against
`output.schema`); `output.render()` is what turns that value into
`ContentBlock[]`. `register()` throws a `TypeError` if `output` is missing
or `output.render` isn't a function — confirmed by reading
`ToolRegistry.register` in the compiled `lib/index.js`.

`ToolRegistry` itself: `export { ToolRegistry, ToolRegistry as default }` —
it's a Cordis `Service` subclass (`super(ctx, "tools")`), so it's mounted
with `ctx.plugin(ToolRegistry, config)`, not `ctx.plugin(tools)` where
`tools` is the whole module namespace (the brief's guess).

## The mechanism (read from the compiled source, then verified by running it)

`declare module '@deepseek-ai/cordis' { interface Context { tools: ToolRegistry } }`
— `ctx.tools` is one Cordis **service singleton**, shared down the whole
context tree exactly like every other Cordis service. There is no
per-Cordis-child-context instance of the registry; nesting a plugin under
`ctx.plugin(...)` does not give it a private `tools`.

What actually gates `register()`/`restrict()`'s visibility isn't the Cordis
plugin-context tree at all — it's a **separate, opt-in scoping layer** from
`@deepseek-ai/dsh-scope`:

- `scopeOf(ctx)` reads "the nearest scope tag inherited by a context" — and
  a context only carries a scope tag if something called
  `createScope(ctx, key)` on it (or a Cordis ancestor of it). A plain
  `ctx.plugin(child)` context is **not** scoped by that call alone.
- `ToolRegistry.register(definition)`: `this.layers.effect(this.ctx, (layer) => layer.tools.insert(name, definition), ...)` —
  lands in whatever layer `scopeOf(this.ctx)` resolves to (the global layer
  if unscoped). No scope requirement to call it.
- `ToolRegistry.restrict(filter)`: the **first line** is
  `const scope = scopeOf(this.ctx); if (scope === void 0) throw new Error("tools.restrict() requires a scoped context (agent.ctx): ...")`.
  It is unconditionally unusable from an unscoped context — this is not a
  silent no-op, it's a thrown error.
- Even when `scope !== undefined`, `restrict()` computes
  `known = this.view(scope).restrictableNames` (the scope's _inherited_
  surface — global + ancestor layers) and rejects any name not in that set:
  `"a restriction filters what this scope inherits, never what it registers itself"`.
  A tool registered as a **child** of the exact scope doing the restricting
  is, by construction, in that scope's own layer, not its inherited surface
  — so it is unconditionally unreachable by that scope's own `restrict()`
  call, confirmed by the second probe below.

This is a stricter, more mechanical version of what the `ToolRestriction`
docstring already said in prose (`"do not affect the scope's own
registrations"`) — the two probes below hit it from two different angles
and got two different thrown errors, not one graceful no-op.

## Probe 1 — the literal topology from the task brief

`ctx.plugin(mcpClient)` mounts the bridge as a Cordis **child** of the
plugin's own `apply(ctx, config)`; the plugin then calls
`ctx.tools.restrict(...)` from its own (parent, unscoped) `ctx`. This
reproduces the plugin's real design as literally as a stub allows.

`/tmp/dsh-spike/probe.ts`:

```ts
import { Context } from "@deepseek-ai/cordis";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import ToolRegistry from "@deepseek-ai/dsh-tools";

const root = new Context();

// ToolRegistry.inject = ["systemPrompt"], and its constructor calls
// ctx.systemPrompt.tools(...) immediately, so systemPrompt must be mounted first.
await root.plugin(SystemPrompt);
await root.plugin(ToolRegistry);

/** Stands in for dsh-mcp-client: registers one tool in whatever scope loads it. */
const stubBridge = {
  name: "stub-bridge",
  inject: ["tools"],
  apply(ctx: Context) {
    ctx.tools.register({
      name: "mcp__resume__list_applications",
      description: "stub",
      parameters: { type: "object", properties: {} },
      output: {
        schema: { type: "string" },
        render: (_args: unknown, value: unknown) => [{ type: "text", text: String(value) }],
      },
      async execute() {
        return "ok";
      },
    });
  },
};

// The plugin under design mounts the bridge as a child, exactly like this.
await root.plugin(stubBridge);

const names = () => root.tools.schemas().map((s) => s.name);
console.log("BEFORE", names());

try {
  const dispose = root.tools.restrict({ deny: ["mcp__resume__list_applications"] });
  console.log("AFTER", names());
  dispose();
  console.log("DISPOSED", names());
} catch (err) {
  console.log("RESTRICT_THREW", (err as Error).message);
}
```

Run with `node --experimental-strip-types probe.ts`. Actual output,
verbatim:

```
BEFORE [ 'mcp__resume__list_applications' ]
RESTRICT_THREW tools.restrict() requires a scoped context (agent.ctx): a context-global restriction would mask every agent — deny the tool for the intended agent instead
```

`restrict()` never gets a chance to filter anything — it throws before
touching the tool set, because `root` (and every context under it, absent
an explicit `createScope()`) is unscoped.

## Probe 2 (Step 4) — the best-case sibling arrangement

Per the brief's Step 4, tried fixing the exception by giving the plugin a
real `dsh-scope` scope (what `createScope()` provides) and calling
`restrict()` from _inside_ that scope, matching "registering the
restriction inside the same scope the bridge loads into."

Where a real agent gets this: `@deepseek-ai/dsh-agent-loop@0.0.1-rc.1`
`lib/index.js:375` —

```js
this.scope = createScope(loopCtx, this);
this.ctx = this.scope.ctx.extend({ agent: this });
```

— **not** `dsh-agent`, which never calls `createScope` (its compiled
`lib/index.js` only calls `scopeTarget`, for event routing, not for minting
a scope). This is the exact line that builds `agent.ctx` — the thing
`ToolRegistry`'s thrown error message names as what `restrict()` requires.
Confirmed directly: installed both `dsh-agent@0.0.1-rc.1` and
`dsh-agent-loop@0.0.1-rc.1` with the same
`--config.auto-install-peers=false --config.strict-peer-dependencies=false`
workaround used for the rest of the dependency tree (`dsh-type-meta` is only
a _peer_ dependency of `dsh-agent`, never a runtime import — same situation
as `dsh-session`/`dsh-scope` above — so it's never actually needed on disk),
then grepped the installed `lib/index.js` files for `createScope`.

`/tmp/dsh-spike/probe2.ts`:

```ts
import { Context } from "@deepseek-ai/cordis";
import { createScope } from "@deepseek-ai/dsh-scope";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import ToolRegistry from "@deepseek-ai/dsh-tools";

const root = new Context();
await root.plugin(SystemPrompt);
await root.plugin(ToolRegistry);

const stubBridge = {
  name: "stub-bridge",
  inject: ["tools"],
  apply(ctx: Context) {
    ctx.tools.register({
      name: "mcp__resume__list_applications",
      description: "stub",
      parameters: { type: "object", properties: {} },
      output: {
        schema: { type: "string" },
        render: (_args: unknown, value: unknown) => [{ type: "text", text: String(value) }],
      },
      async execute() {
        return "ok";
      },
    });
  },
};

// Mint a dsh-scope "Scope" (what dsh-agent-loop does to build agent.ctx --
// see lib/index.js:375) and mount the bridge as a CHILD of that scope's ctx
// -- i.e. an inherited/ancestor registration relative to the scope itself,
// not the scope's own layer.
const scopeKey = {};
const scope = createScope(root, scopeKey);
await scope.ctx.plugin(stubBridge);

const namesFor = (ctx: Context) => ctx.tools.schemas(scopeKey).map((s) => s.name);
console.log("BEFORE(scoped view)", namesFor(root));

// Cordis requires a plugin to declare inject: ['tools'] to bare-access
// ctx.tools; call restrict() from inside a plugin mounted on scope.ctx so
// the "calling scope" Cordis sees is the scope itself (agent.ctx-equivalent).
let disposeRestrict: (() => void) | undefined;
const restrictor = {
  name: "stub-restrictor",
  inject: ["tools"],
  apply(ctx: Context) {
    try {
      disposeRestrict = ctx.tools.restrict({ deny: ["mcp__resume__list_applications"] });
      console.log("AFTER(scoped view)", namesFor(root));
    } catch (err) {
      console.log("RESTRICT_THREW", (err as Error).message);
    }
  },
};
await scope.ctx.plugin(restrictor);

if (disposeRestrict) {
  disposeRestrict();
  console.log("DISPOSED(scoped view)", namesFor(root));
}
```

Run with `node --experimental-strip-types probe2.ts`. Actual output,
verbatim:

```
BEFORE(scoped view) [ 'mcp__resume__list_applications' ]
RESTRICT_THREW tools.restrict() names unknown inherited tool "mcp__resume__list_applications"; a restriction filters what this scope inherits, never what it registers itself. Restrictable tools: (none)
```

`restrict()` is now at least _callable_, but it explicitly refuses: the
bridge's tool lives in the same scope's own layer (it was mounted as a
Cordis child of `scope.ctx`, which is what makes it inherit that scope
tag), and `restrict()`'s error message says outright that it will never
touch a scope's own registrations, only what it inherits from an ancestor.
`Restrictable tools: (none)` — there was nothing in this arrangement for
the scope to restrict, because nothing was registered in any ancestor of
it.

I did not chase the remaining permutation (bridge registered as an
_ancestor_ scope's own layer, restrict called from a _descendant_ scope of
that ancestor) — the class-level doc comment in `dsh-tools` confirms that
shape is the one `restrict()` is actually built for (a parent scope curbing
what a child scope inherits from it), but it doesn't match this plugin's
topology: the plugin's `apply(ctx, config)` runs once at harness startup,
before any real agent scope exists, and isn't in a position to be an
ancestor of the eventual agent's scope. Chasing it further would still not
produce an arrangement reachable from this plugin's own `apply(ctx, config)`,
which is the brief's actual bar for flipping the verdict to YES. Time spent
on Step 4: about 15 minutes, well under the 30-minute cap.

I did not spin up a full agent loop from `dsh-agent`/`dsh-agent-loop` (the
stub plugins above stand in for one, per the brief's instruction not to need
a live agent) — but I did install both packages and grep their compiled
output to confirm the `createScope()` attribution above, as noted earlier in
this section. No residual gap remains on that point.

## Verdict

```
restrict reaches child-scope tools: NO
```

Both the literal plugin topology (unscoped `restrict()` call → throws
immediately) and the best-case fix for that (scoped `restrict()` call →
throws with "unknown inherited tool" because the bridge's registration is
the scope's own, not inherited) fail to hide the child-registered tool. The
`tools` config key is deferred out of 0.1.0, per Task 6's fallback note.

## Cleanup

```bash
rm -rf /tmp/dsh-spike
```
