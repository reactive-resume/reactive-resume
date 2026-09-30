# dsh-plugin-reactive-resume Implementation Plan

> **Historical record.** This plan was written and executed while the plugin lived in its own repository. It has since moved into the Reactive Resume monorepo at `packages/dsh-plugin`, where tests are colocated in `src/*.test.ts`, the build emits `dist/`, and the generated tool-name snapshot and its scheduled drift job were replaced by a local check against `@reactive-resume/mcp/tool-names`. Paths below are not current.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an npm-distributed DeepSeek Harness plugin that connects a Harness session to a Reactive Resume account through the existing `/mcp` endpoint, curates the tool surface, and teaches the model Reactive Resume's JSON Patch semantics.

**Architecture:** A namespace Cordis plugin exporting `name`, `inject`, `Config`, and `apply(ctx, config)`. `apply` mounts `@deepseek-ai/dsh-mcp-client` over Streamable HTTP with an `x-api-key` header, optionally narrows the bridged tools with `ctx.tools.restrict`, and registers one system-prompt section via `ctx.systemPrompt.section`. The plugin holds no Reactive Resume code — it speaks HTTP to a server that already exists.

**Tech Stack:** TypeScript, pnpm, `tsdown` (build), Vitest (test), Biome (lint/format), `@deepseek-ai/cordis` + `@deepseek-ai/dsh-mcp-client` + `@deepseek-ai/dsh-tools` + `@deepseek-ai/dsh-system-prompt` + `@deepseek-ai/schemastery` (peer deps).

**Spec:** `docs/2026-08-16-design.md`

## Global Constraints

- Node `^22.19.0 || >=24.0.0`. Package manager: pnpm.
- `type: "module"`. ESM only. No CJS build.
- All four `@deepseek-ai/*` runtime packages are `peerDependencies` at `^0.0.1-rc.1`, never `dependencies`. The host supplies them.
- Public tool names bridged by `dsh-mcp-client` are `mcp__<serverName>__<rawName>`. Default `serverName` is `resume`.
- `serverName` must match `[A-Za-z0-9_-]{1,32}`.
- System prompt section `order` must be in the 100–199 tool-guidance band. This plan uses `150`.
- Default Reactive Resume origin is `https://rxresu.me` with no trailing slash.
- Auth header is exactly `x-api-key` (lowercase).
- Never commit an API key. Tests use the literal string `test-key`.

---

### Task 1: Spike — does `restrict()` reach a child scope's tools?

This task produces a written finding, not shipped code. It gates the `tools` config key in Task 3 and the `ctx.tools.restrict` call in Task 6.

`ToolRegistry.restrict` documents itself as filtering only what a scope **inherits** from ancestors: _"Per-scope filter over the tools a scope INHERITS — the global layer and every ancestor layer on its chain. Restrictions intersect, and do not affect the scope's own registrations."_ But `ctx.plugin(mcpClient, …)` mounts the bridge in a **child** scope of the plugin's context. If a parent-scope restriction cannot reach a child scope's registrations, the `tools` key must not ship in 0.1.0 — removing a public config key later is a breaking change.

The question is purely about Cordis scope semantics. It does not need a live MCP server, a Reactive Resume instance, or an API key: a stub plugin that registers one tool in a child scope reproduces the exact topology. Verify it that way.

**Files:**

- Create: `docs/spikes/2026-08-16-restrict-semantics.md`

- [ ] **Step 1: Scaffold a throwaway workspace**

```bash
mkdir -p /tmp/dsh-spike && cd /tmp/dsh-spike
pnpm init
pnpm add @deepseek-ai/cordis @deepseek-ai/dsh-tools @deepseek-ai/schemastery
```

- [ ] **Step 2: Write the probe**

Create `/tmp/dsh-spike/probe.ts`. The goal is to reproduce the plugin's topology: a parent context loads a child plugin, the child registers a tool, and the parent tries to hide it.

```ts
import { Context } from "@deepseek-ai/cordis";
import * as tools from "@deepseek-ai/dsh-tools";

const root = new Context();
await root.plugin(tools);

/** Stands in for dsh-mcp-client: registers one tool in whatever scope loads it. */
const stubBridge = {
  name: "stub-bridge",
  inject: ["tools"],
  apply(ctx: Context) {
    ctx.tools.register({
      name: "mcp__resume__list_applications",
      description: "stub",
      parameters: { type: "object", properties: {} },
      async execute() {
        return { content: [{ type: "text", text: "ok" }] };
      },
    });
  },
};

// The plugin under design mounts the bridge as a child, exactly like this.
await root.plugin(stubBridge);

const names = () => root.tools.schemas().map((s) => s.name);
console.log("BEFORE", names());

const dispose = root.tools.restrict({ deny: ["mcp__resume__list_applications"] });
console.log("AFTER", names());

dispose();
console.log("DISPOSED", names());
```

