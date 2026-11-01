// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { createDefaultApplicationLanes } from "@reactive-resume/schema/applications/lanes";
import { CloseDialog } from "./close-dialog";

afterEach(cleanup);

const mount = (status: "offer" | "interview", onClose = vi.fn()) => {
	i18n.loadAndActivate({ locale: "en", messages: {} });
	render(
		<I18nProvider i18n={i18n}>
			<CloseDialog
				open
				status={status}
				onOpenChange={vi.fn()}
				lanes={createDefaultApplicationLanes()}
				onClose={onClose}
			/>
		</I18nProvider>,
	);
	return onClose;
};

it("closes from Offer as an accepted offer by default (J2-07)", () => {
	const onClose = mount("offer");
	expect(screen.getByRole("radio", { name: "Accepted offer" }).getAttribute("aria-checked")).toBe("true");
	fireEvent.click(screen.getByRole("button", { name: "Mark as closed" }));
	expect(onClose).toHaveBeenCalledWith(null, "accepted");
});

it("keeps Not selected as the default before Offer", () => {
	const onClose = mount("interview");
	fireEvent.click(screen.getByRole("button", { name: "Mark as closed" }));
	expect(onClose).toHaveBeenCalledWith(null, "not-selected");
});
