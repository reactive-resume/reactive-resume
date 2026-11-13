// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { useEditorStore } from "../store";

const api = vi.hoisted(() => ({ write: vi.fn() }));
vi.mock("motion/react", () => ({ useInView: () => false }));
vi.mock("./thumbnails", () => ({ useTemplateThumbnail: () => ({ data: undefined }) }));
vi.mock("@/features/resume/builder/undo-toast", () => ({ undoToast: vi.fn() }));
vi.mock("@/features/resume/builder/draft", () => ({
	useResumeData: () => defaultResumeData,
	useResumeStore: Object.assign((select: (state: unknown) => unknown) => select({ resume: { id: "fixture" } }), {
		getState: () => ({ updateResumeData: api.write }),
	}),
	useUpdateResumeData: () => api.write,
}));
import { TemplateGroup } from "./template-group";

beforeEach(() => {
	i18n.loadAndActivate({ locale: "en", messages: {} });
	api.write.mockReset();
	useEditorStore.setState({ previewTemplate: null });
});
afterEach(cleanup);
const mount = () =>
	render(
		<I18nProvider i18n={i18n}>
			<TemplateGroup />
		</I18nProvider>,
	);

it("previews a chosen template without saving, keeps the original on Escape, and commits only with Use", () => {
	const view = mount();
	fireEvent.click(screen.getByRole("button", { name: "Preview Ditto" }));
	expect(useEditorStore.getState().previewTemplate).toBe("ditto");
	expect(api.write).not.toHaveBeenCalled();
	fireEvent.keyDown(screen.getByRole("group", { name: "Template preview" }), { key: "Escape" });
	expect(useEditorStore.getState().previewTemplate).toBeNull();
	expect(api.write).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole("button", { name: "Preview Ditto" }));
	fireEvent.click(screen.getByRole("button", { name: "Use this template" }));
	const data = structuredClone(defaultResumeData);
	api.write.mock.calls[0]?.[0](data);
	expect(data.metadata.template).toBe("ditto");
	expect(data.metadata.typography).toEqual(defaultResumeData.metadata.typography);
	expect(data.metadata.layout).toEqual(defaultResumeData.metadata.layout);
	expect(api.write.mock.calls[0]?.[1]).toEqual({ newStep: true });
	expect(useEditorStore.getState().previewTemplate).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Preview Ditto" }));
	view.unmount();
	expect(useEditorStore.getState().previewTemplate).toBeNull();
});

it("filters by style tags as well as template names", () => {
	mount();
	fireEvent.change(screen.getByRole("searchbox", { name: "Filter templates" }), { target: { value: "Finance" } });
	expect(screen.getByRole("button", { name: "Preview Persian" })).toBeTruthy();
	expect(screen.queryByRole("button", { name: "Preview Onyx" })).toBeNull();
});