The `register` call's exact shape must match `ToolDefinition` in `@deepseek-ai/dsh-tools`. Read `node_modules/@deepseek-ai/dsh-tools/lib/types/index.d.ts` and adjust the object to whatever that interface actually requires — the fields above are a best guess and compile errors here are expected, not a blocker. Same for how `ctx.tools` gets bootstrapped: if `root.plugin(tools)` is not how the registry is installed, read the type definitions and find the right way. Record whatever you had to do.

- [ ] **Step 3: Run the probe**

```bash
cd /tmp/dsh-spike && node --experimental-strip-types probe.ts
```

Three outcomes:

- `AFTER` omits `mcp__resume__list_applications` → verdict **YES**. Tasks 3 and 6 ship as written.
- `AFTER` still lists it → verdict **NO**. The `tools` key is deferred per Task 6's fallback note.
- The probe cannot be made to run at all (registry will not bootstrap standalone, API shapes do not line up) → verdict **INCONCLUSIVE**. Treat that identically to NO: ship without the key rather than shipping one that may not work.

- [ ] **Step 4: Try the sibling topology if the verdict is NO**

Only if Step 3 returned NO. Instead of `root.plugin(stubBridge)`, try restricting from a context that is a descendant of the bridge's scope, or registering the restriction inside the same scope the bridge loads into. If any arrangement reachable from the plugin's own `apply(ctx, config)` succeeds, record it — that changes the verdict to YES with a note on the required arrangement.

Do not spend more than 30 minutes here. An unresolved NO is a perfectly good outcome; the plugin ships without tool curation and the prompt section still carries 0.1.0.

- [ ] **Step 5: Write the finding**

Create `docs/spikes/2026-08-16-restrict-semantics.md` recording: how `ctx.tools` had to be bootstrapped, the actual `ToolDefinition` shape used, the exact `BEFORE`/`AFTER`/`DISPOSED` output, anything tried in Step 4, and a verdict line reading exactly one of:

```
restrict reaches child-scope tools: YES
restrict reaches child-scope tools: NO
restrict reaches child-scope tools: INCONCLUSIVE
```

- [ ] **Step 6: Commit**

```bash
git add docs/spikes/2026-08-16-restrict-semantics.md
git commit -m "docs: spike findings on restrict() reach over child-scope tools"
```

- [ ] **Step 7: Tear down**

```bash
rm -rf /tmp/dsh-spike
```

---

### Task 2: Repo scaffold with a green build and test cycle

**Files:**

- Create: `package.json`, `tsconfig.json`, `tsdown.config.ts`, `biome.json`, `.gitignore`, `vitest.config.ts`
- Create: `src/index.ts`
- Test: `test/smoke.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: a working `pnpm build`, `pnpm test`, `pnpm typecheck`, and `pnpm check`. Every later task depends on these commands existing.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "dsh-plugin-reactive-resume",
  "version": "0.1.0",
  "description": "DeepSeek Harness plugin for Reactive Resume: bridges your resumes and job applications into a Harness session over MCP.",
  "keywords": ["dsh-plugin", "deepseek-harness", "mcp", "reactive-resume", "resume"],
  "license": "MIT",
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/index.d.ts",
  "exports": {
    ".": {
      "types": "./lib/index.d.ts",
      "default": "./lib/index.js"
    },
    "./package.json": "./package.json"
  },
  "files": ["lib"],
  "publishConfig": { "access": "public" },
  "engines": { "node": "^22.19.0 || >=24.0.0" },
  "scripts": {
    "build": "tsdown",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "check": "biome check --write .",
    "generate:tool-names": "node --experimental-strip-types scripts/generate-tool-names.ts",
    "prepublishOnly": "pnpm build"
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.1-rc.1",
    "@deepseek-ai/dsh-mcp-client": "^0.0.1-rc.1",
    "@deepseek-ai/dsh-system-prompt": "^0.0.1-rc.1",
    "@deepseek-ai/dsh-tools": "^0.0.1-rc.1",
    "@deepseek-ai/schemastery": "^3.18.1-rc.1"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.5.8",
    "@deepseek-ai/cordis": "^4.0.1-rc.1",
    "@deepseek-ai/dsh-mcp-client": "^0.0.1-rc.1",
    "@deepseek-ai/dsh-system-prompt": "^0.0.1-rc.1",
    "@deepseek-ai/dsh-tools": "^0.0.1-rc.1",
    "@deepseek-ai/schemastery": "^3.18.1-rc.1",
    "@types/node": "^24.0.0",
    "tsdown": "^0.22.0",
    "typescript": "^5.9.0",
    "vitest": "^4.1.10"
  }
}
```

