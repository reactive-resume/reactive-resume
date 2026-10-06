// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { Dialog } from "@reactive-resume/ui/components/dialog";

const mocks = vi.hoisted(() => ({ changePassword: vi.fn(), close: vi.fn() }));
vi.mock("@/libs/auth/client", () => ({
	authClient: { changePassword: mocks.changePassword },
}));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn(async () => {}) }) }));
vi.mock("@/hooks/use-form-blocker", () => ({ useFormBlocker: () => ({ requestClose: mocks.close }) }));
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: vi.fn(), close: vi.fn() } }));
vi.mock("../store", () => ({
	useDialogStore: (select: (state: unknown) => unknown) => select({ closeDialog: mocks.close }),
}));

import { ChangePasswordDialog } from "./change-password";

beforeEach(() => {
	vi.clearAllMocks();
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
	mocks.changePassword.mockResolvedValue({ error: null });
});
afterEach(cleanup);

it("sends revokeOtherSessions: true when user checks the option", async () => {
	render(
		<I18nProvider i18n={i18n}>
			<Dialog open>
				<ChangePasswordDialog />
			</Dialog>
		</I18nProvider>,
	);

	fireEvent.change(screen.getByLabelText("Current Password"), { target: { value: "oldPassword123" } });
	fireEvent.change(screen.getByLabelText("New Password"), { target: { value: "newPassword456" } });
	fireEvent.click(screen.getByRole("checkbox", { name: "Sign out from all other devices" }));
	fireEvent.click(screen.getByRole("button", { name: "Update Password" }));

	await waitFor(() => {
		expect(mocks.changePassword).toHaveBeenCalledWith({
			currentPassword: "oldPassword123",
			newPassword: "newPassword456",
			revokeOtherSessions: true,
		});
	});
	expect(mocks.close).toHaveBeenCalled();
});

it("sends revokeOtherSessions: false by default when not checked", async () => {
	render(
		<I18nProvider i18n={i18n}>
			<Dialog open>
				<ChangePasswordDialog />
			</Dialog>
		</I18nProvider>,
	);

	fireEvent.change(screen.getByLabelText("Current Password"), { target: { value: "oldPassword123" } });
	fireEvent.change(screen.getByLabelText("New Password"), { target: { value: "newPassword456" } });
	fireEvent.click(screen.getByRole("button", { name: "Update Password" }));

	await waitFor(() => {
		expect(mocks.changePassword).toHaveBeenCalledWith({
			currentPassword: "oldPassword123",
			newPassword: "newPassword456",
			revokeOtherSessions: false,
		});
	});
	expect(mocks.close).toHaveBeenCalled();
});
