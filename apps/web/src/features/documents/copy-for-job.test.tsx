// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Dialog } from "@reactive-resume/ui/components/dialog";

const api = vi.hoisted(() => ({
	documents: [] as unknown[],
	applications: [] as unknown[],
	create: vi.fn(),
	copyForJob: vi.fn(),
	navigate: vi.fn(),
	endpoint: (key: string, data: () => unknown) => ({
		key: () => [key],
		queryKey: () => [key],
		queryOptions: () => ({ queryKey: [key], queryFn: async () => data() }),
	}),
}));
vi.mock("@/libs/orpc/client", () => ({
	client: {},
	orpc: {
		documents: {
			...api.endpoint("documents", () => api.documents),
			list: api.endpoint("documents", () => api.documents),
			copyForJob: { mutationOptions: () => ({ mutationFn: api.copyForJob }) },
		},
		applications: {
			listSummary: api.endpoint("applications", () => api.applications),
			create: { mutationOptions: () => ({ mutationFn: api.create }) },
		},
		aiProviders: { list: api.endpoint("providers", () => []) },
		resume: { create: { mutationOptions: () => ({ mutationFn: vi.fn() }) } },
		coverLetters: { create: { mutationOptions: () => ({ mutationFn: vi.fn() }) } },
	},
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => api.navigate }));
vi.mock("@/features/settings/integrations/hooks/use-has-usable-ai-provider", () => ({
	useHasUsableAiProvider: () => ({ hasUsableProvider: false, isUnavailable: false, usableProviders: [] }),
}));
vi.mock("@/features/settings/integrations/ai-provider-load-state", () => ({ AiProviderLoadState: () => null }));

import { NewDocumentDialog } from "./new-document-dialog";

afterEach(cleanup);

const resume = (id: string, name: string, edited: string, application: { company: string } | null) => ({
	id,
	type: "resume",
	name,
	tags: [],
	isLocked: false,
	isPublic: false,
	slug: null,
	trashedAt: null,
	createdAt: new Date("2026-10-01T00:00:00Z"),
	updatedAt: new Date(edited),
	application: application ? { id: `job-${id}`, role: "Director", ...application } : null,
});

function mount() {
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<I18nProvider i18n={i18n}>
			<QueryClientProvider client={client}>
				<Dialog open>
					<NewDocumentDialog data={{ step: "copy" }} />
				</Dialog>
			</QueryClientProvider>
		</I18nProvider>,
	);
}

it("starts a copy from the base resume, not the job copy edited last, and shows each source's job (J2-03)", async () => {
	api.documents = [
		resume("northwind", "Morgan Chen — Northwind Labs", "2026-10-30T12:00:00Z", { company: "Northwind Labs" }),
		resume("master", "Morgan Chen — master", "2026-10-30T09:00:00Z", null),
	];
	api.applications = [];
	mount();

	const base = await screen.findByRole("radio", { name: /Morgan Chen — master/ });
	expect(base).toBeChecked();
	expect(screen.getByRole("radio", { name: /Northwind Labs/ })).not.toBeChecked();
	expect(screen.getByText("Copy for Northwind Labs")).toBeVisible();
	expect(screen.getByText("Not linked to a job")).toBeVisible();
});

it("falls back to the most recent resume when every resume is a job copy", async () => {
	api.documents = [
		resume("older", "Copy — Older", "2026-10-01T00:00:00Z", { company: "Older" }),
		resume("newer", "Copy — Newer", "2026-10-20T00:00:00Z", { company: "Newer" }),
	];
	mount();
	expect(await screen.findByRole("radio", { name: /Copy — Newer/ })).toBeChecked();
});

it("adds the job right here, then copies the base resume for it (J2-23)", async () => {
	api.documents = [resume("master", "Morgan Chen — master", "2026-10-30T09:00:00Z", null)];
	api.applications = [];
	api.create.mockResolvedValue("job-new");
	api.copyForJob.mockResolvedValue("copy-1");
	mount();

	fireEvent.click(await screen.findByRole("button", { name: "Add a job" }));
	fireEvent.change(screen.getByLabelText("Company"), { target: { value: "Fieldnote" } });
	fireEvent.change(screen.getByLabelText("Role"), { target: { value: "VP of Engineering" } });
	fireEvent.change(screen.getByLabelText("Job posting (optional)"), { target: { value: "Own delivery." } });
	expect(screen.getByLabelText("Name")).toHaveValue("Morgan Chen — Fieldnote");
	fireEvent.click(screen.getByRole("button", { name: "Save job, create and open" }));

	await waitFor(() => expect(api.copyForJob).toHaveBeenCalled());
	// The job is saved with its copy in one request: both land, or neither does.
	expect(api.create).not.toHaveBeenCalled();
	expect(api.copyForJob.mock.calls[0]?.[0]).toEqual({
		resumeId: "master",
		application: {
			company: "Fieldnote",
			role: "VP of Engineering",
			jobDescription: "Own delivery.",
			postingSource: { method: "paste", format: "text", truncated: false, completeness: "unknown" },
		},
		name: "Morgan Chen — Fieldnote",
		newId: expect.stringMatching(/^[0-9a-f-]{36}$/),
	});
	expect(api.navigate).toHaveBeenCalledWith(
		expect.objectContaining({ to: "/builder/$resumeId", params: { resumeId: "copy-1" } }),
	);
});

it("retries a lost save with the same request, so the job and its copy are saved once", async () => {
	api.documents = [resume("master", "Morgan Chen — master", "2026-10-30T09:00:00Z", null)];
	api.create.mockReset();
	// The first response is lost: the server saved both, the browser never heard.
	api.copyForJob.mockReset().mockRejectedValueOnce(new Error("offline")).mockResolvedValue("copy-2");
	mount();
	fireEvent.click(await screen.findByRole("button", { name: "Add a job" }));
	fireEvent.change(screen.getByLabelText("Company"), { target: { value: "Fieldnote" } });
	fireEvent.change(screen.getByLabelText("Role"), { target: { value: "VP" } });
	fireEvent.click(screen.getByRole("button", { name: "Save job, create and open" }));
	await waitFor(() => expect(api.copyForJob).toHaveBeenCalledTimes(1));
	await waitFor(() => expect(screen.getByRole("button", { name: "Save job, create and open" })).toBeEnabled());
	fireEvent.click(screen.getByRole("button", { name: "Save job, create and open" }));
	await waitFor(() => expect(api.copyForJob).toHaveBeenCalledTimes(2));
	expect(api.create).not.toHaveBeenCalled();
	const [first, retry] = api.copyForJob.mock.calls.map((call) => call[0]);
	expect(retry).toEqual(first);
});