Note: the `@deepseek-ai/*` packages appear in BOTH `peerDependencies` (what consumers must supply) and `devDependencies` (so this repo can typecheck and test). That is the standard pattern and is not a mistake.

- [ ] **Step 2: Write the tooling config files**

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "allowImportingTsExtensions": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "test", "scripts"]
}
```

`tsdown.config.ts`:

```ts
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  outDir: "lib",
  format: ["esm"],
  dts: true,
  clean: true,
});
```

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["test/**/*.test.ts"] },
});
```

`biome.json`:

```json
{
  "$schema": "https://biomejs.dev/schemas/2.5.8/schema.json",
  "formatter": { "indentStyle": "tab", "lineWidth": 120 },
  "javascript": { "formatter": { "quoteStyle": "single", "semicolons": "asNeeded" } },
  "linter": { "enabled": true, "rules": { "recommended": true } }
}
```

`.gitignore`:

```
node_modules
lib
*.tgz
.env
.env.local
```

- [ ] **Step 3: Write the failing smoke test**

`test/smoke.test.ts`:

```ts
import { expect, it } from "vitest";
import { name } from "../src/index.ts";

it("exports the cordis plugin name", () => {
  expect(name).toBe("reactive-resume");
});
```

- [ ] **Step 4: Run it to verify it fails**

```bash
pnpm install
pnpm test
```

Expected: FAIL — `Failed to resolve import "../src/index.ts"`.

- [ ] **Step 5: Write the minimal implementation**

`src/index.ts`:

```ts
/**
 * DeepSeek Harness plugin for Reactive Resume.
 * @module dsh-plugin-reactive-resume
 */

/** Cordis plugin name used by loader diagnostics. */
export const name = "reactive-resume";
```

- [ ] **Step 6: Run tests, typecheck, and build**

```bash
pnpm test && pnpm typecheck && pnpm build
```

Expected: test PASS, no type errors, `lib/index.js` and `lib/index.d.ts` produced.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold the plugin package with build, test, and lint"
```

---

### Task 3: Config schema

**Files:**

- Create: `src/config.ts`
- Modify: `src/index.ts`
- Test: `test/config.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces:
  - `export interface Config { apiKey: string; url: string; serverName: string; tools: ToolProfile; toolCallTimeoutMs: number }`
  - `export type ToolProfile = 'resume' | 'applications' | 'all'`
  - `export const Config: z<Config>` — a schemastery schema whose parse result has every field populated.

  Task 4 and Task 6 both read the parsed `Config`. Note that the parsed type has NO optional fields — defaults are applied by the schema, so downstream code never handles `undefined`.

**Gated on Task 1.** The `tools` key ships only if the spike verdict was YES. If it was NO or INCONCLUSIVE, omit `tools` from both `ToolProfile`'s use in `Config` and the schema, and drop the two `tools` assertions from the test. `ToolProfile` itself still ships — Task 6 uses it. The dispatch for this task will state the verdict; do not guess it.

- [ ] **Step 1: Write the failing test**

`test/config.test.ts`:

```ts
import { expect, it } from "vitest";
import { Config } from "../src/config.ts";

it("applies defaults for every optional field", () => {
  const parsed = Config({ apiKey: "test-key" });

  expect(parsed).toEqual({
    apiKey: "test-key",
    url: "https://rxresu.me",
    serverName: "resume",
    tools: "all",
    toolCallTimeoutMs: 60_000,
  });
});

it("keeps explicit values", () => {
  const parsed = Config({
    apiKey: "test-key",
    url: "http://localhost:3000",
    serverName: "rr",
    tools: "resume",
    toolCallTimeoutMs: 5_000,
  });

  expect(parsed.url).toBe("http://localhost:3000");
  expect(parsed.serverName).toBe("rr");
  expect(parsed.tools).toBe("resume");
  expect(parsed.toolCallTimeoutMs).toBe(5_000);
});

it("rejects a missing apiKey", () => {
  expect(() => Config({})).toThrow();
});

it("rejects an unknown tools profile", () => {
  expect(() => Config({ apiKey: "test-key", tools: "everything" })).toThrow();
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm vitest run test/config.test.ts
```

