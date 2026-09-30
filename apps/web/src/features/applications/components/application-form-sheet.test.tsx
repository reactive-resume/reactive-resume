// @vitest-environment happy-dom

import type { Application } from "../types";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({
	upload: vi.fn(),
	removeFile: vi.fn(),
	create: vi.fn(),
	update: vi.fn(),
	autofill: vi.fn(),
}));

vi.mock("@/libs/orpc/client", () => ({
	orpc: {
		resume: { list: { queryOptions: () => ({ queryKey: ["resume", "list"], queryFn: async () => [] }) } },
		applications: {
			list: { queryKey: () => ["applications", "list"] },
			tags: {
				queryOptions: () => ({ queryKey: ["applications", "tags"], queryFn: async () => [] }),
				queryKey: () => ["applications", "tags"],
			},
			stats: { queryKey: () => ["applications", "stats"] },
			getById: { queryKey: () => ["applications", "getById"] },
			create: { mutationOptions: (options: object) => ({ ...options, mutationFn: mocks.create }) },
			update: { mutationOptions: (options: object) => ({ ...options, mutationFn: mocks.update }) },
			ai: { autofill: { mutationOptions: (options: object) => ({ ...options, mutationFn: mocks.autofill }) } },
		},
		aiProviders: { list: { queryOptions: () => ({ queryKey: ["aiProviders"], queryFn: async () => [] }) } },
		storage: {
			uploadFile: { mutationOptions: (options: object) => ({ ...options, mutationFn: mocks.upload }) },
			deleteFile: { mutationOptions: (options: object) => ({ ...options, mutationFn: mocks.removeFile }) },
		},
	},
}));

const { ApplicationFormSheet } = await import("./application-form-sheet");

vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: vi.fn(), close: vi.fn() } }));

const OLD_URL = "https://example.com/api/uploads/user-1/pictures/old.pdf";

const NEW_KEY = "uploads/user-1/pictures/new.pdf";

const application: Application = {
	id: "app-1",
	company: "Example",
	role: "Engineer",
	location: null,
	salary: null,
	status: "saved",
	closedReason: null,
	postingSource: null,
	coverLetterId: null,
	sentResumeVersionId: null,
	sentCoverLetterVersionId: null,
	sentCheckScore: null,
	requirements: [],
	resumeId: null,
	source: null,
	sourceUrl: null,
	jobDescription: null,
	matchScore: null,
	aiMetadata: null,
	notes: null,
	resumeFileUrl: OLD_URL,
	resumeFileName: "old.pdf",
	coverLetterUrl: null,
	coverLetterName: null,
	followUpAt: null,
	followUpNote: null,
	tags: [],
	contacts: [],
	activity: [],
	appliedAt: new Date(),
	createdAt: new Date(),
	updatedAt: new Date(),
};

beforeAll(() => i18n.loadAndActivate({ locale: "en", messages: {} }));
beforeEach(() => {
	vi.resetAllMocks();
	mocks.upload.mockResolvedValue({
		url: "https://example.com/api/uploads/user-1/pictures/new.pdf",
		path: NEW_KEY,
		contentType: "application/pdf",
	});
	mocks.update.mockResolvedValue(application);
	mocks.create.mockResolvedValue(application);
	mocks.removeFile.mockResolvedValue(undefined);
});

function renderSheet(app: Application | null = application, onOpenChange = vi.fn()) {
	render(
		<QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
			<I18nProvider i18n={i18n}>
				<ApplicationFormSheet open application={app} onOpenChange={onOpenChange} />
			</I18nProvider>
		</QueryClientProvider>,
	);
	return { onOpenChange };
}

async function pickResumeFile(file: File) {
	const input = document.querySelector<HTMLInputElement>('input[type="file"]');
	if (!input) throw new Error("Missing attachment picker");
	await act(async () => fireEvent.change(input, { target: { files: [file] } }));
}

async function clickRemove() {
	await act(async () => fireEvent.click(screen.getByTitle("Remove file")));
}

const pdfFile = (name = "new.pdf") => new File(["%PDF-1.4"], name, { type: "application/pdf" });

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

it.each(["remove", "pick"])("cancelling %s leaves storage and saved application untouched", async (action) => {
	const { onOpenChange } = renderSheet();
	if (action === "remove") await clickRemove();
	else await pickResumeFile(pdfFile());
	await act(async () => fireEvent.click(screen.getByRole("button", { name: "Cancel" })));
	expect(onOpenChange).toHaveBeenCalledWith(false);
	expect(mocks.upload).not.toHaveBeenCalled();
	expect(mocks.removeFile).not.toHaveBeenCalled();
	expect(mocks.update).not.toHaveBeenCalled();
	expect(application.resumeFileUrl).toBe(OLD_URL);
});

it("saves picked files with the application in one request and blocks dismissal until it finishes", async () => {
	const write = deferred<Application>();
	mocks.update.mockReturnValue(write.promise);
	const { onOpenChange } = renderSheet();
	const file = pdfFile();
	await pickResumeFile(file);
	await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save changes" })));
	await waitFor(() =>
		expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ resumeFile: file }), expect.anything()),
	);
	await act(async () => fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" }));
	expect(onOpenChange).not.toHaveBeenCalled();
	await act(async () => write.resolve(application));
	await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
	expect(mocks.upload).not.toHaveBeenCalled();
	expect(mocks.removeFile).not.toHaveBeenCalled();
});

it("keeps a failed save editable and cancellation performs no client storage cleanup", async () => {
	mocks.update.mockRejectedValue(new Error("save failed"));
	const { onOpenChange } = renderSheet();
	await pickResumeFile(pdfFile());
	await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save changes" })));
	await waitFor(() => expect(mocks.update).toHaveBeenCalled());
	expect(onOpenChange).not.toHaveBeenCalled();
	await act(async () => fireEvent.click(screen.getByRole("button", { name: "Cancel" })));
	expect(onOpenChange).toHaveBeenCalledWith(false);
	expect(mocks.upload).not.toHaveBeenCalled();
	expect(mocks.removeFile).not.toHaveBeenCalled();
});
