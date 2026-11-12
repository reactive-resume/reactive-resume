// A `File` can't ride in the address, so whoever sends someone to the Import page with a file leaves it here.
let pending: File | undefined;

/** Call before navigating to `/dashboard/documents/import`: the page opens on this file, waiting to be confirmed. */
export const handOverImportFile = (file: File) => {
	pending = file;
};

export const peekImportFile = () => pending;

export const clearImportFile = () => {
	pending = undefined;
};
