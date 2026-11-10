import type { MutationInputs, MutationOutput } from "./resources";
import { t } from "@lingui/core/macro";
import { useQueryClient } from "@tanstack/react-query";
import { generateId } from "@reactive-resume/utils/string";
import { useDataActions, useDataBackend } from "./provider";
import { assertStageGate } from "./write-policy";
import { getAccountScope } from "@/auth/session";
export { assertStageGate } from "./write-policy";
export function usePlatformActions() {
	const { backend, scope } = useDataBackend();
	const query = useQueryClient();
	const queued = useDataActions();
	return {
		/** Online-only commands include secrets, AI requests, and creates without server idempotency keys. */
		async run<K extends keyof MutationInputs>(
			operation: K,
			input: MutationInputs[K],
			signal?: AbortSignal,
		): Promise<MutationOutput<K>> {
			if (!scope || (backend.kind !== "fake" && getAccountScope() !== scope)) throw new Error(t`Sign in again.`);
			signal?.throwIfAborted();
			assertStageGate(operation, input);
			const result = await backend.write(operation, input, scope, signal);
			if (backend.kind !== "fake" && getAccountScope() !== scope) throw new Error(t`The account changed.`);
			await query.invalidateQueries({ queryKey: [scope] });
			signal?.throwIfAborted();
			return result as MutationOutput<K>;
		},
		write: queued.write,
		flush: queued.flush,
	};
}

/** Batch writes stop on failure; accepted rows remain accepted and remaining rows stay queued. */
export function useDocumentActions() {
	const actions = usePlatformActions();
	const context = useDataBackend();
	return {
		createResume: (input: MutationInputs["resume.create"]) => actions.run("resume.create", input),
		createLetter: (input: MutationInputs["coverLetters.create"]) => actions.run("coverLetters.create", input),
		duplicateResume: (input: MutationInputs["resume.duplicate"]) => actions.run("resume.duplicate", input),
		duplicateLetter: (input: MutationInputs["coverLetters.duplicate"]) => actions.run("coverLetters.duplicate", input),
		rename: (input: MutationInputs["documents.rename"]) =>
			actions.write(input.type === "letter" ? "letters" : "documents", "documents.rename", input),
		setTags: (input: MutationInputs["documents.setTags"]) =>
			actions.write(input.type === "letter" ? "letters" : "documents", "documents.setTags", input),
		setLocked: (input: MutationInputs["documents.setLocked"]) =>
			actions.write(input.type === "letter" ? "letters" : "documents", "documents.setLocked", input),
		linkApplication: (input: MutationInputs["documents.linkApplication"]) =>
			actions.write(input.type === "letter" ? "letters" : "documents", "documents.linkApplication", input),
		async batchTags(documents: MutationInputs["documents.setTags"][]) {
			// Enqueue the whole selection before trying network, including while offline.
			const { writeQueue } = await import("./queue");
			const { activeDataScope } = await import("./scope");
			const scope = activeDataScope();
			if (scope !== context.scope) throw new Error(t`The account changed.`);
			if (context.backend.kind === "guest") {
				for (const input of documents) await actions.run("documents.setTags", input);
				return;
			}
			for (const input of documents)
				writeQueue.enqueue(scope, {
					id: generateId(),
					kind: input.type === "letter" ? "letters" : "documents",
					operation: "documents.setTags",
					input,
				});
			await actions.flush();
		},
	};
}

