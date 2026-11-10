// Hermes rejects the `v` (unicodeSets) RegExp flag. Babel rewrites literals; this covers `new RegExp(source, "gv")`
// (as @sindresorhus/transliterate builds its patterns) by falling back to `u`, which accepts the same sources here.
const Native = globalThis.RegExp;
let supported = true;
try {
	new Native("", "v");
} catch {
	supported = false;
}
if (!supported) {
	const Patched = function RegExp(this: unknown, pattern: string | RegExp, flags?: string) {
		const next =
			typeof flags === "string" && flags.includes("v") ? flags.replace("v", flags.includes("u") ? "" : "u") : flags;
		return new.target
			? Reflect.construct(Native, [pattern, next], new.target === Patched ? Native : new.target)
			: Native(pattern, next);
	} as unknown as RegExpConstructor;
	Object.defineProperty(Patched, "prototype", { value: Native.prototype });
	Object.setPrototypeOf(Patched, Native);
	globalThis.RegExp = Patched;
}
