// @vitest-environment happy-dom
import { renderHook } from "@testing-library/react";
import { expect, it } from "vite-plus/test";
import { DocumentLibraryProvider, useDocumentEffect } from "./library-session";
import { useDocumentRemovalMotion } from "./removal-motion";

// The server already moved the document to Trash: a failed exit animation must not turn that into a reported failure,
// which would drop the toast's Undo.
it("settles a confirmed removal even when its exit animation fails", async () => {
	const card = document.createElement("div");
	card.dataset.documentKey = "resume:r1";
	card.animate = () => {
		throw new Error("Animations unavailable");
	};
	const container = { current: document.createElement("div") };
	container.current.append(card);
	const { result } = renderHook(
		() => {
			useDocumentRemovalMotion({
				container,
				scope: "library",
				trashed: false,
				data: null,
				fetching: true,
				failed: false,
			});
			return useDocumentEffect();
		},
		{ wrapper: DocumentLibraryProvider },
	);
	await expect(result.current("trash", [{ type: "resume", id: "r1" }])).resolves.toBeUndefined();
});