Expected: FAIL — cannot resolve `../src/config.ts`.

- [ ] **Step 3: Write the implementation**

`src/config.ts`:

```ts
import z from "@deepseek-ai/schemastery";

/** Which group of Reactive Resume tools to expose to the model. */
export type ToolProfile = "resume" | "applications" | "all";

/** Resolved plugin configuration. Every field is populated after parsing. */
export interface Config {
  /** API key minted at `<url>/dashboard/settings/api-keys`. */
  apiKey: string;
  /** Reactive Resume origin, no trailing slash. */
  url: string;
  /** Tool namespace: tools reach the model as `mcp__<serverName>__<rawName>`. */
  serverName: string;
  /** Tool group to expose. */
  tools: ToolProfile;
  /** Per-tool-call timeout in milliseconds. */
  toolCallTimeoutMs: number;
}

export const Config: z<Config> = z.object({
  apiKey: z.string().required().description("API key from <url>/dashboard/settings/api-keys."),
  url: z
    .string()
    .default("https://rxresu.me")
    .description("Reactive Resume origin. Set this for a self-hosted instance."),
  serverName: z
    .string()
    .default("resume")
    .description("Tool namespace. Must match [A-Za-z0-9_-]{1,32} and be unique across live MCP instances."),
  tools: z
    .union(["resume", "applications", "all"] as const)
    .default("all")
    .description("Which Reactive Resume tool group the model sees."),
  toolCallTimeoutMs: z.natural().default(60_000).description("Per-tool-call timeout in milliseconds."),
});
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm vitest run test/config.test.ts && pnpm typecheck
```

Expected: 4 tests PASS, no type errors.

If `z.union([...] as const)` does not produce the literal union type, replace it with `z.union([z.const('resume'), z.const('applications'), z.const('all')])` — `const<const T>(value: T): Schema<T>` is available and gives the same runtime behaviour.

- [ ] **Step 5: Re-export from the entrypoint**

Modify `src/index.ts` — append:

```ts
export { Config, type ToolProfile } from "./config.ts";
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add the plugin config schema with defaults"
```

---

### Task 4: Mount the MCP bridge

**Files:**

- Modify: `src/index.ts`
- Test: `test/apply.test.ts`

**Interfaces:**

- Consumes: `Config` from Task 3.
- Produces:
  - `export const inject: string[]`
  - `export async function apply(ctx: Context, config: Config): Promise<void>`

  Task 5 and Task 6 extend the same `apply` function.

The test does not boot a real Harness. It passes a hand-rolled fake context that records what `apply` calls — enough to pin the bridge config exactly, which is what matters.

- [ ] **Step 1: Write the failing test**

`test/apply.test.ts`:

```ts
import { expect, it, vi } from "vitest";
import { Config } from "../src/config.ts";
import { apply, inject } from "../src/index.ts";

/** Minimal stand-in for the parts of the Cordis context `apply` touches. */
function fakeContext() {
  return {
    plugin: vi.fn(async () => undefined),
    tools: { restrict: vi.fn(() => () => undefined) },
    systemPrompt: { section: vi.fn(() => () => undefined) },
  };
}

it("declares the services it needs", () => {
  expect(inject).toEqual(["tools", "systemPrompt"]);
});

it("mounts the MCP bridge with streamable-http and the api key header", async () => {
  const ctx = fakeContext();

  await apply(ctx as never, Config({ apiKey: "test-key" }));

  expect(ctx.plugin).toHaveBeenCalledTimes(1);
  expect(ctx.plugin.mock.calls[0]?.[1]).toEqual({
    transport: "streamable-http",
    serverName: "resume",
    url: "https://rxresu.me/mcp",
    headers: { "x-api-key": "test-key" },
    toolCallTimeoutMs: 60_000,
    failOnStartupError: true,
  });
});

it("strips a trailing slash from the configured url", async () => {
  const ctx = fakeContext();

  await apply(ctx as never, Config({ apiKey: "test-key", url: "http://localhost:3000/" }));

  expect(ctx.plugin.mock.calls[0]?.[1]).toMatchObject({ url: "http://localhost:3000/mcp" });
});

it("rejects a serverName the bridge would refuse", async () => {
  const ctx = fakeContext();

  await expect(apply(ctx as never, Config({ apiKey: "test-key", serverName: "has spaces" }))).rejects.toThrow(
    /serverName/,
  );
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm vitest run test/apply.test.ts
```

Expected: FAIL — `apply` and `inject` are not exported from `src/index.ts`.

