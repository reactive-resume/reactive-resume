import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vite-plus/test";
// @vitest-environment happy-dom
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { Combobox } from "./combobox";

it("keeps the caller's accessible name and description on the keyboard trigger", async () => {
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
	render(
		<I18nProvider i18n={i18n}>
			<p id="language-help">Interface only</p>
			<Combobox
				aria-label="Interface language"
				aria-describedby="language-help"
				defaultValue="en"
				options={[
					{ value: "en", label: "English" },
					{ value: "de", label: "Deutsch" },
				]}
			/>
		</I18nProvider>,
	);
	const trigger = screen.getByLabelText("Interface language");
	expect(trigger).toHaveAccessibleName("Interface language");
	expect(trigger).toHaveAccessibleDescription("Interface only");
	const user = userEvent.setup();
	await user.click(trigger);
	expect(await screen.findByRole("option", { name: "Deutsch" })).toBeVisible();
	await user.keyboard("{Escape}");
	expect(trigger).toHaveFocus();
});

it("closes and returns focus when its footer action is chosen", async () => {
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
	render(
		<I18nProvider i18n={i18n}>
			<Combobox
				aria-label="Timezone"
				options={[{ value: "Europe/Lisbon", label: "Europe/Lisbon" }]}
				footer={<button type="button">Use device timezone</button>}
			/>
		</I18nProvider>,
	);
	const user = userEvent.setup();
	const trigger = screen.getByLabelText("Timezone");
	await user.click(trigger);
	await user.click(await screen.findByRole("button", { name: "Use device timezone" }));
	await waitFor(() => expect(screen.queryByRole("option")).toBeNull());
	expect(trigger).toHaveFocus();
});
