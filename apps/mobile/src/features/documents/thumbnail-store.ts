import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { Directory, File, Paths } from "expo-file-system";
import * as Updates from "expo-updates";
import { createSerialQueue } from "@reactive-resume/utils/queue";
import { fnv1a } from "@reactive-resume/utils/string";

// Library thumbnails (resume first pages) kept across launches, so an unchanged resume is never fetched or rendered
// twice. Named `<owner>.<version>.<width>.png`; one set per document.
const MAX_FILES = 100;
// Templates ship in the JS bundle, so every OTA update or store build gets new thumbnails. In development each
// launch does, so template edits show up.
const BUILD = __DEV__ ? `dev-${Date.now()}` : (Updates.updateId ?? Updates.runtimeVersion ?? "embedded");

type StoredDocument = { id: string; updatedAt: Date };

const directory = () => new Directory(Paths.cache, "document-thumbnails-v1");

/** Directory changes run one at a time, so a listing never races a delete. Separate from the render queue: writes
 * run inside render tasks. */
const serial = createSerialQueue();

function namesFor(server: string, document: StoredDocument) {
	const owner = fnv1a(`${server}|${document.id}`).toString(36);
	const version = fnv1a(`${document.updatedAt.getTime()}|${BUILD}`).toString(36);
	return { owner: `${owner}.`, prefix: `${owner}.${version}.` };
}

const filesIn = (folder: Directory) =>
	folder.exists ? folder.list().filter((entry): entry is File => entry instanceof File) : [];

/** Drops the document's files from earlier edits or builds, then the oldest writes beyond MAX_FILES. */
function makeRoom(folder: Directory, { owner, prefix }: { owner: string; prefix: string }) {
	folder.create({ intermediates: true, idempotent: true });
	const others = filesIn(folder).filter((file) => {
		if (!file.name.startsWith(owner) || file.name.startsWith(prefix)) return true;
		file.delete();
		return false;
	});
	others.sort((left, right) => (left.lastModified ?? 0) - (right.lastModified ?? 0));
	for (const file of others.slice(0, Math.max(0, others.length - MAX_FILES + 1))) file.delete();
}

/** A stored first page drawn from this edit by this build, at least `width` pixels wide. */
export function readStoredThumbnail(server: string, document: StoredDocument, width: number) {
	try {
		const { prefix } = namesFor(server, document);
		return filesIn(directory()).find(
			(file) =>
				file.name.startsWith(prefix) &&
				file.name.endsWith(".png") &&
				Number.parseInt(file.name.slice(prefix.length), 10) >= width,
		)?.uri;
	} catch {
		return undefined;
	}
}

/** Copies a rendered page into the store and returns the copy; throws when it can't be kept. */
export function storeThumbnail(server: string, document: StoredDocument, width: number, source: string) {
	const names = namesFor(server, document);
	return serial(async () => {
		const folder = directory();
		makeRoom(folder, names);
		const target = new File(folder, `${names.prefix}${width}.png`);
		await new File(source).copy(target, { overwrite: true });
		return target.uri;
	});
}

// Design → Template previews drawn from the user's resume. Only one resume's set is kept: new content replaces it.
const templateDirectory = () => new Directory(Paths.cache, "template-thumbnails-v1");
const templateFile = (content: string, template: string, width: number) =>
	new File(templateDirectory(), `${content}.${template}.${width}.png`);

/** FNV-1a over the content (any template) and build, so previews redraw only when either changes. */
export function templateThumbnailKey(data: ResumeData) {
	return fnv1a(JSON.stringify({ ...data, metadata: { ...data.metadata, template: null } }) + BUILD).toString(36);
}

export function readStoredTemplateThumbnail(content: string, template: string, width: number) {
	try {
		const file = templateFile(content, template, width);
		return file.exists ? file.uri : undefined;
	} catch {
		return undefined;
	}
}

/** Copies a rendered preview into the store and returns the copy; throws when it can't be kept. */
export function storeTemplateThumbnail(content: string, template: string, width: number, source: string) {
	return serial(async () => {
		const folder = templateDirectory();
		folder.create({ intermediates: true, idempotent: true });
		for (const file of filesIn(folder)) if (!file.name.startsWith(`${content}.`)) file.delete();
		const target = templateFile(content, template, width);
		await new File(source).copy(target, { overwrite: true });
		return target.uri;
	});
}

/** Removes every stored thumbnail and template preview; part of signing out. */
export function clearStoredThumbnails() {
	return serial(() => {
		for (const folder of [directory(), templateDirectory()]) if (folder.exists) folder.delete();
	});
}
