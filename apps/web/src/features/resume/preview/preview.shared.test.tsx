// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { expect, it } from "vite-plus/test";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { ResumePreviewLoader } from "./preview.shared";

it("holds Letter paper at its physical aspect ratio before the PDF loads", () => {
	const data = structuredClone(defaultResumeData);
	data.metadata.page.format = "letter";
	render(<ResumePreviewLoader data={data} pageScale={0.5} />);
	const page = screen.getByRole("img", { name: "Loading resume page 1 of 1" });
	expect(page).toHaveStyle({ width: "306px", height: "396px" });
});
