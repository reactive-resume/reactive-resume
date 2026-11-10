import type { RouterInput } from "@/api/client";
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
};
export type Resource = keyof typeof readers;
export type ResourceInput<K extends Resource> = Parameters<(typeof readers)[K]>[0];
export type ResourceOutput<K extends Resource> = Awaited<ReturnType<(typeof readers)[K]>>;
export type Backend = {
	kind: "real" | "fake" | "guest";
	read<K extends Resource>(resource: K, input: ResourceInput<K>, signal?: AbortSignal): Promise<ResourceOutput<K>>;
	write(operation: string, input: unknown, scope: string): Promise<unknown>;
};
export type MutationInputs = {
	"applicationProfile.save": RouterInput["applicationProfile"]["save"];
	"career.saveProfile": RouterInput["career"]["saveProfile"];
	"career.updateProfile": RouterInput["career"]["updateProfile"];
	"career.saveFact": RouterInput["career"]["saveFact"];
	"career.updateFact": RouterInput["career"]["updateFact"];
	"career.saveStory": RouterInput["career"]["saveStory"];
	"career.saveWorkspace": RouterInput["career"]["saveWorkspace"];
	"applications.update": RouterInput["applications"]["update"];
	"documents.rename": RouterInput["documents"]["rename"];
	"documents.setTags": RouterInput["documents"]["setTags"];
};
const writes = {
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
};
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
	write: (operation, input, scope) => {
		if (!(operation in writes)) throw new Error("Unsupported queued operation.");
		const write = writes[operation as keyof typeof writes] as (
			input: unknown,
			options: { context: { scope: string } },
		) => Promise<unknown>;
		return write(input, { context: { scope } });
	},
};
