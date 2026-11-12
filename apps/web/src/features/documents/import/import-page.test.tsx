// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseResumeText } from "@reactive-resume/import/plain-text";
import { getLanguageName } from "@reactive-resume/utils/locale";

const api = vi.hoisted(() => ({
	providers: vi.fn(),
	importResume: vi.fn(),
	createResume: vi.fn(),
	parsePdf: vi.fn(),
	parseDocx: vi.fn(),
	readPdfResume: vi.fn(),
	readPdfSource: vi.fn(),
	createLetter: vi.fn(),
	listDocuments: vi.fn(),
	linkApplication: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/components/calm/crumb", () => ({
	Crumb: ({ children }: { children: React.ReactNode }) => <nav>{children}</nav>,
	CrumbLink: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/components/layout/phone-header-actions", () => ({ PhoneHeaderActions: () => null }));
vi.mock("@/features/assistant/provider-setup", () => ({ ProviderSetup: () => null }));
vi.mock("@/features/resume/import/pdf-text", () => ({
	readPdfResume: api.readPdfResume,
	readPdfSource: api.readPdfSource,
}));
vi.mock("@/libs/orpc/client", () => ({
	client: {
		documents: { list: api.listDocuments, linkApplication: api.linkApplication },
		resume: { import: api.importResume },
		ai: { parsePdf: api.parsePdf, parseDocx: api.parseDocx },
	},
	orpc: {
		aiProviders: {
			list: { queryOptions: () => ({ queryKey: ["providers"], queryFn: api.providers, retry: false }) },
		},
		documents: { key: () => ["documents"] },
		resume: { create: { mutationOptions: () => ({ mutationFn: api.createResume }) } },
		coverLetters: { create: { mutationOptions: () => ({ mutationFn: api.createLetter }) } },
	},
}));

import { ImportPage } from "./import-page";
import { handOverImportFile } from "./pending-file";
import { setAccountScope, invalidateAccountScope } from "@/libs/auth/account-scope";

let queryClient: QueryClient;
beforeEach(() => {
	vi.clearAllMocks();
	setAccountScope("import-owner");
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
	queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	api.listDocuments.mockResolvedValue([]);
	api.providers.mockRejectedValue(new Error("Provider lookup offline"));
	api.importResume.mockResolvedValue("imported-resume");
	api.readPdfSource.mockResolvedValue({
		lines: ["Alex Morgan", "Customer research", "Patents", "US 11,234,567 · Accessible payment validation"],
		links: [],
	});
	api.readPdfResume.mockResolvedValue(
		parseResumeText(
			["Alex Morgan", "alex@example.test", "Product Manager", "Experience", "Customer research"].join("\n"),
		),
	);
});
afterEach(() => {
	cleanup();
	queryClient.clear();
});
/** The page with a file chosen in its picker, or (`handedOver`) one that arrived with the page, still unread. */
function mount(file?: File, handedOver = false) {
	if (file && handedOver) handOverImportFile(file);
	const mounted = render(
		<I18nProvider i18n={i18n}>
			<QueryClientProvider client={queryClient}>
				<ImportPage />
			</QueryClientProvider>
		</I18nProvider>,
	);
	if (file && !handedOver)
		fireEvent.change(screen.getByLabelText("Choose a file to import"), { target: { files: [file] } });
	return mounted;
}

it("imports a PDF through the local text reader when AI connection lookup fails", async () => {
	const file = new File(["%PDF-test"], "resume.pdf", { type: "application/pdf" });
	mount(file);
	await screen.findByRole("heading", { name: "How to read this file" });
	expect(api.parsePdf).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole("button", { name: "Read on this device" }));
	// Nothing is created until the user has seen what was found and what wasn't.
	await screen.findByRole("heading", { name: /^What was found/ });
	expect(api.importResume).not.toHaveBeenCalled();
	expect(screen.getByText("US 11,234,567 · Accessible payment validation")).toBeVisible();
	fireEvent.click(screen.getByRole("button", { name: "Create resume" }));
	await screen.findByRole("heading", { name: "Imported" });
	expect(api.providers).toHaveBeenCalled();
	expect(api.readPdfResume).toHaveBeenCalledWith(file);
	expect(api.importResume).toHaveBeenCalledWith(
		{
			aiOperationIds: [],
			data: expect.objectContaining({
				basics: expect.objectContaining({ name: "Alex Morgan" }),
				// The unplaced line is kept, as the user chose by default.
				customSections: [expect.objectContaining({ title: "More from your file" })],
			}),
		},
		expect.objectContaining({ context: { accountId: "import-owner" } }),
	);
	expect(api.parsePdf).not.toHaveBeenCalled();
	expect(api.parseDocx).not.toHaveBeenCalled();
	expect(screen.getByRole("button", { name: "Open in editor" })).toBeEnabled();
});

it.each([false, true])("describes partial PDF comparison honestly when readable source is %s", async (readable) => {
	api.providers.mockResolvedValue([
		{ id: "fictional-provider", label: "Fictional provider", model: "fixture", enabled: true, testStatus: "success" },
	]);
	api.parsePdf.mockResolvedValue(parseResumeText("Alex Morgan\nalex@example.test"));
	api.readPdfSource.mockResolvedValue({
		lines: readable ? ["Fictional omitted paragraph"] : [],
		links: [],
		partial: true,
	});
	mount(new File(["%PDF-test"], "resume.pdf", { type: "application/pdf" }));
	fireEvent.click(await screen.findByRole("button", { name: /^Read with AI$/ }));
	await screen.findByRole("heading", { name: /^What was found/ });
	expect(
		screen.getByText(
			readable
				? "Only part of this file could be compared with what came in. Check each section against your file in the editor."
				: "This file's text couldn't be compared with what came in, so lines left out aren't listed. Check each section against your file in the editor.",
		),
	).toBeVisible();
	expect(screen.queryByText("Fictional omitted paragraph") !== null).toBe(readable);
	expect(api.importResume).not.toHaveBeenCalled();
});

it.each([
	"with sources",
	"older server",
	"changed before reading",
	"changed during parse",
	"changed before Create",
	"same-account new session",
])("keeps AI import review and its request sources in the selecting account: %s", async (scenario) => {
	api.providers.mockResolvedValue([
		{ id: "fictional-provider", label: "Fictional provider", model: "fixture", enabled: true, testStatus: "success" },
	]);
	api.parsePdf.mockImplementation(async () => {
		if (scenario === "changed during parse") setAccountScope("different-owner");
		return {
			...parseResumeText("Alex Morgan\nalex@example.test"),
			...(scenario !== "older server" ? { aiOperationIds: ["actual-operation"] } : {}),
		};
	});
	mount(new File(["%PDF-test"], "resume.pdf", { type: "application/pdf" }));
	if (scenario === "changed before reading") {
		const read = await screen.findByRole("button", { name: /^Read with AI$/ });
		setAccountScope("different-owner");
		await act(async () => fireEvent.click(read));
		expect(api.parsePdf).not.toHaveBeenCalled();
		expect(api.importResume).not.toHaveBeenCalled();
		return;
	}
	fireEvent.click(await screen.findByRole("button", { name: /^Read with AI$/ }));
	if (scenario === "changed during parse") {
		await vi.waitFor(() => expect(api.parsePdf).toHaveResolved());
		expect(screen.queryByRole("heading", { name: /^What was found/ })).toBeNull();
		expect(api.importResume).not.toHaveBeenCalled();
		return;
	}
	await screen.findByRole("heading", { name: /^What was found/ });
	expect(api.importResume).not.toHaveBeenCalled();
	if (scenario === "changed before Create") setAccountScope("different-owner");
	if (scenario === "same-account new session") {
		invalidateAccountScope();
		setAccountScope("import-owner");
	}
	fireEvent.click(screen.getByRole("button", { name: "Create resume" }));
	if (scenario.includes("Create") || scenario === "same-account new session") {
		expect(api.importResume).not.toHaveBeenCalled();
	} else {
		await screen.findByRole("heading", { name: "Imported" });
		const saved = api.importResume.mock.calls[0];
		if (!saved) throw new Error("Missing reviewed import");
		const [input, options] = saved;
		expect(input.aiOperationIds).toEqual(scenario === "older server" ? [] : ["actual-operation"]);
		expect(input.data).not.toHaveProperty("aiOperationIds");
		expect(options.context.accountId).toBe("import-owner");
	}
	expect(api.parsePdf).toHaveBeenCalledTimes(1);
});

it("explains Word prerequisites before any upload and retains the file for in-place setup", async () => {
	api.providers.mockResolvedValue([]);
	mount(new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], "resume.docx"));
	await screen.findByRole("heading", { name: "Ways in without AI" });
	expect(screen.getByText("Word files and scanned PDFs are read with AI.")).toBeVisible();
	expect(screen.getByText(/not read, and not sent anywhere/)).toBeVisible();
	expect(screen.getByRole("button", { name: "Set up AI" })).toBeEnabled();
	expect(screen.queryByRole("button", { name: "Read with AI" })).toBeNull();
	expect(api.importResume).not.toHaveBeenCalled();
	expect(api.parseDocx).not.toHaveBeenCalled();
	expect(api.readPdfResume).not.toHaveBeenCalled();
});

