/**
 * Optional per-connection task routing. A blank task model keeps that task on the connection's main model, so
 * existing accounts with one model behave exactly as before.
 */
export type AiTask = "fast" | "capable";

type TaskModels = {
	model: string;
	fastModel?: string | null;
	capableModel?: string | null;
};

export function aiModelForTask(provider: TaskModels, task: AiTask) {
	const override = task === "fast" ? provider.fastModel : provider.capableModel;
	return override?.trim() || provider.model;
}

/** The task a public AI operation runs as; used by consent copy so it names the model that will receive data. */
export function aiTaskForOperation(operation: string): AiTask | undefined {
	if (FAST_OPERATIONS.has(operation)) return "fast";
	if (CAPABLE_OPERATIONS.has(operation)) return "capable";
	return undefined;
}

const FAST_OPERATIONS = new Set([
	"ai.improve",
	"ai.parsePdf",
	"ai.parseDocx",
	"applications.ai.autofill",
	"applications.ai.parsePosting",
]);

const CAPABLE_OPERATIONS = new Set([
	"agent.attachments.create",
	"agent.messages.send",
	"agent.threads.update",
	"applications.ai.draftMessage",
	"coverLetters.draft",
]);

/** Every distinct model a connection may send to, in readiness-test order. */
export function aiConfiguredModels(provider: TaskModels) {
	return [
		...new Set(
			[provider.model, provider.fastModel, provider.capableModel]
				.filter((model): model is string => !!model?.trim())
				.map((model) => model.trim()),
		),
	];
}