export function useVersionActions() {
	const actions = usePlatformActions();
	return {
		nameResume: (input: MutationInputs["resume.createVersion"]) => actions.run("resume.createVersion", input),
		renameResume: (input: MutationInputs["resume.renameVersion"]) =>
			actions.write("documents", "resume.renameVersion", input),
		deleteResume: (input: MutationInputs["resume.deleteVersion"]) =>
			actions.write("documents", "resume.deleteVersion", input),
		restoreResume: (input: MutationInputs["resume.restoreVersion"]) => actions.run("resume.restoreVersion", input),
		nameLetter: (input: MutationInputs["coverLetters.createVersion"]) =>
			actions.run("coverLetters.createVersion", input),
		renameLetter: (input: MutationInputs["coverLetters.renameVersion"]) =>
			actions.write("letters", "coverLetters.renameVersion", input),
		deleteLetter: (input: MutationInputs["coverLetters.deleteVersion"]) =>
			actions.write("letters", "coverLetters.deleteVersion", input),
		restoreLetter: (input: MutationInputs["coverLetters.restoreVersion"]) =>
			actions.run("coverLetters.restoreVersion", input),
	};
}
export function useSharingActions() {
	const actions = usePlatformActions();
	return {
		createFeedback: (input: MutationInputs["feedback.create"]) => actions.run("feedback.create", input),
		revokeFeedback: (input: MutationInputs["feedback.revoke"]) => actions.write("documents", "feedback.revoke", input),
		resolveComment: (input: MutationInputs["feedback.resolveComment"]) =>
			actions.write("documents", "feedback.resolveComment", input),
		setDomain: (input: MutationInputs["customDomain.set"]) => actions.run("customDomain.set", input),
		verifyDomain: (input: MutationInputs["customDomain.verify"]) => actions.run("customDomain.verify", input),
		removeDomain: () => actions.run("customDomain.remove", {}),
	};
}
export function useCareerActions() {
	const actions = usePlatformActions();
	return {
		correctFact: (input: MutationInputs["career.correctFact"]) =>
			actions.write("stories-and-facts", "career.correctFact", input),
		proposeResumeFacts: (input: MutationInputs["career.proposeResumeFacts"]) =>
			actions.run("career.proposeResumeFacts", input),
		saveResumeFacts: (input: MutationInputs["career.saveResumeFacts"]) =>
			actions.write("stories-and-facts", "career.saveResumeFacts", input),
		suggestRoles: (input: MutationInputs["career.suggestTargetRoles"], signal?: AbortSignal) =>
			actions.run("career.suggestTargetRoles", input, signal),
		deleteOffer: (input: MutationInputs["career.deleteSavedItem"]) =>
			actions.write("stories-and-facts", "career.deleteSavedItem", input),
		saveFact: (input: MutationInputs["career.saveFact"]) => actions.run("career.saveFact", input),
		updateFact: (input: MutationInputs["career.updateFact"]) =>
			actions.write("stories-and-facts", "career.updateFact", input),
		forgetFact: (input: MutationInputs["career.forgetFact"]) =>
			actions.write("stories-and-facts", "career.forgetFact", input),
		saveStory: (input: MutationInputs["career.saveStory"]) => actions.run("career.saveStory", input),
		deleteStory: (input: MutationInputs["career.deleteStory"]) =>
			actions.write("stories-and-facts", "career.deleteStory", input),
		savePreferences: (input: MutationInputs["career.updateProfile"]) =>
			actions.write("profile", "career.updateProfile", input),
		createOffer: (input: MutationInputs["career.createOffer"]) => actions.run("career.createOffer", input),
		updateOffer: (input: MutationInputs["career.updateOffer"]) =>
			actions.write("stories-and-facts", "career.updateOffer", input),
		deleteSavedItem: (input: MutationInputs["career.deleteSavedItem"]) =>
			actions.write("stories-and-facts", "career.deleteSavedItem", input),
	};
}
export function useAIProviderActions() {
	const actions = usePlatformActions();
	return {
		create: (input: MutationInputs["aiProviders.create"]) => actions.run("aiProviders.create", input),
		update: (input: MutationInputs["aiProviders.update"]) => actions.run("aiProviders.update", input),
		async test(input: MutationInputs["aiProviders.test"]) {
			const started = Date.now();
			const result = await actions.run("aiProviders.test", input);
			return { ...result, latencyMs: Date.now() - started };
		},
		setDefault: (input: MutationInputs["aiProviders.setDefault"]) => actions.run("aiProviders.setDefault", input),
		delete: (input: MutationInputs["aiProviders.delete"]) => actions.run("aiProviders.delete", input),
	};
}
export function useAPIKeyActions() {
	const actions = usePlatformActions();
	return {
		create: (input: MutationInputs["auth.createApiKey"]) => actions.run("auth.createApiKey", input),
		delete: (input: MutationInputs["auth.apiKeys.delete"]) => actions.run("auth.apiKeys.delete", input),
	};
}
