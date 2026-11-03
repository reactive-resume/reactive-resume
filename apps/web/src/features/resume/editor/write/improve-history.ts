import type { ImproveLine } from "./improve";
import type { Node, Schema } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { closeHistory } from "@tiptap/pm/history";
import { Step, StepResult } from "@tiptap/pm/transform";
import { aiOperationIdsSchema } from "@reactive-resume/schema/ai-usage";

// Private editor history metadata: invert with the wording, never put request references in document HTML/JSON.
class ImproveSourcesStep extends Step {
	constructor(
		readonly ids: string[],
		readonly added: boolean,
	) {
		super();
	}
	apply(doc: Node) {
		return StepResult.ok(doc);
	}
	invert() {
		return new ImproveSourcesStep(this.ids, !this.added);
	}
	map() {
		return this;
	}
	toJSON() {
		return { stepType: "reactiveResumeImproveSources", ids: this.ids, added: this.added };
	}
	static fromJSON(_schema: Schema, value: unknown) {
		if (
			!value ||
			typeof value !== "object" ||
			!("ids" in value) ||
			!("added" in value) ||
			typeof value.added !== "boolean"
		)
			throw new RangeError("Invalid Improve source step");
		return new ImproveSourcesStep(aiOperationIdsSchema.parse(value.ids), value.added);
	}
}
Step.jsonID("reactiveResumeImproveSources", ImproveSourcesStep);

export function improveSourceChanges(transaction: Transaction) {
	const steps = transaction.steps.filter((step): step is ImproveSourcesStep => step instanceof ImproveSourcesStep);
	if (!steps.length) return undefined;
	const added = steps.filter((step) => step.added).flatMap((step) => step.ids);
	const removed = steps.filter((step) => !step.added).flatMap((step) => step.ids);
	return {
		newStep: true,
		...(added.length ? { aiOperationIds: added } : {}),
		...(removed.length ? { removedAiOperationIds: removed } : {}),
	};
}

/**
 * Applies an accepted Improve suggestion as its own editor history event. The first boundary ends the user's typing
 * group; the empty closing transaction makes the next keystroke start a new group instead of joining the AI edit.
 */
export function acceptImproveLine(
	editor: Editor,
	line: Pick<ImproveLine, "from" | "to">,
	text: string,
	aiOperationIds?: string[],
) {
	editor
		.chain()
		.focus()
		.insertContentAt({ from: line.from, to: line.to }, text)
		.command(({ tr }) => {
			if (aiOperationIds?.length) tr.step(new ImproveSourcesStep(aiOperationIds, true));
			closeHistory(tr);
			return true;
		})
		.run();
	editor.view.dispatch(closeHistory(editor.state.tr));
}
