import type { CustomField } from "@reactive-resume/schema/resume/data";
// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { useState } from "react";
import { CustomFields } from "./basics-card";

vi.mock("./picture-settings", () => ({ PictureSettings: () => null }));
vi.mock("./section-view", () => ({ SectionsCrumb: () => null }));
vi.mock("@/components/input/icon-picker", () => ({ IconPicker: () => null }));

it("edits a custom field link inline and returns focus on Escape without losing the address", () => {
	i18n.load("en", {});
	i18n.activate("en");
	function Fixture() {
		const [fields, setFields] = useState<CustomField[]>([
			{ id: "contact", icon: "link", text: "Portfolio", link: "https://example.test" },
		]);
		return (
			<CustomFields
				fields={fields}
				locked={false}
				edit={(_key, mutate) =>
					setFields((current) => {
						const next = structuredClone(current);
						mutate(next);
						return next;
					})
				}
			/>
		);
	}
	render(
		<I18nProvider i18n={i18n}>
			<Fixture />
		</I18nProvider>,
	);
	const trigger = screen.getByRole("button", { name: "Edit link" });
	fireEvent.click(trigger);
	const address = screen.getByRole("textbox", { name: "Link address" });
	expect(address).toHaveFocus();
	expect(trigger).toHaveAttribute("aria-expanded", "true");
	fireEvent.change(address, { target: { value: "https://example.test/work" } });
	fireEvent.keyDown(address, { key: "Escape" });
	expect(screen.queryByRole("textbox", { name: "Link address" })).toBeNull();
	expect(trigger).toHaveFocus();
	fireEvent.click(trigger);
	expect(screen.getByRole("textbox", { name: "Link address" })).toHaveValue("https://example.test/work");
});
