// @vitest-environment happy-dom
import type { CoverLetter } from "@reactive-resume/schema/cover-letter/data";
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { ORPCError } from "@orpc/client";
import { copyCoverLetterStyle } from "@reactive-resume/resume/cover-letter";
import { coverLetterDocumentSchema } from "@reactive-resume/schema/cover-letter/data";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";

const mocks = vi.hoisted(() => ({
	update: vi.fn(),
	import: vi.fn(),
	getById: vi.fn(),
	invalidate: vi.fn(),
	toast: vi.fn(),
}));
vi.mock("@/libs/orpc/client", () => ({
	client: { coverLetters: mocks },
	streamClient: {},
	orpc: { documents: { key: () => ["documents"] } },
}));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: mocks.invalidate }) }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: mocks.toast } }));
vi.mock("@reactive-resume/ui/hooks/use-breakpoint", () => ({ useBreakpoint: () => "wide" }));
vi.mock("@/features/letters/export", () => ({ createLetterFile: vi.fn(), letterFileName: vi.fn() }));
vi.mock("@/features/resume/editor/store", () => ({ useEditorStore: () => vi.fn() }));
vi.mock("@/features/resume/editor/chrome", () => ({
	DocumentMenuTrigger: () => <button type="button">Letter menu</button>,
}));
vi.mock("@/features/resume/editor/chrome/bar", () => ({
	EditorBarFrame: ({ menu }: { menu: ReactNode }) => <>{menu}</>,
	DownloadButtons: () => null,
}));
const { useLetterEditorStore } = await import("./store");
const { LetterBar } = await import("@/routes/builder/letter/-components/letter-bar");
const { ConfirmDialogProvider } = await import("@/hooks/use-confirm");
const store = () => useLetterEditorStore.getState();
const letter: CoverLetter = {
	id: "letter",
	name: "Letter",
	recipient: "<p>Hiring team</p>",
	content: "<p>Saved</p>",
	greeting: "Hello,",
	signOff: "Regards,",
	style: copyCoverLetterStyle(defaultResumeData),
	layout: "structured",
	recipientName: "Rowan",
	recipientCompany: "Example",
	letterDate: "2026-10-31",
	sourceResumeId: "resume",
	sourceApplicationId: "application",
	senderLinked: true,
	designLinked: true,
	isLocked: false,
	revision: 1,
	createdAt: new Date(),
	updatedAt: new Date(),
};
const remote = { ...letter, content: "<p>Saved elsewhere</p>", revision: 2 };
const copy = { ...letter, id: "copy", name: "Letter (mine)", content: "<p>Unsaved</p>" };
const recovery = () => Object.fromEntries(Object.entries(window.localStorage));

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((accept) => {
		resolve = accept;
	});
	return { promise, resolve };
}

beforeEach(async () => {
	vi.useFakeTimers();
	vi.resetAllMocks();
	store().reset();
	window.localStorage.clear();
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
	store().load(letter);
	mocks.update.mockRejectedValue(new ORPCError("CONFLICT"));
	mocks.import.mockResolvedValue(copy);
	mocks.getById.mockResolvedValue(remote);
	store().edit({ content: copy.content }, { applied: [{ id: "receipt", after: copy.content }] });
	await store().flush();
});
afterEach(() => {
	cleanup();
	store().reset();
	window.localStorage.clear();
	vi.useRealTimers();
});

it("requires confirmation before copy-and-reload, supports cancel, and disables repeat clicks", async () => {
	vi.useRealTimers();
	render(
		<I18nProvider i18n={i18n}>
			<ConfirmDialogProvider>
				<LetterBar layout="desktop" pinnable={false} />
			</ConfirmDialogProvider>
		</I18nProvider>,
	);
	await act(async () => fireEvent.click(screen.getByRole("button", { name: "Reload" })));
	expect(screen.getByRole("alertdialog")).toHaveTextContent("Your edits will be kept as a separate letter");
	expect(screen.getByRole("button", { name: "Reload" })).toBeDisabled();
	expect(mocks.import).not.toHaveBeenCalled();
	await act(async () => fireEvent.click(screen.getByRole("button", { name: "Cancel" })));
	expect(mocks.getById).not.toHaveBeenCalled();
	expect(store().letter?.content).toBe(copy.content);
	await act(async () => fireEvent.click(screen.getByRole("button", { name: "Reload" })));
	await act(async () => fireEvent.click(screen.getByRole("button", { name: "Keep a copy and reload" })));
	expect(store().letter).toEqual(remote);
	expect(mocks.import).toHaveBeenCalledTimes(1);
	expect(mocks.toast).toHaveBeenCalledWith(
		expect.objectContaining({ description: "Your edits were kept as “Letter (mine)”." }),
	);
});