- [ ] **Step 3: Write the implementation**

Modify `src/index.ts` to read in full:

```ts
/**
 * DeepSeek Harness plugin for Reactive Resume.
 * @module dsh-plugin-reactive-resume
 */

import type { Context } from "@deepseek-ai/cordis";
import * as mcpClient from "@deepseek-ai/dsh-mcp-client";
import type { Config } from "./config.ts";

// Re-exports the interface AND the schema — `config.ts` exports both under the
// name `Config`, and Cordis reads the schema export to validate config before
// this plugin starts.
export { Config, type ToolProfile } from "./config.ts";

/** Cordis plugin name used by loader diagnostics. */
export const name = "reactive-resume";

/** Services required by this plugin. */
export const inject = ["tools", "systemPrompt"];

/** `dsh-mcp-client` reserves this shape for a server namespace. */
const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

/**
 * Connect a Reactive Resume account to the session.
 * @param ctx - plugin context carrying the tool registry and prompt assembly.
 * @param config - resolved plugin configuration.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  if (!SERVER_NAME_PATTERN.test(config.serverName)) {
    throw new Error(`Invalid serverName "${config.serverName}": must match ${SERVER_NAME_PATTERN.source}`);
  }

  const origin = config.url.replace(/\/+$/, "");

  await ctx.plugin(mcpClient, {
    transport: "streamable-http",
    serverName: config.serverName,
    url: `${origin}/mcp`,
    headers: { "x-api-key": config.apiKey },
    toolCallTimeoutMs: config.toolCallTimeoutMs,
    failOnStartupError: true,
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm vitest run && pnpm typecheck
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: mount the Reactive Resume MCP bridge over streamable http"
```

---

### Task 5: System prompt section

**Files:**

- Create: `src/prompt.ts`
- Modify: `src/index.ts`
- Test: `test/prompt.test.ts`

**Interfaces:**

- Consumes: `apply` from Task 4.
- Produces: `export const PATCH_GUIDE: string`.

This is the plugin's substance — the reason it exists rather than a raw `dsh-mcp-client` row. Its content mirrors the error hints Reactive Resume already emits from `packages/mcp/src/tools.ts` (`errorHint`), which exist because models get exactly these things wrong.

- [ ] **Step 1: Write the failing test**

`test/prompt.test.ts`:

```ts
import { expect, it, vi } from "vitest";
import { Config } from "../src/config.ts";
import { apply } from "../src/index.ts";
import { PATCH_GUIDE } from "../src/prompt.ts";

function fakeContext() {
  return {
    plugin: vi.fn(async () => undefined),
    tools: { restrict: vi.fn(() => () => undefined) },
    systemPrompt: { section: vi.fn(() => () => undefined) },
  };
}

it("registers one prompt section in the tool-guidance order band", async () => {
  const ctx = fakeContext();

  await apply(ctx as never, Config({ apiKey: "test-key" }));

  expect(ctx.systemPrompt.section).toHaveBeenCalledTimes(1);
  const section = ctx.systemPrompt.section.mock.calls[0]?.[0];
  expect(section.name).toBe("reactive-resume");
  expect(section.order).toBeGreaterThanOrEqual(100);
  expect(section.order).toBeLessThanOrEqual(199);
  expect(section.text).toBe(PATCH_GUIDE);
});

it("names the tools it references with the configured namespace", async () => {
  const ctx = fakeContext();

  await apply(ctx as never, Config({ apiKey: "test-key", serverName: "rr" }));

  const section = ctx.systemPrompt.section.mock.calls[0]?.[0];
  expect(section.text).toContain("mcp__rr__read_resume");
  expect(section.text).not.toContain("mcp__resume__read_resume");
});

it("covers the documented failure modes", () => {
  for (const phrase of ["RFC 6902", "resume://_meta/schema", "unlock_resume", "list_resumes"]) {
    expect(PATCH_GUIDE).toContain(phrase);
  }
});
```

Note the second test: the guide must be namespace-aware, so `PATCH_GUIDE` is a template built per `serverName`, not a frozen constant. The third test still asserts against the default-namespace export.

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm vitest run test/prompt.test.ts
```

Expected: FAIL — cannot resolve `../src/prompt.ts`.

- [ ] **Step 3: Write the implementation**

`src/prompt.ts`:

```ts
/**
 * Build the Reactive Resume system-prompt section for one tool namespace.
 * @param serverName - the MCP namespace bridged tools are published under.
 * @returns prompt text naming tools exactly as the model will see them.
 */
