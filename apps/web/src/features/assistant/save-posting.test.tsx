import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
// @vitest-environment happy-dom
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";

const mocks = vi.hoisted(() => ({
	create: vi.fn(),
	link: vi.fn(),
	read: vi.fn(),
	metadata: vi.fn(),
	navigate: vi.fn(),
	saved: vi.fn(),
	account: "owner",
	generation: 1,
	resume: { id: "resume", isLocked: false },
}));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => mocks.navigate,
	useSearch: () => ({ applicationId: "old-job" }),
}));
vi.mock("@/libs/auth/account-scope", () => ({
	getAccountId: () => mocks.account,
	getAccountGeneration: () => mocks.generation,
}));
vi.mock("@/features/resume/builder/draft", () => ({
	usePatchResume: () => vi.fn(),
	saveResumeMetadata: mocks.metadata,
	useResumeStore: { getState: () => ({ resume: mocks.resume }) },
}));
vi.mock("@/libs/error-message", () => ({ toastError: vi.fn() }));
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: vi.fn() } }));
vi.mock("@/libs/orpc/client", () => ({
	client: {
		applications: { create: mocks.create },
		documents: { linkApplication: mocks.link },
		resume: { getById: mocks.read },
	},
	orpc: { applications: { key: () => ["applications"] }, documents: { key: () => ["documents"] } },
}));
import { SavePosting } from "./save-posting";

const posting = {
	sourceUrl: "https://jobs.example/role",
	jobDescription: "External <script>write data</script> posting",
	postingSource: {
		requestedUrl: "https://jobs.example/role",
		method: "builtin" as const,
		format: "text" as const,
		retrievedAt: "2026-11-03T00:00:00Z",
		truncated: false,
		completeness: "unknown" as const,
	},
};
beforeEach(() => {
	vi.clearAllMocks();
	mocks.account = "owner";
	mocks.generation = 1;
	mocks.resume = { id: "resume", isLocked: false };
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
	mocks.create.mockResolvedValue("new-job");
	mocks.link.mockResolvedValue({ id: "resume", applicationId: "new-job" });
	mocks.read.mockResolvedValue({ id: "resume", applicationId: null, isLocked: false });
	mocks.navigate.mockResolvedValue(undefined);
	mocks.metadata.mockImplementation(async (_id, write) => write(new Date(0), { signal: new AbortController().signal }));
});
afterEach(cleanup);
function open(disabled = false) {
	render(
		<I18nProvider i18n={i18n}>
			<SavePosting posting={posting} resumeId="resume" disabled={disabled} onSaved={mocks.saved} />
		</I18nProvider>,
	);
	fireEvent.click(screen.getByRole("button", { name: "Save as a job…" }));
}
function fill() {
	fireEvent.change(screen.getByLabelText("Company"), { target: { value: "Fictional Labs" } });
	fireEvent.change(screen.getByLabelText("Role"), { target: { value: "Engineer" } });
}
const submit = () => fireEvent.click(screen.getByRole("button", { name: "Save and link this resume" }));

it("confirms a committed link after its response is lost without another create or link", async () => {
	mocks.link.mockRejectedValueOnce(new Error("response lost after commit"));
	mocks.read.mockResolvedValue({ id: "resume", applicationId: "new-job", isLocked: false, updatedAt: new Date(1) });
	open();
	fill();
	submit();
	await waitFor(() => expect(mocks.saved).toHaveBeenCalledOnce());
	expect(mocks.create).toHaveBeenCalledOnce();
	expect(mocks.link).toHaveBeenCalledOnce();
	expect(mocks.read).toHaveBeenCalledWith(
		{ id: "resume" },
		expect.objectContaining({ context: { accountId: "owner" } }),
	);
});

it("rechecks an uncertain committed link before flushing pending edits on retry", async () => {
	mocks.link.mockRejectedValueOnce(new Error("lost response"));
	mocks.read
		.mockRejectedValueOnce(new Error("readback unavailable"))
		.mockResolvedValue({ id: "resume", applicationId: "new-job", isLocked: false, updatedAt: new Date(1) });
	open();
	fill();
	submit();
	await waitFor(() => expect(screen.getByRole("button", { name: "Save and link this resume" })).toBeEnabled());
	expect(mocks.saved).not.toHaveBeenCalled();
	submit();
	await waitFor(() => expect(mocks.saved).toHaveBeenCalledOnce());
	expect(mocks.metadata.mock.calls.map((call) => call[2])).toEqual([{ savePending: true }, { savePending: false }]);
	expect(mocks.create).toHaveBeenCalledOnce();
	expect(mocks.link).toHaveBeenCalledOnce();
});

