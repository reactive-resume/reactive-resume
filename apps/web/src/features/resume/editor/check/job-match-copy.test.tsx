// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";

const api = vi.hoisted(() => ({
	applications: [] as { id: string; company: string; role: string; status: string }[],
	create: vi.fn(),
	copyForJob: vi.fn(),
	link: vi.fn(),
	navigate: vi.fn(),
	save: vi.fn(),
}));
vi.mock("@/libs/orpc/client", () => ({
	orpc: {
		applications: {
			getById: {
				queryKey: () => ["application"],
				queryOptions: () => ({ queryKey: ["application"], queryFn: async () => null }),
			},
			listSummary: {
				queryKey: () => ["applications"],
				queryOptions: () => ({ queryKey: ["applications"], queryFn: async () => api.applications }),
			},
			create: { mutationOptions: () => ({ mutationFn: api.create }) },
			update: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
		},
		documents: {
			key: () => ["documents"],
			linkApplication: { mutationOptions: () => ({ mutationFn: api.link }) },
			copyForJob: { mutationOptions: () => ({ mutationFn: api.copyForJob }) },
		},
	},
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => api.navigate }));
vi.mock("@/features/resume/builder/draft", () => ({
	useCurrentBuilderResumeSelector: (select: (resume: { id: string; applicationId: null }) => unknown) =>
		select({ id: "base-resume", applicationId: null }),
	useIsResumeLocked: () => false,
	usePatchResume: () => vi.fn(),
	savePendingChanges: api.save,
}));
vi.mock("@/features/assistant/open", () => ({ openAssistantFrom: vi.fn() }));
vi.mock("./actions", () => ({ checkStateOf: vi.fn(), editWithUndo: vi.fn() }));
vi.mock("@reactive-resume/resume/ats-pdf", () => ({
	matchJobDescription: () => ({ terms: [] }),
	surfaceFormsOf: () => [],
}));

import { useEditorStore } from "../store";
import { JobMatchTab, useJobMatch } from "./job-match";

afterEach(cleanup);

function Match() {
	return <JobMatchTab match={useJobMatch(defaultResumeData)} data={defaultResumeData} />;
}

function mount() {
	i18n.loadAndActivate({ locale: "en", messages: {} });
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<QueryClientProvider client={client}>
			<I18nProvider i18n={i18n}>
				<Match />
			</I18nProvider>
		</QueryClientProvider>,
	);
}

it("saves a pasted posting as a job and tailors a copy, leaving the base resume unlinked (J2-05)", async () => {
	useEditorStore.setState({ pastedPosting: "VP of Engineering at Fieldnote. Own delivery." });
	api.save.mockResolvedValue(true);
	api.create.mockResolvedValue("job-fieldnote");
	api.copyForJob.mockResolvedValue("copy-fieldnote");
	mount();

	fireEvent.click(await screen.findByRole("button", { name: "Save as a job…" }));
	fireEvent.change(screen.getByLabelText("Company"), { target: { value: "Fieldnote" } });
	fireEvent.change(screen.getByLabelText("Role"), { target: { value: "VP of Engineering" } });
	fireEvent.click(screen.getByRole("button", { name: "Save job and make a copy" }));

	await waitFor(() => expect(api.navigate).toHaveBeenCalled());
	expect(api.save).toHaveBeenCalledWith("base-resume");
	// The job is saved with its copy, in one request; the base resume is never linked.
	expect(api.create).not.toHaveBeenCalled();
	expect(api.copyForJob.mock.calls[0]?.[0]).toEqual({
		resumeId: "base-resume",
		application: {
			company: "Fieldnote",
			role: "VP of Engineering",
			jobDescription: "VP of Engineering at Fieldnote. Own delivery.",
			postingSource: { method: "paste", format: "text", truncated: false, completeness: "unknown" },
		},
		newId: expect.stringMatching(/^[0-9a-f-]{36}$/),
	});
	expect(api.link).not.toHaveBeenCalled();
	expect(api.navigate).toHaveBeenCalledWith({
		to: "/builder/$resumeId",
		params: { resumeId: "copy-fieldnote" },
		search: { mode: "check" },
	});
	expect(useEditorStore.getState().checkTab).toBe("match");
});

it("still links the base resume itself when that's chosen", async () => {
	useEditorStore.setState({ pastedPosting: "Head of Engineering at Parcel & Co." });
	api.create.mockReset().mockResolvedValue("job-parcel");
	api.copyForJob.mockReset();
	api.link.mockReset().mockResolvedValue(undefined);
	mount();

	fireEvent.click(await screen.findByRole("button", { name: "Save as a job…" }));
	fireEvent.change(screen.getByLabelText("Company"), { target: { value: "Parcel & Co." } });
	fireEvent.change(screen.getByLabelText("Role"), { target: { value: "Head of Engineering" } });
	fireEvent.click(screen.getByRole("button", { name: "Save and link this resume" }));

	await waitFor(() => expect(api.link).toHaveBeenCalled());
	expect(api.link.mock.calls[0]?.[0]).toEqual({ type: "resume", id: "base-resume", applicationId: "job-parcel" });
	expect(api.copyForJob).not.toHaveBeenCalled();
});

it("picking a saved job for a base resume asks whether to copy or link, and copies by default", async () => {
	useEditorStore.setState({ pastedPosting: "" });
	api.applications = [{ id: "job-northwind", company: "Northwind Labs", role: "Director", status: "saved" }];
	api.save.mockResolvedValue(true);
	api.copyForJob.mockReset().mockResolvedValue("copy-northwind");
	api.link.mockReset();
	mount();

	const picker = await screen.findByRole("combobox", { name: "Link an application" });
	await waitFor(() => expect(screen.getByRole("option", { name: "Director · Northwind Labs" })).toBeTruthy());
	fireEvent.change(picker, { target: { value: "job-northwind" } });
	expect(api.link).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole("button", { name: "Make a copy for this job" }));

	await waitFor(() =>
		expect(api.copyForJob.mock.calls[0]?.[0]).toEqual({
			resumeId: "base-resume",
			applicationId: "job-northwind",
			newId: expect.stringMatching(/^[0-9a-f-]{36}$/),
		}),
	);
	expect(api.link).not.toHaveBeenCalled();
});

it("retries a lost save after Check is opened again with the same request, so the job and copy are saved once", async () => {
	useEditorStore.setState({ pastedPosting: "Staff Designer at Lumen. Figma and SQL." });
	api.applications = [];
	api.save.mockResolvedValue(true);
	api.create.mockReset();
	api.navigate.mockReset();
	// The first response is lost: the server saved both, the browser never heard.
	api.copyForJob.mockReset().mockRejectedValueOnce(new Error("Network error")).mockResolvedValueOnce("copy-lumen");
	const fill = async () => {
		fireEvent.click(await screen.findByRole("button", { name: "Save as a job…" }));
		fireEvent.change(screen.getByLabelText("Company"), { target: { value: "Lumen" } });
		fireEvent.change(screen.getByLabelText("Role"), { target: { value: "Staff Designer" } });
		fireEvent.click(screen.getByRole("button", { name: "Save job and make a copy" }));
	};
	mount();
	await fill();
	await waitFor(() => expect(api.copyForJob).toHaveBeenCalledTimes(1));

	cleanup();
	mount();
	await fill();

	await waitFor(() => expect(api.navigate).toHaveBeenCalled());
	const [first, retry] = api.copyForJob.mock.calls.map((call) => call[0]);
	expect(retry).toEqual(first);
	expect(api.create).not.toHaveBeenCalled();
});
