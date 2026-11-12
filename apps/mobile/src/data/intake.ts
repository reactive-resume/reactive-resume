import type { DocumentPickerAsset } from "expo-document-picker";
import { t } from "@lingui/core/macro";
import { Directory, File, Paths } from "expo-file-system";
import { generateId } from "@reactive-resume/utils/string";
import { activeDataScope } from "./scope";
import Storage from "./storage";

export type SharedIntake = {
	id: string;
	server: string;
	value: { kind: "file"; file: DocumentPickerAsset } | { kind: "url"; url: string };
};
const key = "pending-shared-intake";
/** Retain until signed-in recipient explicitly consumes it; never automatically submit it. */
export function keepSharedIntake(server: string, value: SharedIntake["value"]): SharedIntake {
	if (value.kind === "url" && !["http:", "https:"].includes(new URL(value.url).protocol))
		throw new Error(t`Unsupported shared URL.`);
	const id = generateId();
	let retainedValue = value;
	if (value.kind === "file") {
		const source = new File(value.file.uri);
		if (source.size > 10 * 1024 * 1024) throw new Error(t`Choose a file up to 10 MB.`);
		const directory = new Directory(Paths.document, "shared-intake");
		directory.create({ intermediates: true, idempotent: true });
		const destination = new File(directory, id);
		source.copy(destination);
		retainedValue = { kind: "file", file: { ...value.file, uri: destination.uri } };
	}
	const intake = { id, server: new URL(server).origin, value: retainedValue };
	Storage.setItemSync(key, JSON.stringify(intake));
	return intake;
}
export function pendingSharedIntake(server: string): SharedIntake | null {
	activeDataScope();
	const raw = Storage.getItemSync(key);
	if (!raw) return null;
	const intake = JSON.parse(raw) as SharedIntake;
	return intake.server === new URL(server).origin ? intake : null;
}
export function consumeSharedIntake(id: string, server: string) {
	const intake = pendingSharedIntake(server);
	if (intake?.id !== id) throw new Error(t`Shared item changed.`);
	Storage.removeItemSync(key);
	return intake;
}
