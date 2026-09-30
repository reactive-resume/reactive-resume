// @vitest-environment happy-dom

import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";

const mocks = vi.hoisted(() => ({
	resume: {
		id: "resume-id",
		slug: "resume",
		isPublic: true,
		isLocked: false,
		hasPassword: false,
		showDownloadButtons: true,
	},
	update: vi.fn(),
	patch: vi.fn(),
	toast: vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({ useMutation: () => ({ mutateAsync: mocks.update, isPending: false }) }));
vi.mock("@/features/resume/builder/draft", () => ({
	useCurrentResume: () => mocks.resume,
	usePatchResume: () => mocks.patch,
}));
vi.mock("@/libs/auth/client", () => ({
	authClient: { useSession: () => ({ data: { user: { username: "owner" } } }) },
}));
vi.mock("@/libs/orpc/client", () => ({
	orpc: {
		resume: {
			update: { mutationOptions: () => ({}) },
			setPassword: { mutationOptions: () => ({}) },
			removePassword: { mutationOptions: () => ({}) },
			critique: {
				setEnabled: { mutationOptions: () => ({}) },
				setPassword: { mutationOptions: () => ({}) },
			},
		},
	},
}));
vi.mock("@/hooks/use-confirm", () => ({ useConfirm: () => vi.fn() }));
vi.mock("@/hooks/use-prompt", () => ({ usePrompt: () => vi.fn() }));
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: mocks.toast } }));
vi.mock("../shared/section-base", () => ({
	SectionBase: ({ children }: { children: ReactNode }) => <section>{children}</section>,
}));

const { SharingSectionBuilder } = await import("./sharing");

beforeAll(() => i18n.loadAndActivate({ locale: "en", messages: {} }));
beforeEach(() => {
	vi.clearAllMocks();
	mocks.resume = {
		id: "resume-id",
		slug: "resume",
		isPublic: true,
		isLocked: false,
		hasPassword: false,
		showDownloadButtons: true,
	};
	mocks.update.mockResolvedValue({ ...mocks.resume, showDownloadButtons: false });
	mocks.patch.mockImplementation((update: (draft: typeof mocks.resume) => void) => update(mocks.resume));
});

const renderSharing = () =>
	render(
		<I18nProvider i18n={i18n}>
			<SharingSectionBuilder />
		</I18nProvider>,
	);

describe("sharing download preference", () => {
	it("saves the per-resume preference when its switch is turned off", async () => {
		renderSharing();
		const toggle = screen.getByRole("switch", { name: "Show Download Buttons" });
		expect(toggle).toBeChecked();
		fireEvent.click(toggle);
		await waitFor(() => expect(mocks.update).toHaveBeenCalledWith({ id: "resume-id", showDownloadButtons: false }));
		await waitFor(() => expect(mocks.resume.showDownloadButtons).toBe(false));
	});

	it("keeps the saved preference when persistence fails", async () => {
		mocks.update.mockRejectedValueOnce(new Error("Unavailable"));
		renderSharing();
		fireEvent.click(screen.getByRole("switch", { name: "Show Download Buttons" }));
		await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ type: "error" })));
		expect(mocks.patch).not.toHaveBeenCalled();
		expect(mocks.resume.showDownloadButtons).toBe(true);
	});

	it("disables changes while the resume is locked", () => {
		mocks.resume.isLocked = true;
		renderSharing();
		const toggle = screen.getByRole("switch", { name: "Show Download Buttons" });
		expect(toggle).toHaveAttribute("aria-disabled", "true");
		fireEvent.click(toggle);
		expect(mocks.update).not.toHaveBeenCalled();
	});
});