export function buildPatchGuide(serverName: string): string {
  const t = (raw: string) => `\`mcp__${serverName}__${raw}\``;

  return [
    "## Reactive Resume",
    "",
    "These tools operate on the user's real, live resumes and job applications. Changes are immediate and visible in their account.",
    "",
    "### Reading before writing",
    "",
    `- Call ${t("list_resumes")} to discover resume IDs. IDs are UUIDs, never titles or slugs.`,
    `- Call ${t("read_resume")} before any edit. Never patch a resume you have not read this session.`,
    `- If a call fails with "not found", re-run ${t("list_resumes")} rather than guessing an ID.`,
    "",
    "### Editing",
    "",
    `- ${t("apply_resume_patch")} takes RFC 6902 JSON Patch operations applied to the resume data document.`,
    `- Read the \`resume://_meta/schema\` resource before constructing paths. Do not infer path shapes from the resume you read — the schema is authoritative about which keys are permitted.`,
    "- Section entries are arrays of objects, each with its own UUID `id`. Address an existing entry by locating its index from the document you just read; never treat an `id` as an index.",
    "- Prefer one patch with several operations over several single-operation patches. Operations apply in order and the whole patch fails atomically.",
    `- Use ${t("update_resume")} only for whole-document replacement. For anything smaller, patch.`,
    "",
    "### Locking",
    "",
    `- A locked resume rejects every write. When a call fails because the resume is locked, call ${t("unlock_resume")}, make the change, and leave the lock as you found it.`,
    "",
    "### Scope",
    "",
    "- Never delete a resume or an application unless the user asked for that specific deletion in this conversation.",
    "- When the user describes a change in prose, restate the concrete edit you are about to make before making it.",
  ].join("\n");
}

/** The prompt section for the default `resume` namespace. */
export const PATCH_GUIDE: string = buildPatchGuide("resume");
```

- [ ] **Step 4: Register it in `apply`**

In `src/index.ts`, add the import:

```ts
import { buildPatchGuide } from "./prompt.ts";
```

and append to the end of `apply`, after the `ctx.plugin(...)` call:

```ts
ctx.systemPrompt.section({
  name: "reactive-resume",
  order: 150,
  text: buildPatchGuide(config.serverName),
});
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm vitest run && pnpm typecheck
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: teach the model Reactive Resume patch semantics"
```

---

### Task 6: Generated tool names and drift detection

**Files:**

- Create: `scripts/generate-tool-names.ts`
- Create: `src/tool-names.generated.ts`
- Modify: `src/config.ts`
- Test: `test/tool-names.test.ts`
- Test: `test/tool-names-drift.test.ts`
- Create: `.github/workflows/drift.yml`

**Interfaces:**

- Consumes: `buildPatchGuide` from Task 5.
- Produces: `export const TOOL_NAMES: readonly string[]` (raw, un-namespaced names) from `src/tool-names.generated.ts`.

**This task was rescoped after Task 1.** As originally written it built `groupOf()` and `deniedToolNames()` to support a `tools` config key. Task 1's spike found `ctx.tools.restrict()` throws from a plugin context, that key was cut, and those two functions now have no consumer in this package — they would ship as dead code for a feature that may never live here at all. They are dropped.

What survives, and why it is not dead: `buildPatchGuide` (Task 5) names five specific tools — `list_resumes`, `read_resume`, `apply_resume_patch`, `update_resume`, `unlock_resume`. If Reactive Resume renames or removes one, the prompt section starts instructing the model to call a tool that does not exist, silently. The generated name list plus the two tests below are what catch that. The guide is this release's entire product, so guarding its accuracy is the point.

- [ ] **Step 1: Write the generator**

`scripts/generate-tool-names.ts`:

```ts
/**
 * Regenerate `src/tool-names.generated.ts` from a live Reactive Resume server card.
 * Usage: node --experimental-strip-types scripts/generate-tool-names.ts [origin]
 */
import { writeFileSync } from "node:fs";

const origin = (process.argv[2] ?? "https://rxresu.me").replace(/\/+$/, "");

const response = await fetch(`${origin}/.well-known/mcp/server-card.json`);
if (!response.ok) throw new Error(`Server card fetch failed: ${response.status} ${response.statusText}`);

const card = (await response.json()) as { tools: { name: string }[] };
const names = card.tools.map((tool) => tool.name).sort();

if (names.length === 0) throw new Error("Server card listed no tools");

const body = [
  "// Generated by scripts/generate-tool-names.ts. Do not edit by hand.",
  `// Source: ${origin}/.well-known/mcp/server-card.json`,
  "",
  "/** Raw (un-namespaced) tool names published by Reactive Resume. */",
  "export const TOOL_NAMES = [",
  ...names.map((name) => `\t'${name}',`),
  "] as const satisfies readonly string[]",
  "",
].join("\n");

