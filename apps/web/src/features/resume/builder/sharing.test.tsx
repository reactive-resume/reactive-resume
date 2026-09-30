// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { ORPCError } from "@orpc/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PromptDialogProvider } from "@/hooks/use-prompt";
import { SharingSectionBuilder } from "@/routes/builder/$resumeId/-sidebar/right/sections/sharing";

type SectionBaseProps = { children: React.ReactNode };

const mocks = vi.hoisted(() => ({
	setPassword: vi.fn(),
	patchResume: vi.fn(),
}));

vi.mock("@/features/resume/builder/draft", () => ({
	useCurrentResume: () => ({ id: "resume-id", slug: "resume", isPublic: true, hasPassword: false }),
	usePatchResume: () => mocks.patchResume,
}));
vi.mock("@/libs/auth/client", () => ({
	authClient: { useSession: () => ({ data: { user: { username: "owner" } } }) },
}));
vi.mock("@/libs/orpc/client", () => ({
	orpc: {
		resume: {
			setPassword: { mutationOptions: () => ({ mutationFn: mocks.setPassword }) },
			update: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
			removePassword: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
			critique: {
				setEnabled: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
				setPassword: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
			},
		},
	},
}));
vi.mock("@/hooks/use-confirm", () => ({ useConfirm: () => vi.fn() }));
vi.mock("@/routes/builder/$resumeId/-sidebar/right/shared/section-base", () => ({
	SectionBase: ({ children }: SectionBaseProps) => <div>{children}</div>,
}));
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: vi.fn(), close: vi.fn() } }));

beforeAll(() => {
	i18n.loadAndActivate({ locale: "en", messages: {} });
});
beforeEach(() => {
	vi.clearAllMocks();
	mocks.setPassword.mockResolvedValue(undefined);
});
afterEach(cleanup);

async function openDialog() {
	render(
		<I18nProvider i18n={i18n}>
			<QueryClientProvider client={new QueryClient()}>
				<PromptDialogProvider>
					<SharingSectionBuilder />
				</PromptDialogProvider>
			</QueryClientProvider>
		</I18nProvider>,
	);
	await act(() => {
		fireEvent.click(screen.getByRole("button", { name: "Set Password" }));
	});
	return within(screen.queryByRole("dialog") ?? screen.getByRole("alertdialog"));
}

async function submit(dialog: ReturnType<typeof within>, password: string, confirmation = password) {
	fireEvent.change(dialog.getByLabelText("Password", { exact: true }), { target: { value: password } });
	fireEvent.change(dialog.getByLabelText("Confirm Password"), { target: { value: confirmation } });
	await act(() => {
		fireEvent.click(dialog.getByRole("button", { name: "Set Password" }));
	});
}

describe("resume password sharing", () => {
	it.each(["", "abc", "abcde", "x".repeat(65)])(
		"keeps invalid length %j open and explains the range",
		async (password) => {
			const dialog = await openDialog();
			await submit(dialog, password);
			expect(mocks.setPassword).not.toHaveBeenCalled();
			expect(dialog.getByRole("alert").textContent).toContain("6 and 64");
		},
	);

	it("requires matching confirmation", async () => {
		const dialog = await openDialog();
		await submit(dialog, "secret", "typooo");
		expect(mocks.setPassword).not.toHaveBeenCalled();
		expect(dialog.getByRole("alert").textContent).toContain("match");
	});

	it.each(["secret", "x".repeat(64)])("saves valid length and closes only after success", async (password) => {
		const dialog = await openDialog();
		await submit(dialog, password);
		expect(mocks.setPassword).toHaveBeenCalledWith({ id: "resume-id", password }, expect.anything());
		expect(mocks.patchResume).toHaveBeenCalledOnce();
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("preserves values and reports a server failure for retry", async () => {
		mocks.setPassword.mockRejectedValueOnce(
			new ORPCError("INTERNAL_SERVER_ERROR", { message: "Could not save password" }),
		);
		const dialog = await openDialog();
		await submit(dialog, "secret");
		expect(dialog.getByRole("alert").textContent).toBe("Could not save password");
		expect((dialog.getByLabelText("Password", { exact: true }) as HTMLInputElement).value).toBe("secret");
		expect(mocks.patchResume).not.toHaveBeenCalled();
		await act(() => {
			fireEvent.click(dialog.getByRole("button", { name: "Set Password" }));
		});
		expect(mocks.setPassword).toHaveBeenCalledTimes(2);
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("keeps the dialog open and prevents duplicate submission while saving", async () => {
		let resolveSave!: () => void;
		mocks.setPassword.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					resolveSave = resolve;
				}),
		);
		const dialog = await openDialog();
		await submit(dialog, "secret");
		expect(screen.getByRole("dialog")).toBeTruthy();
		expect((dialog.getByRole("button", { name: "Set Password" }) as HTMLButtonElement).disabled).toBe(true);
		const form = dialog.getByLabelText("Password", { exact: true }).closest("form");
		if (!form) throw new Error("Missing password form");
		await act(() => {
			fireEvent.submit(form);
		});
		expect(mocks.setPassword).toHaveBeenCalledOnce();
		expect(mocks.patchResume).not.toHaveBeenCalled();
		await act(() => {
			resolveSave();
		});
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("validates form submission used by Enter", async () => {
		const dialog = await openDialog();
		fireEvent.change(dialog.getByLabelText("Password", { exact: true }), { target: { value: "abc" } });
		const form = dialog.getByLabelText("Password", { exact: true }).closest("form");
		if (!form) throw new Error("Missing password form");
		await act(() => {
			fireEvent.submit(form);
		});
		expect(mocks.setPassword).not.toHaveBeenCalled();
		expect(dialog.getByRole("alert").textContent).toContain("6 and 64");
	});

	it("clears passwords after cancel and reopen", async () => {
		const dialog = await openDialog();
		fireEvent.change(dialog.getByLabelText("Password", { exact: true }), { target: { value: "secret" } });
		await act(() => {
			fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));
		});
		await act(() => {
			fireEvent.click(screen.getByRole("button", { name: "Set Password" }));
		});
		expect((screen.getByLabelText("Password", { exact: true }) as HTMLInputElement).value).toBe("");
		expect(mocks.setPassword).not.toHaveBeenCalled();
	});
});
