import { afterEach, describe, expect, it, vi } from "vite-plus/test";
// @vitest-environment happy-dom
import { Editor } from "@tiptap/react";
import { acceptImproveLine } from "./improve-history";
import { richTextExtensions } from "@/components/input/rich-text-extensions";

afterEach(() => {
	vi.useRealTimers();
});

const editorWith = (text: string) => new Editor({ extensions: richTextExtensions, content: `<p>${text}</p>` });

describe("accepted Improve replacement history", () => {
	it("is one undo step after typing, keeps the user line on undo and returns the replacement on redo", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(0));
		const editor = editorWith("Owned synthetic delivery.");
		const user = "Owned synthetic delivery.";
		const replacement = "Led fictional delivery work.";

		// The user's edit is already a history event. Replace 100 ms later, inside the editor's 500 ms group window.
		vi.setSystemTime(new Date(100));
		acceptImproveLine(editor, { from: 1, to: 1 + user.length }, replacement);
		expect(editor.getText()).toBe(replacement);

		editor.commands.undo();
		expect(editor.getText()).toBe(user);
		editor.commands.redo();
		expect(editor.getText()).toBe(replacement);
		editor.destroy();
	});

	it("starts a fresh history event for typing after the replacement", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(0));
		const editor = editorWith("Owned synthetic delivery.");
		const replacement = "Led fictional delivery work.";

		vi.setSystemTime(new Date(100));
		acceptImproveLine(editor, { from: 1, to: "Owned synthetic delivery.".length + 1 }, replacement);

		vi.setSystemTime(new Date(150));
		editor.commands.insertContent(" More");
		expect(editor.getText()).toBe(`${replacement} More`);

		editor.commands.undo();
		expect(editor.getText()).toBe(replacement);
		editor.commands.undo();
		expect(editor.getText()).toBe("Owned synthetic delivery.");
		editor.destroy();
	});
});
