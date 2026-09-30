# dsh-plugin-reactive-resume

Connect [Reactive Resume](https://rxresu.me) to [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). Read, create, and edit your resumes and job applications from a Harness session.

## Install

```bash
dsh plugin --profile <name> add dsh-plugin-reactive-resume
```

This package declares `dsh.bundle`, so the profile picks it up as a layer and mounts it automatically. Until you configure a key it mounts nothing and logs a warning, so installing it never leaves a profile unbootable.

## Configure

Mint an API key at `https://rxresu.me/dashboard/settings/api-keys` and export it as `RXRESUME_API_KEY` — the bundle patch reads that variable. To set it explicitly, or to change any other option, patch the row by id from your profile's `cordis.patch.yml`:

```yaml
- id: reactive-resume
  config:
    apiKey: !!js process.env.RXRESUME_API_KEY
```

### Options

| Key | Default | Description |
|---|---|---|
| `apiKey` | `''` | API key from `<url>/dashboard/settings/api-keys`. Empty mounts nothing. |
| `url` | `https://rxresu.me` | Origin of your instance. Set this if you self-host. |
| `serverName` | `resume` | Tool namespace. Tools reach the model as `mcp__<serverName>__<rawName>`. |
| `toolCallTimeoutMs` | `60000` | Per-tool-call timeout. |

Every tool Reactive Resume publishes is exposed. Narrowing that set is not currently possible from a plugin: Harness's `ctx.tools.restrict()` requires an agent-scoped context, which a plugin context is not.

### Self-hosted

```yaml
- id: reactive-resume
  config:
    apiKey: !!js process.env.RXRESUME_API_KEY
    url: http://localhost:3000
```

## What it does

Bridges Reactive Resume's MCP server into `ctx.tools`, and contributes a system-prompt section covering the things models get wrong about resume editing: reading before patching, RFC 6902 path construction against the published schema, UUID-keyed section entries, and locked resumes.

You could wire the bridge yourself with a raw `@deepseek-ai/dsh-mcp-client` row. What you cannot do that way is contribute the prompt section — that is what this package adds.

## Harness compatibility

The peer ranges list each supported DSH host line as an explicit `||` union: `^0.1.0-rc.6` (what this package already shipped against) plus `^0.2.0-rc.1` (which admits `0.2.0-rc.1` and `0.2.0-rc.2`). The union is purely additive — every version the old range admitted is still admitted.

Every published DSH release is a prerelease, which makes the comparison mode matter:

- The Harness host decides whether to mount a plugin with `semver.satisfies(runtime, range, { includePrerelease: true })`. The upper bound is what rejected the old range there: `^0.1.0-rc.6` expands to `>=0.1.0-rc.6 <0.2.0-0`, and `0.2.0-rc.2` sorts above `0.2.0-0` because the numeric identifier `0` precedes `rc`.
- npm's default mode — the one the plugin market's checker uses — additionally requires a comparator set to pin the same `major.minor.patch` tuple with a prerelease of its own. Under that mode the bare `^0.1.0-rc.6` admits only `0.1.0-rc.6` through `0.1.0-rc.8`.

Measured against all 29 published host releases, that gap is wide: `^0.1.0-rc.6` admits 22 of them under the host's mode (every `0.1.x` line, including `0.1.5-rc.2` and `0.1.7-rc.2`) but only 3 under npm's default mode. Widening the upper bound does not close it, because the default mode ignores the widened comparator: `>=0.1.0-rc.6 <0.3.0-0` still admits only those same 3, and `*` admits none at all. `^0.1.0-rc.6 || ^0.2.0-rc.1` admits 24 releases under the host's mode and 5 under the default one, so an explicit union member per host line is the only form both checkers agree on.

Against `0.2.0-rc.2` this package needed no source change: `dsh-mcp-client@0.2.0-rc.2` keeps its `Config` union, its `apply(ctx, config)` signature, and the `mcp__<serverName>__<rawName>` public tool name, while `dsh-system-prompt@0.2.0-rc.2` keeps `section({ name, order, text })`. What 0.2.0 adds to the bridge — MCP resource publishing and a server-instructions prompt section — is additive and scoped to `ctx.inject(["mcpResources"])` / `ctx.inject(["systemPrompt"])`, neither of which this package depends on.

## Development

This package lives in the [Reactive Resume monorepo](https://github.com/reactive-resume/reactive-resume) at `packages/dsh-plugin`, next to `packages/mcp` — the server it bridges. `src/tool-names.test.ts` checks every tool the prompt guide names against `@reactive-resume/mcp/tool-names`, so renaming a tool breaks this package in the same pull request.

```bash
pnpm --filter dsh-plugin-reactive-resume test
pnpm --filter dsh-plugin-reactive-resume build
```

## License

MIT
