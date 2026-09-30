/**
 * DeepSeek Harness plugin for Reactive Resume.
 * @module dsh-plugin-reactive-resume
 */

import type { Config } from "./config";
import type { Context } from "@deepseek-ai/cordis";
// Side-effect import: pulls in the `Context.systemPrompt` module augmentation
// this plugin relies on below. No runtime value is used from this module.
import type {} from "@deepseek-ai/dsh-system-prompt";
import * as mcpClient from "@deepseek-ai/dsh-mcp-client";
import { buildPatchGuide } from "./prompt";

// Re-exports the interface AND the schema — `config.ts` exports both under the
// name `Config`, and Cordis reads the schema export to validate config before
// this plugin starts.
export { Config } from "./config";

/** Cordis plugin name used by loader diagnostics. */
export const name = "reactive-resume";

/**
 * Services required by this plugin.
 *
 * `tools` is deliberately not injected here: `ctx.tools.restrict()` requires
 * an agent-scoped context, which a plugin's own `apply(ctx, config)` never
 * is, and this plugin never calls it. `@deepseek-ai/dsh-mcp-client` declares
 * its own dependency on the tools service, so the bridge still gets what it
 * needs without this plugin waiting on it.
 */
export const inject = ["systemPrompt"];

/**
 * Connect a Reactive Resume account to the session.
 * @param ctx - plugin context carrying prompt assembly.
 * @param config - resolved plugin configuration. `Config` already rejects an
 *   invalid `serverName` at parse time, before `apply` ever runs.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
	// The bundle patch mounts this row on install, before anyone has minted a
	// key. Mount nothing rather than failing the profile's boot: `dsh plugin
	// add` should never leave the harness unbootable.
	if (config.apiKey === "") {
		ctx.logger.warn("no apiKey configured — set one at %s/dashboard/settings/api-keys to enable the tools", config.url);
		return;
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

	ctx.systemPrompt.section({
		// Namespaced by `serverName` so a second instance (e.g. a self-hosted
		// account alongside the hosted one) doesn't collide on section name.
		name: `reactive-resume:${config.serverName}`,
		order: 150,
		text: buildPatchGuide(config.serverName),
	});
}
