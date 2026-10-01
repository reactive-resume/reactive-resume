// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEditorStore } from "../editor/store";
import { HistoryTab } from "./history-tab";

const mocks = vi.hoisted(() => ({
	save: vi.fn(),
	create: vi.fn(),
	restore: vi.fn(),
	replace: vi.fn(),
	toast: vi.fn(),
}));
vi.mock("@/features/resume/builder/draft", () => ({
	savePendingChanges: mocks.save,
	useCurrentResume: () => ({ id: "resume", isLocked: false }),
	useResumeStore: { getState: () => ({ replaceResumeFromServer: mocks.replace }) },
}));
vi.mock("@/hooks/use-confirm", () => ({ useConfirm: () => vi.fn(), usePrompt: () => vi.fn() }));
vi.mock("@/libs/error-message", () => ({ getResumeErrorMessage: (error: Error) => error.message }));
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: mocks.toast } }));
vi.mock("@/libs/orpc/client", () => ({
	orpc: {
		resume: {
			listVersions: {
				queryKey: () => ["versions"],
				queryOptions: () => ({
					queryKey: ["versions"],
					queryFn: async () => [{ id: "version", kind: "named", name: "Checkpoint", createdAt: new Date() }],
				}),
			},
			getById: { queryKey: () => ["resume"] },
			createVersion: { call: mocks.create },
			restoreVersion: { call: mocks.restore },
		},
	},
}));

beforeEach(() => {
	vi.clearAllMocks();
	mocks.save.mockResolvedValue(false);
	useEditorStore.getState().reset();
	i18n.load("en", {});
	i18n.activate("en");
});

it.each(["name", "restore"])("stops History %s after the save barrier fails", async (action) => {
	if (action === "restore") useEditorStore.getState().setHistoryVersion("version");
	const client = new QueryClient();
	render(
		<QueryClientProvider client={client}>
			<I18nProvider i18n={i18n}>
				<HistoryTab />
			</I18nProvider>
		</QueryClientProvider>,
	);
	if (action === "name") {
		fireEvent.change(screen.getByRole("textbox", { name: "Name this version" }), {
			target: { value: "Unsaved draft" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
	} else fireEvent.click(await screen.findByRole("button", { name: "Restore this version" }));
	await waitFor(() =>
		expect(mocks.toast).toHaveBeenCalledWith({
			type: "error",
			description: "Couldn't save your changes. Try again before continuing.",
		}),
	);
	expect(mocks.save).toHaveBeenCalledWith("resume");
	expect(mocks.create).not.toHaveBeenCalled();
	expect(mocks.restore).not.toHaveBeenCalled();
	expect(mocks.replace).not.toHaveBeenCalled();
	if (action === "name")
		expect((screen.getByRole("textbox", { name: "Name this version" }) as HTMLInputElement).value).toBe(
			"Unsaved draft",
		);
	else expect(useEditorStore.getState().historyVersionId).toBe("version");
	client.clear();
});
