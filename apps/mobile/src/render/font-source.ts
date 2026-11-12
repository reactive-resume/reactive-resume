import { CryptoDigestAlgorithm, digestStringAsync } from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import { normalizeFontMirrorUrl } from "@reactive-resume/fonts/sources";
import { getFlags } from "@/auth/oauth";
import { now } from "@/data/clock";

/** `unknown`: the server was never read, so no font host is known to be allowed. */
type Known = { fontMirrorUrl: string | undefined; checkedAt: number; unknown?: true };

const known = new Map<string, Known>();
const pending = new Map<string, Promise<string | undefined>>();
const MAX_AGE = 5 * 60_000;
// After a failed read, wait this long before asking again: a fit runs many renders in a row.
const RETRY_AFTER = 30_000;

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
	known.set(server, { fontMirrorUrl, checkedAt: now().getTime() });
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
 * configuration. With none saved (first use, or offline right after an update), fonts already on the device render
 * and none are downloaded (`isFontSourceUnknown`): a failed read doesn't prove the original hosts are allowed.
 */
export async function getFontMirrorUrl(server: string): Promise<string | undefined> {
	let hit = known.get(server);
	if (!hit) {
		hit = await readSaved(server);
		if (hit && !known.has(server)) known.set(server, hit);
	}
	if (hit && now().getTime() - hit.checkedAt < MAX_AGE) return hit.fontMirrorUrl;
	let running = pending.get(server);
	if (!running) {
		running = refresh(server).finally(() => pending.delete(server));
		pending.set(server, running);
	}
	return running.catch(() => {
		const retry = { ...(hit ?? { fontMirrorUrl: undefined, unknown: true as const }) };
		known.set(server, { ...retry, checkedAt: now().getTime() - MAX_AGE + RETRY_AFTER });
		return retry.fontMirrorUrl;
	});
}

/** True until this server's font configuration has been read once; font downloads wait for it. */
export function isFontSourceUnknown(server: string) {
	return known.get(server)?.unknown === true;
}