it("keeps lookup failure recovery available on Import and retries without creating a document", async () => {
	mount();
	await screen.findByRole("alert");
	expect(screen.getByText("Couldn't load AI connections. Your saved connections haven't changed.")).toBeVisible();
	let finishLookup = () => {};
	api.providers.mockReturnValue(
		new Promise((resolve) => {
			finishLookup = () => resolve([]);
		}),
	);
	const lookupCalls = api.providers.mock.calls.length;
	fireEvent.click(screen.getByRole("button", { name: "Try again" }));
	expect(await screen.findByRole("status")).toHaveTextContent("Loading AI connections…");
	expect(api.providers.mock.calls.length).toBeGreaterThan(lookupCalls);
	await act(async () => finishLookup());
	await vi.waitFor(() => expect(screen.queryByRole("status")).toBeNull());
	expect(screen.queryByRole("alert")).toBeNull();
	expect(screen.getByRole("button", { name: "Choose a file" })).toBeEnabled();
	expect(api.importResume).not.toHaveBeenCalled();
	expect(api.createLetter).not.toHaveBeenCalled();
	expect(api.createResume).not.toHaveBeenCalled();
});

it("waits for confirmation before reading a structured file that arrived with the page", async () => {
	const file = new File([JSON.stringify({ basics: { name: "Fictional import" } })], "resume.json", {
		type: "application/json",
	});
	mount(file, true);
	await screen.findByRole("combobox", { name: "Resume language" });
	expect(api.importResume).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
	expect(api.importResume).not.toHaveBeenCalled();
});

it("uses the interface language when a PDF review resets an earlier selection", async () => {
	mount(new File(["%PDF-test"], "resume.pdf", { type: "application/pdf" }));
	fireEvent.click(await screen.findByRole("button", { name: "Read on this device" }));
	await screen.findByRole("heading", { name: /^What was found/ });
	fireEvent.click(screen.getByRole("combobox", { name: "Resume language" }));
	fireEvent.click(await screen.findByRole("option", { name: /العربية/ }));
	fireEvent.click(screen.getByRole("combobox", { name: "Resume language" }));
	fireEvent.click(await screen.findByRole("option", { name: getLanguageName("en-US") }));
	fireEvent.click(screen.getByRole("button", { name: "Create resume" }));
	await screen.findByRole("heading", { name: "Imported" });
	expect(api.importResume.mock.calls[0]?.[0].data.metadata.page.locale).toBe("en-US");
});
