// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
const generate = vi.hoisted(() => vi.fn());
vi.mock("@/libs/auth/client", () => ({ authClient: { twoFactor: { generateBackupCodes: generate } } }));
import { BackupCodesRow } from "./backup-codes";
afterEach(cleanup);
it("clears and focuses a rejected password, then allows retry without closing", async () => {
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
	generate
		.mockResolvedValueOnce({ error: { code: "INVALID_PASSWORD" } })
		.mockResolvedValueOnce({ data: { backupCodes: ["new-code"] } });
	render(
		<I18nProvider i18n={i18n}>
			<BackupCodesRow />
		</I18nProvider>,
	);
	fireEvent.click(screen.getByRole("button", { name: "New codes" }));
	const password = screen.getByLabelText("Password");
	fireEvent.change(password, { target: { value: "wrong-password" } });
	fireEvent.click(screen.getByRole("button", { name: "Generate new codes" }));
	await screen.findByRole("alert");
	expect(password).toHaveValue("");
	expect(password).toHaveAccessibleDescription("That password isn't right. Try again or reset it.");
	expect(password).toHaveFocus();
	expect(screen.getByRole("button", { name: "Generate new codes" })).toBeDisabled();
	fireEvent.change(password, { target: { value: "correct-password" } });
	fireEvent.click(screen.getByRole("button", { name: "Generate new codes" }));
	await waitFor(() => expect(screen.getByText("new-code")).toBeVisible());
	expect(generate).toHaveBeenNthCalledWith(2, { password: "correct-password" });
});