writeFileSync(new URL("../src/tool-names.generated.ts", import.meta.url), body);
console.log(`Wrote ${names.length} tool names from ${origin}`);
```

- [ ] **Step 2: Run the generator against the live server**

```bash
pnpm generate:tool-names
```

Expected: `Wrote 33 tool names from https://rxresu.me` and a new `src/tool-names.generated.ts`. A different count is fine — Reactive Resume may have shipped tools since this plan was written. Use the real number when reporting.

- [ ] **Step 3: Write the failing guide-coverage test**

This is the test that gives the generated list a consumer. It extracts every tool the prompt guide references and asserts the server actually publishes it.

`test/tool-names.test.ts`:

```ts
import { expect, it } from "vitest";
import { buildPatchGuide } from "../src/prompt.ts";
import { TOOL_NAMES } from "../src/tool-names.generated.ts";

/** Every raw tool name the prompt guide instructs the model to call. */
function toolsReferencedByGuide(): string[] {
  const guide = buildPatchGuide("resume");
  const matches = guide.matchAll(/mcp__resume__([a-z0-9_]+)/g);
  return [...new Set([...matches].map((match) => match[1] as string))];
}

it("references at least one tool", () => {
  // Guards the regex itself: a guide rewrite that drops the namespaced form
  // would otherwise make the next test pass vacuously.
  expect(toolsReferencedByGuide().length).toBeGreaterThan(0);
});

it("only references tools Reactive Resume actually publishes", () => {
  const published: readonly string[] = TOOL_NAMES;

  for (const referenced of toolsReferencedByGuide()) {
    expect(published).toContain(referenced);
  }
});
```

- [ ] **Step 4: Run it to verify it fails**

```bash
pnpm vitest run test/tool-names.test.ts
```

Expected: FAIL — cannot resolve `../src/tool-names.generated.ts` if Step 2 has not been run yet. If Step 2 already produced the file, temporarily rename it to observe the RED state, then restore it.

- [ ] **Step 5: Run it to verify it passes**

```bash
pnpm vitest run test/tool-names.test.ts && pnpm typecheck
```

Expected: 2 tests PASS.

If the second test fails, that is a real finding, not a test bug: the guide names a tool the live server does not publish. Report it — do not edit the guide to match without saying so, because Task 5's guide text was transcribed deliberately.

- [ ] **Step 6: Remove the now-dead `ToolProfile` export**

Task 3 exported `ToolProfile` solely so this task could consume it. With `groupOf` and `deniedToolNames` dropped, nothing does.

In `src/config.ts`, delete:

```ts
/** Which group of Reactive Resume tools to expose to the model. */
export type ToolProfile = "resume" | "applications" | "all";
```

In `src/index.ts`, change the re-export from:

```ts
export { Config, type ToolProfile } from "./config.ts";
```

to:

```ts
export { Config } from "./config.ts";
```

Then run `pnpm typecheck` to confirm nothing else referenced it.

- [ ] **Step 7: Write the drift test**

`test/tool-names-drift.test.ts`:

```ts
import { expect, it } from "vitest";
import { TOOL_NAMES } from "../src/tool-names.generated.ts";

const ORIGIN = process.env.RXRESUME_ORIGIN ?? "https://rxresu.me";

// Network test: skipped unless RXRESUME_CHECK_DRIFT=1, so ordinary `pnpm test`
// stays offline and deterministic. CI sets the flag on a schedule.
it.runIf(process.env.RXRESUME_CHECK_DRIFT === "1")(
  "matches the live server card",
  async () => {
    const response = await fetch(`${ORIGIN}/.well-known/mcp/server-card.json`);
    expect(response.ok).toBe(true);

    const card = (await response.json()) as { tools: { name: string }[] };
    const live = card.tools.map((tool) => tool.name).sort();

    expect(live).toEqual([...TOOL_NAMES]);
  },
  30_000,
);
```

- [ ] **Step 8: Run the full suite twice — offline, then against the live card**

```bash
pnpm test
RXRESUME_CHECK_DRIFT=1 pnpm vitest run test/tool-names-drift.test.ts
```

Expected: the first run passes with the drift test skipped; the second passes with it executed.

- [ ] **Step 9: Add the scheduled CI workflow**

Create `.github/workflows/drift.yml`:

