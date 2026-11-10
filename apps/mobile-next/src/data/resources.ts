import { t } from "@lingui/core/macro";
import { assertStageGate } from "./write-policy";
import { client } from "@/api/client";

/** The server router remains the only API contract. Resource hooks keep these exact input/output types. */
export const readers = {
	documents: client.documents.list,
	resume: client.resume.getById,
	letter: client.coverLetters.getById,
	applications: client.applications.list,
	application: client.applications.getById,
	workspace: client.career.workspace,
	facts: client.career.facts,
	stories: client.career.stories,
	preferences: client.career.profile,
	offers: client.career.savedItems,
	schedules: client.career.schedules,
	account: client.auth.getProfile,
	profile: client.applicationProfile.get,
	aiProviders: client.aiProviders.list,
	notifications: client.career.notifications,
	opportunities: client.career.opportunities,
	applicationTrash: client.applications.listTrash,
	publicResume: client.resume.getBySlug,
	versions: client.resume.listVersions,
	letterVersions: client.coverLetters.listVersions,
	documentPage: client.documents.page,
	resumeVersion: client.resume.getVersion,
	letterVersion: client.coverLetters.getVersion,
	visitorStatistics: client.resume.statistics.getById,
	dailyVisitors: client.resume.statistics.getDailyById,
	feedbackLinks: client.feedback.list,
	feedbackLink: client.feedback.get,
	customDomain: client.customDomain.get,
	conversations: client.agent.threads.list,
	conversation: client.agent.threads.get,
	applicationStats: client.applications.stats,
	library: client.career.savedItems,
	forgottenFacts: client.career.forgottenFacts,
	transcripts: client.career.voice.transcripts,
	apiKeys: client.auth.apiKeys.list,
	connectedApps: client.auth.connections.list,
	lanes: client.applications.lanes.get,
	webAccess: client.webAccess.status,
};
export type Resource = keyof typeof readers;
export type ResourceInput<K extends Resource> = Parameters<(typeof readers)[K]>[0];
export type ResourceOutput<K extends Resource> = Awaited<ReturnType<(typeof readers)[K]>>;
export type Backend = {
	kind: "real" | "fake" | "guest";
	read<K extends Resource>(resource: K, input: ResourceInput<K>, signal?: AbortSignal): Promise<ResourceOutput<K>>;
	write(operation: string, input: unknown, scope: string, signal?: AbortSignal): Promise<unknown>;
};
export const writes = {
	"applications.lanes.create": client.applications.lanes.create,
	"applications.lanes.update": client.applications.lanes.update,
	"applications.lanes.reorder": client.applications.lanes.reorder,
	"applications.lanes.retire": client.applications.lanes.retire,
	"career.correctFact": client.career.correctFact,
	"career.proposeResumeFacts": client.career.proposeResumeFacts,
	"career.saveResumeFacts": client.career.saveResumeFacts,
	"career.suggestTargetRoles": client.career.suggestTargetRoles,
	"ai.improve": client.ai.improve,
	"applicationProfile.save": client.applicationProfile.save,
	"career.saveProfile": client.career.saveProfile,
	"career.updateProfile": client.career.updateProfile,
	"career.saveFact": client.career.saveFact,
	"career.updateFact": client.career.updateFact,
	"career.saveStory": client.career.saveStory,
	"career.saveWorkspace": client.career.saveWorkspace,
	"applications.update": client.applications.update,
	"documents.rename": client.documents.rename,
	"documents.setTags": client.documents.setTags,
	"documents.setLocked": client.documents.setLocked,
	"documents.linkApplication": client.documents.linkApplication,
	"documents.copyForJob": client.documents.copyForJob,
	"resume.create": client.resume.create,
	"resume.import": client.resume.import,
	"resume.duplicate": client.resume.duplicate,
	"resume.update": client.resume.update,
	"resume.setPassword": client.resume.setPassword,
	"resume.removePassword": client.resume.removePassword,
	"resume.createVersion": client.resume.createVersion,
	"resume.renameVersion": client.resume.renameVersion,
	"resume.deleteVersion": client.resume.deleteVersion,
	"resume.restoreVersion": client.resume.restoreVersion,
	"coverLetters.create": client.coverLetters.create,
	"coverLetters.duplicate": client.coverLetters.duplicate,
	"coverLetters.renameVersion": client.coverLetters.renameVersion,
	"coverLetters.deleteVersion": client.coverLetters.deleteVersion,
	"coverLetters.createVersion": client.coverLetters.createVersion,
	"coverLetters.restoreVersion": client.coverLetters.restoreVersion,
	"applications.create": client.applications.create,
	"applications.bulkUpdate": client.applications.bulkUpdate,
	"applications.addNote": client.applications.addNote,
	"applications.addInterview": client.applications.addInterview,
	"applications.updateInterview": client.applications.updateInterview,
	"applications.logFollowUp": client.applications.logFollowUp,
	"career.markNotificationRead": client.career.markNotificationRead,
	"career.dismissOpportunity": client.career.dismissOpportunity,
	"career.trackOpportunity": client.career.trackOpportunity,
	"career.forgetFact": client.career.forgetFact,
	"career.deleteStory": client.career.deleteStory,
	"career.createOffer": client.career.createOffer,
	"career.updateOffer": client.career.updateOffer,
	"career.deleteSavedItem": client.career.deleteSavedItem,
	"career.generate": client.career.generate,
	"career.applyReply": client.career.applyReply,
	"career.undoReply": client.career.undoReply,
	"career.saveSchedule": client.career.saveSchedule,
	"career.deleteSchedule": client.career.deleteSchedule,
	"feedback.create": client.feedback.create,
	"feedback.revoke": client.feedback.revoke,
	"feedback.resolveComment": client.feedback.resolveComment,
	"customDomain.set": client.customDomain.set,
	"customDomain.verify": client.customDomain.verify,
	"customDomain.remove": client.customDomain.remove,
	"agent.threads.start": client.agent.threads.start,
	"agent.threads.update": client.agent.threads.update,
	"agent.threads.delete": client.agent.threads.delete,
	"agent.attachments.create": client.agent.attachments.create,
	"agent.attachments.delete": client.agent.attachments.delete,
	"agent.messages.setEditStatus": client.agent.messages.setEditStatus,
	"agent.messages.stop": client.agent.messages.stop,
	"auth.updateProfile": client.auth.updateProfile,
	"auth.exportData": client.auth.exportData,
	"auth.deleteAccount": client.auth.deleteAccount,
	"auth.createApiKey": client.auth.createApiKey,
	"auth.apiKeys.delete": client.auth.apiKeys.delete,
	"aiProviders.create": client.aiProviders.create,
	"aiProviders.update": client.aiProviders.update,
	"aiProviders.delete": client.aiProviders.delete,
	"aiProviders.setDefault": client.aiProviders.setDefault,
	"aiProviders.test": client.aiProviders.test,
	"applications.ai.parsePosting": client.applications.ai.parsePosting,
};
export type MutationInputs = { [K in keyof typeof writes]: Parameters<(typeof writes)[K]>[0] };
export type MutationOutput<K extends keyof typeof writes> = Awaited<ReturnType<(typeof writes)[K]>>;
export const realBackend: Backend = {
	kind: "real",
	read: (resource, input, signal) => {
		// Indexed functions have correlated input/output unions; the public generic preserves that relation.
		const read = readers[resource] as (
			value: ResourceInput<typeof resource>,
			options: { signal?: AbortSignal },
		) => Promise<ResourceOutput<typeof resource>>;
		return read(input, signal ? { signal } : {});
	},
	write: async (operation, input, scope, signal) => {
		signal?.throwIfAborted();
		assertStageGate(operation, input);
		if (!(operation in writes)) throw new Error(t`Unsupported queued operation.`);
		const write = writes[operation as keyof typeof writes] as (
			input: unknown,
			options: { context: { scope: string }; signal?: AbortSignal },
		) => Promise<unknown>;
		const result = await write(input, { context: { scope }, ...(signal ? { signal } : {}) });
		if (operation === "documents.copyForJob" && result !== (input as MutationInputs["documents.copyForJob"]).newId)
			throw Object.assign(new Error(t`Update your server before copying for a job.`), { code: "CONFLICT" });
		return result;
	},
};
