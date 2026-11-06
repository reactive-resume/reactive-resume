import { CryptoDigestAlgorithm, digestStringAsync } from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import { normalizeFontMirrorUrl } from "@reactive-resume/fonts/sources";
import { getFlags } from "@/auth/oauth";

type Configuration = { server: string; fontMirrorUrl: string | null };
type Cached = { value: Configuration; checkedAt: number };

const cached = new Map<string, Cached>();
const pending = new Map<string, Promise<string | undefined>>();
const MAX_AGE = 5 * 60_000;

function parse(value: unknown, server: string): Configuration | undefined {
	if (!value || typeof value !== "object" || !("server" in value) || value.server !== server) return;
	if (!("fontMirrorUrl" in value)) return;
	if (value.fontMirrorUrl === null) return { server, fontMirrorUrl: null };
	if (typeof value.fontMirrorUrl === "string")
		return { server, fontMirrorUrl: normalizeFontMirrorUrl(value.fontMirrorUrl) };
}

/** Resolve before rendering. Offline reuse is allowed only for configuration learned from this exact server. */
export function getFontMirrorUrl(server: string): Promise<string | undefined> {
	const hit = cached.get(server);
	if (hit && Date.now() - hit.checkedAt < MAX_AGE) return Promise.resolve(hit.value.fontMirrorUrl ?? undefined);
	const running = pending.get(server);
	if (running) return running;
	const load = async () => {
		let file: File | undefined;
		let saved = hit?.value;
		try {
			const directory = new Directory(Paths.cache, "font-sources-v1");
			directory.create({ intermediates: true, idempotent: true });
			file = new File(directory, await digestStringAsync(CryptoDigestAlgorithm.SHA256, server));
			if (!saved && file.exists) saved = parse(JSON.parse(await file.text()), server);
		} catch {
			// A corrupt/evicted cache requires a successful configuration read, never a guess at CDN defaults.
		}
		let flags: Awaited<ReturnType<typeof getFlags>>;
		try {
			flags = await getFlags(server);
		} catch (error) {
			if (!saved) throw error;
			cached.set(server, { value: saved, checkedAt: Date.now() });
			return saved.fontMirrorUrl ?? undefined;
		}
		// A server that answered with invalid configuration must not resurrect an older CDN policy.
		const value: Configuration = {
			server,
			fontMirrorUrl: flags.fontMirrorUrl === undefined ? null : normalizeFontMirrorUrl(flags.fontMirrorUrl),
		};
		try {
			await file?.write(JSON.stringify(value));
		} catch {
			// Config remains usable in memory if the cache directory cannot be written.
		}
		cached.set(server, { value, checkedAt: Date.now() });
		return value.fontMirrorUrl ?? undefined;
	};
	const result = load().finally(() => pending.delete(server));
	pending.set(server, result);
	return result;
}
