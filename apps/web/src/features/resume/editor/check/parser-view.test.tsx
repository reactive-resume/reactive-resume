// @vitest-environment happy-dom
import { act, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEditorStore } from "../store";
import { ParserView } from "./parser-view";

const mocks = vi.hoisted(() => ({ resumeId: "A", extract: vi.fn(async (file: File) => file.text()) }));
vi.mock("@/features/resume/builder/draft", () => ({
	useCurrentBuilderResumeSelector: (select: (resume: { id: string }) => unknown) => select({ id: mocks.resumeId }),
}));
vi.mock("./use-check", () => ({ useCheck: () => null }));
vi.mock("@/features/ats-checker/extract-client", () => ({ extractPdf: mocks.extract }));
vi.mock("@reactive-resume/resume/ats-pdf", () => ({
	buildExtractedDocument: (text: string) => ({ pages: [], lines: [{ text }], charCount: text.length }),
	buildResumeSemantics: () => ({
		contact: { nameLine: "", locationLine: "", emails: [], phones: [], textUrls: [], annotationUrls: [] },
		dates: [],
		headings: [],
	}),
}));

it("extracts each document and each reopened render independently", async () => {
	i18n.load("en", {});
	i18n.activate("en");
	const client = new QueryClient();
	const open = (id: string, text: string) => {
		mocks.resumeId = id;
		useEditorStore.getState().reset();
		useEditorStore.getState().setRendered({ pageCount: 1, pageMap: undefined, file: new Blob([text]) });
	};
	const ui = (
		<QueryClientProvider client={client}>
			<I18nProvider i18n={i18n}>
				<ParserView />
			</I18nProvider>
		</QueryClientProvider>
	);
	open("A", "Resume Alpha");
	const view = render(ui);
	await screen.findByText("Resume Alpha");
	view.unmount();
	open("B", "Resume Beta");
	const second = render(ui);
	await screen.findByText("Resume Beta");
	expect(screen.queryByText("Resume Alpha")).toBeNull();
	second.unmount();
	open("A", "Changed Alpha");
	render(ui);
	await screen.findByText("Changed Alpha");
	expect(mocks.extract).toHaveBeenCalledTimes(3);
	await act(async () => {
		client.clear();
	});
});
