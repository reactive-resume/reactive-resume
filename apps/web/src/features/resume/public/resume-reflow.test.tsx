// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { i18n } from "@lingui/core";
import { referenceItemSchema } from "@reactive-resume/schema/resume/data";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { ResumeReflow } from "./resume-reflow";

it("shows the built-in Summary content in public readable view", () => {
	i18n.load("en", {});
	i18n.activate("en");
	const data = structuredClone(defaultResumeData);
	data.summary.content = "<p>Built-in summary remains visible.</p>";
	data.metadata.layout.pages = [{ fullWidth: true, main: ["summary"], sidebar: [] }];
	render(<ResumeReflow data={data} />);
	expect(screen.getByText("Built-in summary remains visible.")).toBeDefined();
});

it("includes plain custom fields and reference phone numbers", () => {
	const data = structuredClone(defaultResumeData);
	data.basics.customFields = [{ id: "authorization", icon: "", text: "Authorized to work", link: "" }];
	data.sections.references.items = [
		referenceItemSchema.parse({
			id: "ref",
			hidden: false,
			name: "Dana",
			position: "Lead",
			phone: "+49 123 456",
			description: "",
			website: { url: "", label: "" },
		}),
	];
	data.metadata.layout.pages = [{ fullWidth: true, main: ["references"], sidebar: [] }];
	render(<ResumeReflow data={data} />);
	expect(screen.getByText("Authorized to work").closest("a")).toBeNull();
	expect(screen.getByRole("link", { name: "+49 123 456" }).getAttribute("href")).toBe("tel:+49123456");
});

it.each([
	["ar", "ltr", "rtl"],
	["en-US", "rtl", "ltr"],
] as const)("sets %s document direction independently of interface direction", (locale, parent, direction) => {
	const data = structuredClone(defaultResumeData);
	data.metadata.page.locale = locale;
	const { container } = render(
		<div dir={parent}>
			<ResumeReflow data={data} />
		</div>,
	);
	expect(container.querySelector(`[lang="${locale}"]`)?.getAttribute("dir")).toBe(direction);
});
