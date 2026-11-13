// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
vi.mock("@/features/resume/builder/draft", () => ({
	useResumeData: () => undefined,
	useUpdateResumeData: () => vi.fn(),
}));
import { ColorGroup, DesignSourceProvider } from "./style-groups";
afterEach(cleanup);
it("checks the printed contrast of transparent accents and leaves opaque presets unselected", () => {
	i18n.loadAndActivate({ locale: "en", messages: {} });
	const metadata = structuredClone(defaultResumeData.metadata);
	metadata.design.colors.primary = "rgba(47, 90, 138, 0.2)";
	render(
		<I18nProvider i18n={i18n}>
			<DesignSourceProvider value={{ metadata, write: vi.fn() }}>
				<ColorGroup />
			</DesignSourceProvider>
		</I18nProvider>,
	);
	expect(screen.getByText(/Too light for headings on white/)).toBeTruthy();
	const preset = screen.getByRole("radio", { name: "Ink blue" });
	expect(preset.getAttribute("aria-checked")).toBe("false");
	expect(preset.querySelector("[data-slot=icon]")).toBeNull();
});
