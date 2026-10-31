/** Pending saves and commits waiting on an open undo toast; leaving the page runs them rather than dropping them. */
export const pendingCommits = new Set<() => void>();
if (typeof document !== "undefined") {
	const flush = () => {
		for (const commit of pendingCommits) commit();
	};
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "hidden") flush();
	});
	window.addEventListener("pagehide", flush);
}
