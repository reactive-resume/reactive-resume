import { render, screen } from "@testing-library/react";
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
