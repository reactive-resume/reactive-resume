import { expect, it, vi } from "vite-plus/test";
import { isRedirect } from "@tanstack/react-router";

// The pages behind these routes aren't under test: only where each old address is sent.
vi.mock("@/features/career/today", () => ({ TodayPage: () => null }));
vi.mock("@/features/career/hooks", () => ({ useOverlayHistory: () => ({}) }));
vi.mock("@/features/career/shared", () => ({ useCareerTime: () => ({}), useNow: () => new Date() }));
vi.mock("@/features/documents/documents-page", () => ({ DocumentsPage: () => null }));
vi.mock("@/features/documents/use-start-document", () => ({ useStartDocument: () => ({}) }));
vi.mock("@/features/settings/ai/page", () => ({ AiSettings: () => null, DeveloperSettings: () => null }));
vi.mock("@/components/layout/phone-header-actions", () => ({ PhoneHeaderActions: () => null }));

const routes = {
	today: () => import("./index"),
	documents: () => import("./documents"),
	resumes: () => import("./resumes/index"),
	letters: () => import("./cover-letters"),
	applicationTrash: () => import("./applications/trash"),
	ai: () => import("./settings/ai"),
	apiKeys: () => import("./settings/api-keys"),
	jobSearch: () => import("./settings/job-search"),
	integrations: () => import("./settings/integrations/route"),
	authentication: () => import("./settings/authentication/index"),
};

type Address = { search?: Record<string, unknown>; hash?: string };
type RouteOptions = {
	validateSearch?: ((search: Record<string, unknown>) => unknown) | { parse: (search: unknown) => unknown };
	beforeLoad?: (context: never) => unknown;
};

/** Where the route sends an address: the redirect it throws from `beforeLoad`, or null when it renders. */
async function destination(route: keyof typeof routes, { search = {}, hash = "" }: Address = {}) {
	const { options } = (await routes[route]()).Route as unknown as { options: RouteOptions };
	const validated =
		typeof options.validateSearch === "function"
			? options.validateSearch(search)
			: (options.validateSearch?.parse(search) ?? search);
	try {
		options.beforeLoad?.({ search: validated, location: { hash } } as never);
	} catch (thrown) {
		if (!isRedirect(thrown)) throw thrown;
		const { to, search, hash, params, replace } = thrown.options;
		const carried = search && Object.keys(search).length > 0;
		return { to, replace, ...(carried ? { search } : {}), ...(hash ? { hash } : {}), ...(params ? { params } : {}) };
	}
	return null;
}

const documents = { type: "all", q: "", tags: [], public: false, sort: "edited" };

it.each<[string, Record<string, unknown>, object]>([
	["a type", { type: "letter" }, { ...documents, type: "letter" }],
	["a search", { q: "design", tags: ["lead"] }, { ...documents, q: "design", tags: ["lead"] }],
	["filters", { public: true, sort: "name", view: "list" }, { ...documents, public: true, sort: "name", view: "list" }],
	["an old letter link", { letter: "letter-1" }, { ...documents, letter: "letter-1" }],
	["a blank resume to start", { new: "resume" }, { ...documents, new: "resume" }],
	["a template to start from", { template: "onyx" }, { ...documents, template: "onyx" }],
])("sends /dashboard with %s on to Documents, search kept", async (_, search, kept) => {
	const sent = await destination("today", { search });
	expect(sent).toMatchObject({ to: "/dashboard/documents", replace: true });
	expect(sent?.search).toEqual(expect.objectContaining(kept));
});

it("opens Today at /dashboard, with or without a schedule", async () => {
	expect(await destination("today")).toBeNull();
	expect(await destination("today", { search: { schedule: "new" } })).toBeNull();
});

it("opens an old letter link in the letter editor from Documents", async () => {
	expect(await destination("documents", { search: { letter: "letter-1" } })).toEqual({
		to: "/builder/letter/$coverLetterId",
		params: { coverLetterId: "letter-1" },
		replace: true,
	});
	expect(await destination("documents", { search: { type: "resume" } })).toBeNull();
});

it("sends the old resume and cover-letter libraries to Documents", async () => {
	expect(await destination("resumes", { search: { tags: ["lead"], sort: "createdAt", view: "list" } })).toEqual({
		to: "/dashboard/documents",
		search: { type: "resume", tags: ["lead"], sort: "created", view: "list" },
		replace: true,
	});
	expect(await destination("letters")).toEqual({
		to: "/dashboard/documents",
		search: { type: "letter" },
		replace: true,
	});
});

it("sends the old application Trash to the one Trash, on applications", async () => {
	expect(await destination("applicationTrash")).toEqual({
		to: "/dashboard/trash",
		search: { kind: "applications" },
		replace: true,
	});
});

it.each<[string, Address, object]>([
	["#api-keys", { hash: "api-keys" }, { hash: "api-keys" }],
	[
		"?newKey=true#api-keys",
		{ search: { newKey: true }, hash: "api-keys" },
		{ search: { newKey: true }, hash: "api-keys" },
	],
	["?newKey=true", { search: { newKey: true } }, { search: { newKey: true }, hash: "api-keys" }],
	["#connected-applications", { hash: "connected-applications" }, { hash: "connected-applications" }],
])("sends settings/ai%s on to Developer", async (_, address, kept) => {
	expect(await destination("ai", address)).toEqual({ to: "/dashboard/settings/developer", replace: true, ...kept });
});

it.each(["", "ai-usage"])("keeps settings/ai#%s on AI", async (hash) => {
	expect(await destination("ai", { hash })).toBeNull();
});

it("keeps the older settings addresses working", async () => {
	expect(await destination("apiKeys")).toEqual({
		to: "/dashboard/settings/developer",
		hash: "api-keys",
		replace: true,
	});
	expect(await destination("jobSearch")).toEqual({ to: "/dashboard/settings/ai", replace: true });
	expect(await destination("integrations")).toEqual({ to: "/dashboard/settings/ai", replace: true });
	expect(await destination("authentication")).toEqual({
		to: "/dashboard/settings/account",
		hash: "security",
		replace: true,
	});
});
