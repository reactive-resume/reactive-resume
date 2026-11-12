import { type Directory, File } from "expo-file-system";

/** Makes a file in a picked folder. `createFile` throws when the name is taken, so saving again replaces the earlier copy. */
export function createFileIn(directory: Directory, name: string, mimeType: string | null): File {
	try {
		const taken = new File(directory, name);
		if (taken.exists) taken.delete();
	} catch {
		// Android folders are content URIs with no child paths; its picker renames a duplicate itself.
	}
	return directory.createFile(name, mimeType);
}
