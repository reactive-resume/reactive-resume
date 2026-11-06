import { CryptoDigestAlgorithm, digestStringAsync } from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import { normalizeFontMirrorUrl } from "@reactive-resume/fonts/sources";
import { getFlags } from "@/auth/oauth";

type Known = { fontMirrorUrl: string | undefined; checkedAt: number };

const known = new Map<string, Known>();
const pending = new Map<string, Promise<string | undefined>>();
const MAX_AGE = 5 * 60_000;

async function savedFile(server: string) {
	const directory = new Directory(Paths.cache, "font-sources-v1");
	directory.create({ intermediates: true, idempotent: true });
	return new File(directory, await digestStringAsync(CryptoDigestAlgorithm.SHA256, server));
}

/** The last configuration this exact server sent, from disk; `undefined` when none was saved or it is unreadable. */
async function readSaved(server: string): Promise<Known | undefined> {
	try {
		const file = await savedFile(server);
		if (!file.exists) return;
		const saved: unknown = JSON.parse(await file.text());
		if (!saved || typeof saved !== "object" || !("server" in saved) || saved.server !== server) return;
		if (!("fontMirrorUrl" in saved) || (saved.fontMirrorUrl !== null && typeof saved.fontMirrorUrl !== "string"))
			return;
		return {
			fontMirrorUrl: saved.fontMirrorUrl ? normalizeFontMirrorUrl(saved.fontMirrorUrl) : undefined,
			checkedAt: 0,
		};
	} catch {
		return;
	}
}

async function refresh(server: string): Promise<string | undefined> {
	const flags = await getFlags(server);
	const fontMirrorUrl = flags.fontMirrorUrl === undefined ? undefined : normalizeFontMirrorUrl(flags.fontMirrorUrl);
	known.set(server, { fontMirrorUrl, checkedAt: Date.now() });
	try {
		await (await savedFile(server)).write(JSON.stringify({ server, fontMirrorUrl: fontMirrorUrl ?? null }));
	} catch {
		// The configuration stays usable in memory when the cache directory can't be written.
	}
	return fontMirrorUrl;
}

/**
 * The server's font mirror, read from its public flags. A configuration younger than five minutes renders at once;
 * an older one is confirmed first, so a newly enabled mirror is never bypassed. A failed read keeps the saved
 * configuration, or with none saved (first use, or offline right after an update) the original font hosts: offline,
 * those requests can't leave the device, and cached fonts still render.
 */
export async function getFontMirrorUrl(server: string): Promise<string | undefined> {
	let hit = known.get(server);
	if (!hit) {
		hit = await readSaved(server);
		if (hit && !known.has(server)) known.set(server, hit);
	}
	if (hit && Date.now() - hit.checkedAt < MAX_AGE) return hit.fontMirrorUrl;
	let running = pending.get(server);
	if (!running) {
		running = refresh(server).finally(() => pending.delete(server));
		pending.set(server, running);
	}
	return running.catch(() => hit?.fontMirrorUrl);
}