```yaml
name: tool-name drift

on:
  schedule:
    - cron: "0 6 * * 1"
  workflow_dispatch:

jobs:
  drift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v6
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm vitest run test/tool-names-drift.test.ts
        env:
          RXRESUME_CHECK_DRIFT: "1"
```

Note: `pnpm install` needs no `--config` flags here — `pnpm-workspace.yaml` (added in Task 2) carries `autoInstallPeers: false`, `strictPeerDependencies: false`, and `verifyDepsBeforeRun: false`, which is what makes the unpublished `@deepseek-ai/dsh-type-meta` peer a non-issue on a clean runner.

- [ ] **Step 10: Verify and commit**

```bash
pnpm test && pnpm typecheck && pnpm build && pnpm check
git add -A
git commit -m "feat: guard the prompt guide against tool-name drift"
```

---

### Task 7: CI, README, and publish 0.1.0

**Files:**

- Create: `.github/workflows/ci.yml`
- Create: `README.md`
- Create: `LICENSE`

**Interfaces:**

- Consumes: everything from Tasks 2–6.
- Produces: a published `dsh-plugin-reactive-resume@0.1.0` on npm.

- [ ] **Step 1: Add the CI workflow**

`.github/workflows/ci.yml`:

```yaml
name: ci

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v6
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm biome ci .
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm build
```

- [ ] **Step 2: Write the README**

`README.md`:

````markdown
# dsh-plugin-reactive-resume

Connect [Reactive Resume](https://rxresu.me) to [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). Read, create, and edit your resumes and job applications from a Harness session.

## Install

```bash
pnpm add dsh-plugin-reactive-resume
```

## Configure

Mint an API key at `https://rxresu.me/dashboard/settings/api-keys`, then add a row to your `cordis.yml`:

```yaml
- insert:
    - id: reactive-resume
      name: dsh-plugin-reactive-resume
      config:
        apiKey: !!js process.env.RXRESUME_API_KEY
```

### Options

| Key                 | Default             | Description                                                              |
| ------------------- | ------------------- | ------------------------------------------------------------------------ |
| `apiKey`            | _(required)_        | API key from `<url>/dashboard/settings/api-keys`.                        |
| `url`               | `https://rxresu.me` | Origin of your instance. Set this if you self-host.                      |
| `serverName`        | `resume`            | Tool namespace. Tools reach the model as `mcp__<serverName>__<rawName>`. |
| `toolCallTimeoutMs` | `60000`             | Per-tool-call timeout.                                                   |

All 33 of Reactive Resume's tools are exposed. Narrowing that set is not currently possible from a plugin: Harness's `ctx.tools.restrict()` requires an agent-scoped context, which a plugin context is not.

### Self-hosted

```yaml
config:
  apiKey: !!js process.env.RXRESUME_API_KEY
  url: http://localhost:3000
```

## What it does

Bridges Reactive Resume's MCP server into `ctx.tools`, and contributes a system-prompt section covering the things models get wrong about resume editing: reading before patching, RFC 6902 path construction against the published schema, UUID-keyed section entries, and locked resumes.

You could wire the bridge yourself with a raw `@deepseek-ai/dsh-mcp-client` row. What you cannot do that way is contribute the prompt section — that is what this package adds.

## License

MIT
````

- [ ] **Step 3: Add the MIT license**

Create `LICENSE` with the standard MIT text, copyright `2026 Amruth Pillai`.

- [ ] **Step 4: Verify the package contents before publishing**

```bash
pnpm build && pnpm pack --dry-run
```

Expected: the tarball lists only `lib/**`, `package.json`, `README.md`, and `LICENSE`. If `src/` or `test/` appear, fix the `files` field.

- [ ] **Step 5: Smoke test against a real Harness session**

Install the packed tarball into a Harness workspace, add the `cordis.yml` row with a real key, start a session, and confirm end to end:

1. "List my resumes" returns real titles.
2. "Read <title>" returns real content.
3. "Change my headline to X" applies and is visible at `https://rxresu.me`.
4. With `tools: resume`, no `mcp__resume__*application*` tool appears (skip if the spike verdict was `NO`).

Do not publish until all of these pass.

- [ ] **Step 6: Publish**

```bash
npm publish --access public
```

- [ ] **Step 7: Make it discoverable**

- Add the `dsh-plugin` topic to the GitHub repository. This is how Harness's plugin catalog finds it.
- Open a PR adding the plugin to [awesome-deepseek-harness](https://github.com/Dominic789654/awesome-deepseek-harness).

- [ ] **Step 8: Tag the release**

```bash
git tag v0.1.0
git push --tags
```
