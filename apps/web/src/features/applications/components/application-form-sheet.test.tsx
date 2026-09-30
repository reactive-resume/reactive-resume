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

const OLD_URL = "https://example.com/api/uploads/user-1/pictures/old.pdf";
const NEW_URL = "https://example.com/api/uploads/user-1/pictures/new.pdf";
const OLD_KEY = "uploads/user-1/pictures/old.pdf";
const NEW_KEY = "uploads/user-1/pictures/new.pdf";

const application: Application = {
	id: "app-1",
	company: "Example",
	role: "Engineer",
	location: null,
	salary: null,
	status: "saved",
	archived: false,
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
	mocks.upload.mockResolvedValue({ url: NEW_URL, path: NEW_KEY, contentType: "application/pdf" });
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
	const input = document.querySelectorAll<HTMLInputElement>('input[type="file"]')[0];
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

it("keeps the stored file and the record untouched when a removal is cancelled", async () => {
	const { onOpenChange } = renderSheet();

	await clickRemove();
	await waitFor(() => expect(screen.queryByTitle("Remove file")).not.toBeInTheDocument());
	expect(mocks.removeFile).not.toHaveBeenCalled();

	await act(async () => fireEvent.click(screen.getByRole("button", { name: "Cancel" })));
	expect(onOpenChange).toHaveBeenCalledWith(false);
	expect(mocks.removeFile).not.toHaveBeenCalled();
	expect(mocks.update).not.toHaveBeenCalled();
});

it("deletes the stored file only after the removal is saved", async () => {
	const updateRequest = deferred<Application>();
	mocks.update.mockReturnValue(updateRequest.promise);
	const { onOpenChange } = renderSheet();

	await clickRemove();
	await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save changes" })));

	await waitFor(() =>
		expect(mocks.update).toHaveBeenCalledWith(
			expect.objectContaining({ resumeFileUrl: null, resumeFileName: null }),
			expect.anything(),
		),
	);
	// The record write is still in flight — the file must not be gone yet.
	expect(mocks.removeFile).not.toHaveBeenCalled();
	expect(onOpenChange).not.toHaveBeenCalled();

	await act(async () => updateRequest.resolve(application));
	await waitFor(() => expect(mocks.removeFile).toHaveBeenCalledWith({ filename: OLD_KEY }, expect.anything()));
	expect(onOpenChange).toHaveBeenCalledWith(false);
});

it("never touches storage when a picked file is cancelled", async () => {
	const { onOpenChange } = renderSheet({ ...application, resumeFileUrl: null, resumeFileName: null });

	await pickResumeFile(pdfFile());
	await waitFor(() => expect(screen.getByText("new.pdf")).toBeInTheDocument());
	expect(mocks.upload).not.toHaveBeenCalled();

	await act(async () => fireEvent.click(screen.getByRole("button", { name: "Cancel" })));
	expect(onOpenChange).toHaveBeenCalledWith(false);
	expect(mocks.upload).not.toHaveBeenCalled();
	expect(mocks.removeFile).not.toHaveBeenCalled();
});

it("uploads a picked file on save, persists its URL, and deletes the replaced file", async () => {
	const uploadRequest = deferred<{ url: string; path: string; contentType: string }>();
	mocks.upload.mockReturnValue(uploadRequest.promise);
	const { onOpenChange } = renderSheet();

	await pickResumeFile(pdfFile());
	await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save changes" })));

	// The record write must wait for the upload to produce a URL.
	await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(1));
	expect(mocks.upload.mock.calls[0]?.[0]).toBeInstanceOf(File);
	expect(mocks.update).not.toHaveBeenCalled();

	await act(async () => uploadRequest.resolve({ url: NEW_URL, path: NEW_KEY, contentType: "application/pdf" }));
	await waitFor(() =>
		expect(mocks.update).toHaveBeenCalledWith(
			expect.objectContaining({ resumeFileUrl: NEW_URL, resumeFileName: "new.pdf" }),
			expect.anything(),
		),
	);
	await waitFor(() => expect(mocks.removeFile).toHaveBeenCalledWith({ filename: OLD_KEY }, expect.anything()));
	expect(mocks.removeFile).not.toHaveBeenCalledWith({ filename: NEW_KEY }, expect.anything());
	expect(onOpenChange).toHaveBeenCalledWith(false);
});

it("keeps the sheet open on save failure and deletes the orphaned upload on cancel", async () => {
	const updateRequest = deferred<Application>();
	mocks.update.mockReturnValue(updateRequest.promise);
	const { onOpenChange } = renderSheet({ ...application, resumeFileUrl: null, resumeFileName: null });

	await pickResumeFile(pdfFile());
	await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save changes" })));
	await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));

	await act(async () => updateRequest.reject(new Error("save failed")));
	await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
	expect(onOpenChange).not.toHaveBeenCalled();
	expect(mocks.removeFile).not.toHaveBeenCalled();

	await act(async () => fireEvent.click(screen.getByRole("button", { name: "Cancel" })));
	expect(onOpenChange).toHaveBeenCalledWith(false);
	await waitFor(() => expect(mocks.removeFile).toHaveBeenCalledWith({ filename: NEW_KEY }, expect.anything()));
});
