import type { ImproveLine } from "./improve";
import type { Editor } from "@tiptap/react";
import { closeHistory } from "@tiptap/pm/history";

/**
 * Applies an accepted Improve suggestion as its own editor history event. The first boundary ends the user's typing
 * group; the empty closing transaction makes the next keystroke start a new group instead of joining the AI edit.
 */
export function acceptImproveLine(editor: Editor, line: Pick<ImproveLine, "from" | "to">, text: string) {
	editor
		.chain()
		.focus()
		.insertContentAt({ from: line.from, to: line.to }, text)
		.command(({ tr }) => {
			closeHistory(tr);
			return true;
		})
		.run();
	editor.view.dispatch(closeHistory(editor.state.tr));
}
