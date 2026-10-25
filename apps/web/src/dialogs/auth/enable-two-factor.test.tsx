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

it("shows recoverable backup codes before the TOTP verification that activates two-factor authentication", async () => {
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
	await waitFor(() => expect(screen.getByText("82cNK-qaOiN")).toBeDefined());
	expect(mocks.verify).not.toHaveBeenCalled();
	expect(mocks.close).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole("button", { name: "Continue" }));
	await waitFor(() => expect(screen.getByText(/6-digit code/)).toBeDefined());
	expect(mocks.verify).not.toHaveBeenCalled();
});
