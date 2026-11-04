import { createRequire } from "node:module";
import { expect, it } from "vite-plus/test";

const mobile = createRequire(new URL("../apps/mobile/package.json", import.meta.url));
const expo = createRequire(mobile.resolve("expo/package.json"));
const config = createRequire(expo.resolve("@expo/config/package.json"));
const cli = createRequire(expo.resolve("@expo/cli/package.json"));
const sharedZod = createRequire(new URL("../packages/schema/package.json", import.meta.url));

it.each(["deepmerge", "deepmerge/dist/umd.js"])("%s cannot poison merged object prototypes", (entry) => {
	const merge = config(entry);
	const payload = JSON.parse('{"__proto__":{"isAdmin":true},"constructor":{"prototype":{"isAdmin":true}}}');
	for (const target of [Object.create(null), payload]) {
		const merged = merge(target, payload);
		expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
		expect(merged.isAdmin).toBeUndefined();
		expect(Object.hasOwn(merged, "__proto__")).toBe(false);
		expect(Object.hasOwn(merged, "constructor")).toBe(false);
	}
	for (const placeholder of [null, undefined, 0, false, ""]) {
		const merged = merge({ session: placeholder }, { session: payload });
		expect(Object.getPrototypeOf(merged.session)).toBe(Object.prototype);
		expect(merged.session.isAdmin).toBeUndefined();
	}
	const symbol = Symbol("config");
	const merged = merge({ list: [1], nested: { left: true } }, { list: [2], nested: { right: true }, [symbol]: 3 });
	expect(merged).toEqual({ list: [1, 2], nested: { left: true, right: true }, [symbol]: 3 });
	expect(merge({}, { items: [payload] }).items[0].isAdmin).toBeUndefined();
});

it("rejects oversized collections before parsing elements in Zod 4", async () => {
	const { z } = sharedZod("zod");
	let parsed = 0;
	const schema = z.array(z.unknown().transform(() => ++parsed)).max(2);
	for (const result of [schema.safeParse(new Array(10_000)), await schema.safeParseAsync(new Array(10_000))]) {
		expect(result.success).toBe(false);
		expect(result.error.issues).toMatchObject([{ code: "too_big" }]);
		expect(result.error.issues).toHaveLength(1);
	}
	expect(parsed).toBe(0);
	expect(schema.parse(["one", "two"])).toEqual([1, 2]);
});

it("keeps Expo plugin validation and MCP schemas compatible with Zod 4", () => {
	const { PluginSchema, DevToolsPluginOutputSchema } = cli(
		"./build/src/start/server/devtools/DevToolsPlugin.schema.js",
	);
	const { createMCPDevToolsExtensionSchema } = cli("./build/src/start/server/mcp/createMCPDevToolsExtensionSchema.js");
	const { validate, ValidationError } = cli("@expo/schema-utils");
	const { z } = sharedZod("zod");
	const plugin = {
		packageName: "fixture-plugin",
		packageRoot: "/fixture",
		cliExtensions: {
			description: "Fixture commands",
			entryPoint: "cli.js",
			commands: [
				{
					name: "inspect",
					title: "Inspect",
					environments: ["mcp"],
					parameters: [
						{ name: "count", type: "number" },
						{ name: "enabled", type: "confirm" },
					],
				},
			],
		},
	};
	validate(PluginSchema, plugin);
	const schema = createMCPDevToolsExtensionSchema(plugin, z);
	expect(schema.parse({ command: "inspect", count: 2, enabled: true })).toEqual({
		command: "inspect",
		count: 2,
		enabled: true,
	});
	expect(schema.safeParse({ command: "unknown" }).success).toBe(false);
	expect(schema.safeParse({ command: "inspect", extra: true }).success).toBe(false);
	expect(() => validate(PluginSchema, { ...plugin, packageName: "" })).toThrow(ValidationError);
	const output = [{ type: "text", text: "Fixture result", level: "info" }];
	validate(DevToolsPluginOutputSchema, output);
	expect(() => validate(DevToolsPluginOutputSchema, [{ type: "image" }])).toThrow(ValidationError);
	expect(() => validate(DevToolsPluginOutputSchema, [{ type: "text", text: "Fixture result" }])).toThrow(
		ValidationError,
	);
	const jsonSchema = z.toJSONSchema(schema);
	expect(jsonSchema.properties.command.enum).toEqual(["inspect"]);
	expect(jsonSchema.additionalProperties).toBe(false);
});