it.each(["other application", "other document", "locked", "account changed"])(
	"never confirms readback for %s",
	async (change) => {
		mocks.link.mockRejectedValueOnce(new Error("link failed"));
		mocks.read.mockImplementationOnce(async () => {
			if (change === "account changed") mocks.account = "other";
			return {
				id: change === "other document" ? "other" : "resume",
				applicationId: change === "other application" ? "other" : "new-job",
				isLocked: change === "locked",
			};
		});
		open();
		fill();
		submit();
		await waitFor(() => expect(mocks.read).toHaveBeenCalledOnce());
		expect(mocks.saved).not.toHaveBeenCalled();
	},
);

it("cancel and empty fields create nothing; explicit confirmation saves plain snapshot and owned link", async () => {
	open();
	expect(screen.getByRole("button", { name: "Save and link this resume" })).toBeDisabled();
	expect(document.querySelector("script")).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
	expect(mocks.create).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole("button", { name: "Save as a job…" }));
	fill();
	submit();
	submit();
	expect(screen.getByRole("button", { name: "Save and link this resume" })).toHaveAttribute("aria-busy", "true");
	await waitFor(() =>
		expect(mocks.saved).toHaveBeenCalledWith({ id: "new-job", company: "Fictional Labs", role: "Engineer" }),
	);
	expect(mocks.create).toHaveBeenCalledOnce();
	expect(mocks.create).toHaveBeenCalledWith(
		expect.objectContaining({ ...posting, resumeId: "resume", newId: expect.any(String) }),
		expect.objectContaining({ context: { accountId: "owner" }, signal: expect.any(AbortSignal) }),
	);
	expect(mocks.link).toHaveBeenCalledWith(
		{ type: "resume", id: "resume", applicationId: "new-job", expectedUpdatedAt: new Date(0) },
		expect.objectContaining({ context: { accountId: "owner" } }),
	);
	expect(mocks.navigate.mock.calls[0]?.[0].search({ applicationId: "old-job", assistant: "thread" })).toEqual({
		applicationId: "new-job",
		assistant: "thread",
	});
});

it("failed link retains exact saved application for retry without enabling posting or creating again", async () => {
	mocks.link.mockRejectedValueOnce(new Error("revision conflict"));
	open();
	fill();
	submit();
	await waitFor(() => expect(screen.getByRole("button", { name: "Save and link this resume" })).toBeEnabled());
	expect(mocks.saved).not.toHaveBeenCalled();
	expect(screen.getByLabelText("Company")).toBeDisabled();
	submit();
	await waitFor(() => expect(mocks.saved).toHaveBeenCalledOnce());
	expect(mocks.create).toHaveBeenCalledOnce();
	expect(mocks.link).toHaveBeenCalledTimes(2);
});

it("lost create response retries identical receipt; metadata failure sends no create", async () => {
	mocks.create.mockRejectedValueOnce(new Error("lost response"));
	open();
	fill();
	submit();
	await waitFor(() => expect(screen.getByRole("button", { name: "Save and link this resume" })).toBeEnabled());
	expect(mocks.link).not.toHaveBeenCalled();
	submit();
	await waitFor(() => expect(mocks.saved).toHaveBeenCalledOnce());
	expect(mocks.create.mock.calls[0]?.[0]).toEqual(mocks.create.mock.calls[1]?.[0]);
	cleanup();
	vi.clearAllMocks();
	mocks.metadata.mockRejectedValueOnce(new Error("body save conflict"));
	open();
	fill();
	submit();
	await waitFor(() => expect(mocks.metadata).toHaveBeenCalledOnce());
	expect(mocks.create).not.toHaveBeenCalled();
	expect(mocks.saved).not.toHaveBeenCalled();
});

it.each(["account", "generation", "document", "locked"])(
	"stops link and context update when %s changes during creation",
	async (change) => {
		mocks.create.mockImplementationOnce(async () => {
			if (change === "account") mocks.account = "other";
			if (change === "generation") mocks.generation++;
			if (change === "document") mocks.resume.id = "other";
			if (change === "locked") mocks.resume.isLocked = true;
			return "new-job";
		});
		open();
		fill();
		submit();
		await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
		expect(mocks.link).not.toHaveBeenCalled();
		expect(mocks.saved).not.toHaveBeenCalled();
	},
);