it("ignores confirmation after navigating to a different editing visit", async () => {
	vi.useRealTimers();
	render(
		<I18nProvider i18n={i18n}>
			<ConfirmDialogProvider>
				<LetterBar layout="desktop" pinnable={false} />
			</ConfirmDialogProvider>
		</I18nProvider>,
	);
	await act(async () => fireEvent.click(screen.getByRole("button", { name: "Reload" })));
	act(() => store().load({ ...letter, id: "other" }));
	await act(async () => fireEvent.click(screen.getByRole("button", { name: "Keep a copy and reload" })));
	expect(mocks.import).not.toHaveBeenCalled();
	expect(mocks.getById).not.toHaveBeenCalled();
	expect(store().letter?.id).toBe("other");
});

it("imports the whole unsaved letter before loading saved state, without copying receipts or links", async () => {
	const importing = deferred<CoverLetter>();
	mocks.import.mockReturnValue(importing.promise);
	const mine = store().letter;
	const reloading = store().reloadFromServer();
	expect(store().changing).toBe(true);
	expect(mocks.getById).not.toHaveBeenCalled();
	expect(store().letter).toBe(mine);
	expect(Object.keys(recovery())).not.toHaveLength(0);
	const document = mocks.import.mock.calls[0]?.[0].document;
	expect(document).toEqual(
		coverLetterDocumentSchema.parse({ ...mine, name: copy.name, format: "reactive-resume-cover-letter", version: 1 }),
	);
	expect(document).not.toHaveProperty("proposalApplications");
	expect(document).not.toHaveProperty("sourceResumeId");
	importing.resolve(copy);
	expect(await reloading).toEqual(copy);
	expect(store().letter).toEqual(remote);
	expect(store().pending).toEqual({});
	expect(store().pendingProposalApplications).toEqual({});
	expect(store().proposalApplications).toEqual({});
	expect(recovery()).toEqual({});
	store().reset();
	store().load(remote);
	expect(store().letter).toEqual(remote);
});

it.each(["import", "getById"] as const)(
	"keeps draft and recovery when %s fails; a read retry reuses the copy",
	async (operation) => {
		const before = recovery();
		mocks[operation].mockRejectedValueOnce(new Error("offline"));
		await expect(store().reloadFromServer()).rejects.toThrow("offline");
		expect(store().letter?.content).toBe(copy.content);
		expect(store().pendingProposalApplications).toEqual({ receipt: copy.content });
		expect(store().changing).toBe(false);
		expect(recovery()).toEqual(before);
		if (operation === "import") expect(mocks.getById).not.toHaveBeenCalled();
		expect(await store().reloadFromServer()).toEqual(copy);
		expect(mocks.import).toHaveBeenCalledTimes(operation === "import" ? 2 : 1);
	},
);

it.each(["import", "getById"] as const)("doesn't replace text typed while %s is pending", async (operation) => {
	const request = deferred<CoverLetter>();
	mocks[operation].mockReturnValueOnce(request.promise);
	const reloading = store().reloadFromServer();
	await Promise.resolve();
	store().edit({ content: "<p>More typing</p>" });
	const before = recovery();
	const rejected = expect(reloading).rejects.toThrow("changed while");
	request.resolve(operation === "import" ? copy : remote);
	await rejected;
	expect(store().letter?.content).toBe("<p>More typing</p>");
	expect(store().status).toBe("conflict");
	expect(recovery()).toEqual(before);
	expect(store().changing).toBe(false);
});

it.each(["another letter", "same letter reopened"])("doesn't replace a new session: %s", async (destination) => {
	const request = deferred<CoverLetter>();
	mocks.getById.mockReturnValueOnce(request.promise);
	const reloading = store().reloadFromServer();
	await Promise.resolve();
	store().reset();
	store().load(destination === "another letter" ? { ...letter, id: "other" } : letter);
	const session = store().sessionId;
	const current = store().letter;
	const before = recovery();
	request.resolve(remote);
	expect(await reloading).toBeNull();
	expect(store().sessionId).toBe(session);
	expect(store().letter).toBe(current);
	expect(recovery()).toEqual(before);
});

it("blocks duplicate recovery actions while copying", async () => {
	const request = deferred<CoverLetter>();
	mocks.import.mockReturnValueOnce(request.promise);
	const first = store().reloadFromServer();
	expect(await store().reloadFromServer()).toBeNull();
	expect(mocks.import).toHaveBeenCalledTimes(1);
	request.resolve(copy);
	await first;
});

it("preserves another tab's recovery and removes only the restored old draft after copying", async () => {
	store().reset();
	window.localStorage.clear();
	const key = "reactive-resume:unsaved:letter:letter:older";
	window.localStorage.setItem(
		key,
		JSON.stringify({ letter, pending: { content: copy.content }, storedAt: Date.now() }),
	);
	store().load(remote);
	expect(store().proposalSafety).toBeUndefined();
	const otherKey = "reactive-resume:unsaved:letter:letter:other-tab";
	window.localStorage.setItem(otherKey, "independent recovery");
	mocks.update.mockClear();
	await store().reloadFromServer();
	expect(window.localStorage.getItem(key)).toBeNull();
	expect(window.localStorage.getItem(otherKey)).toBe("independent recovery");
	expect(mocks.update).not.toHaveBeenCalled();
	expect(store().proposalSafety).toBe("v1");
});
