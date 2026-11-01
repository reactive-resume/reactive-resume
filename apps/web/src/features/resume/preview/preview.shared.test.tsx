// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { expect, it } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { ResumePreviewLoader } from "./preview.shared";

it("holds Letter paper at its physical aspect ratio before the PDF loads", () => {
	const data = structuredClone(defaultResumeData);
	data.metadata.page.format = "letter";
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
	render(
		<I18nProvider i18n={i18n}>
			<ResumePreviewLoader data={data} pageScale={0.5} />
		</I18nProvider>,
	);
	const page = screen.getByRole("img", { name: "Loading resume page 1 of 1" });
	expect(page).toHaveStyle({ width: "306px", height: "396px" });
});
