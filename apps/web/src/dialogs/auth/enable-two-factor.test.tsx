// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { Dialog } from "@reactive-resume/ui/components/dialog";

const mocks = vi.hoisted(() => ({ enable: vi.fn(), verify: vi.fn(), close: vi.fn() }));
vi.mock("@/libs/auth/client", () => ({
	authClient: { twoFactor: { enable: mocks.enable, verifyTotp: mocks.verify } },
}));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn(async () => {}) }) }));
vi.mock("@tanstack/react-router", () => ({ useRouter: () => ({ invalidate: vi.fn() }) }));
vi.mock("@/hooks/use-form-blocker", () => ({ useFormBlocker: () => ({ requestClose: mocks.close }) }));
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: vi.fn(), close: vi.fn() } }));
vi.mock("../store", () => ({
	useDialogStore: (select: (state: unknown) => unknown) => select({ closeDialog: mocks.close }),
}));

import { EnableTwoFactorDialog } from "./enable-two-factor";

beforeEach(() => {
	vi.clearAllMocks();
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
	mocks.enable.mockResolvedValue({
		data: { method: "totp", totpURI: "otpauth://totp/Resume?secret=ABC", backupCodes: ["82cNK-qaOiN"] },
		error: null,
	});
});
afterEach(cleanup);

it("verifies the authenticator before showing backup codes and waits for Done before closing", async () => {
	render(
		<I18nProvider i18n={i18n}>
			<Dialog open>
				<EnableTwoFactorDialog />
			</Dialog>
		</I18nProvider>,
	);
	const password = screen.getByLabelText("Password");
	fireEvent.change(password, { target: { value: "password123" } });
	fireEvent.click(screen.getByRole("button", { name: "Continue" }));
	await screen.findByText("Step 2 of 3");
	expect(screen.queryByText("82cNK-qaOiN")).toBeNull();
	expect(mocks.close).not.toHaveBeenCalled();
	expect(mocks.verify).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole("button", { name: "Continue" }));
	expect(await screen.findByText("Enter the 6-digit code.")).toBeTruthy();
	expect(mocks.verify).not.toHaveBeenCalled();
	mocks.verify.mockResolvedValueOnce({ error: { message: "Invalid code" } });

	const enterCode = async () => {
		for (let digit = 1; digit <= 6; digit++) {
			fireEvent.change(
				await screen.findByRole("textbox", { name: digit === 1 ? "Verification code" : `Digit ${digit} of 6` }),
				{ target: { value: String(digit) } },
			);
		}
	};
	await enterCode();
	fireEvent.click(screen.getByRole("button", { name: "Continue" }));
	await waitFor(() => expect(mocks.verify).toHaveBeenCalledExactlyOnceWith({ code: "123456" }));
	await waitFor(() => expect(screen.getByRole("textbox", { name: "Verification code" })).toHaveValue(""));
	expect(screen.queryByText("82cNK-qaOiN")).toBeNull();
	mocks.verify.mockResolvedValue({ error: null });
	await enterCode();
	fireEvent.click(screen.getByRole("button", { name: "Continue" }));
	await screen.findByText("82cNK-qaOiN");
	expect(screen.getByText("Step 3 of 3")).toBeDefined();
	expect(mocks.close).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole("button", { name: "Done" }));
	expect(mocks.close).toHaveBeenCalledOnce();
});
