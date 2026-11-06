import { CryptoDigestAlgorithm, digestStringAsync } from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import { normalizeFontMirrorUrl } from "@reactive-resume/fonts/sources";
import { getFlags } from "@/auth/oauth";

type Configuration = { server: string; fontMirrorUrl: string | null };
type Cached = { value: Configuration; checkedAt: number };

const cached = new Map<string, Cached>();
const pending = new Map<string, Promise<string | undefined>>();
const invalid = new Set<string>();
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
			if (!saved && !invalid.has(server) && file.exists) saved = parse(JSON.parse(await file.text()), server);
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
		let value: Configuration;
		try {
			value = {
				server,
				fontMirrorUrl: flags.fontMirrorUrl === undefined ? null : normalizeFontMirrorUrl(flags.fontMirrorUrl),
			};
		} catch (error) {
			cached.delete(server);
			invalid.add(server);
			try {
				// No fontMirrorUrl: a restarted client must obtain valid configuration before it can render again.
				await file?.write(JSON.stringify({ server, invalid: true }));
			} catch {
				try {
					file?.delete();
				} catch {
					/* Keep the in-memory invalidation if storage is unavailable. */
				}
			}
			throw error;
		}
		try {
			await file?.write(JSON.stringify(value));
		} catch {
			// Config remains usable in memory if the cache directory cannot be written.
		}
		cached.set(server, { value, checkedAt: Date.now() });
		invalid.delete(server);
		return value.fontMirrorUrl ?? undefined;
	};
	const result = load().finally(() => pending.delete(server));
	pending.set(server, result);
	return result;
}
