import { beforeEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { I18nProvider } from "@lingui/react";
import { renderToStaticMarkup } from "react-dom/server";
import { ACCENTS, FONT_PAIRINGS } from "../editor/design/presets";
import { PdfCanvasPage } from "./pdf-canvas";
import { ResumePreviewLoader } from "./preview.shared";
import { FindingRow } from "@/features/ats-checker/report/finding-row";

vi.mock("./pdfjs", () => ({
	AnnotationMode: {},
	getDocument: vi.fn(),
	getPdfWorker: vi.fn(),
	RenderingCancelledException: Error,
}));
beforeEach(() => {
	i18n.loadAndActivate({ locale: "de-DE", messages: {} });
});

it("defers all five pairing and eight accent labels to Lingui", () => {
	const labels = [...FONT_PAIRINGS, ...ACCENTS].map(({ label }) => label);
	expect(labels).toHaveLength(13);
	for (const [index, label] of labels.entries()) {
		expect(label).toHaveProperty("id");
		i18n.load("de-DE", { [label.id]: `Übersetzung ${index}` });
		expect(i18n._(label)).toBe(`Übersetzung ${index}`);
	}
});

it("translates loading and rendered page names and fallback captions", () => {
	const pageNumber = 1;
	const pageCount = 3;
	const totalPages = 3;
	i18n.load("de-DE", {
		[msg`Page ${pageNumber} of ${pageCount}`.id]: "Seite {pageNumber} von {pageCount}",
		[msg`Page ${pageNumber} of ${totalPages}`.id]: "Seite {pageNumber} von {totalPages}",
		[msg`Loading resume page ${pageNumber} of ${pageCount}`.id]:
			"Lebenslaufseite wird geladen {pageNumber} von {pageCount}",
		[msg`Resume page ${pageNumber} of ${totalPages}`.id]: "Lebenslaufseite {pageNumber} von {totalPages}",
	});
	const markup = (node: React.ReactNode) => renderToStaticMarkup(<I18nProvider i18n={i18n}>{node}</I18nProvider>);
	const loading = markup(<ResumePreviewLoader pageCount={3} showPageNumbers />);
	expect(loading).toContain("Seite 1 von 3");
	expect(loading).toContain('aria-label="Lebenslaufseite wird geladen 1 von 3"');
	const rendered = markup(
		<PdfCanvasPage
			document={{} as never}
			onLoadSuccess={() => {}}
			pageNumber={2}
			totalPages={3}
			pageScale={1}
			showPageNumbers
		/>,
	);
	expect(rendered).toContain("Seite 2 von 3");
	expect(rendered).toContain('aria-label="Lebenslaufseite 2 von 3"');
});

it("translates ATS page badges without changing extracted evidence", () => {
	const page = 7;
	const evidence = { page };
	i18n.load("de-DE", { [msg`Page ${evidence.page}`.id]: "Seite {0}" });
	const finding = {
		code: "NO_TEXT_LAYER",
		severity: "blocker",
		category: "parseability",
		evidence: { page, snippet: "Fictional evidence" },
	} as const;
	const output = renderToStaticMarkup(
		<I18nProvider i18n={i18n}>
			<FindingRow finding={finding} />
		</I18nProvider>,
	);
	expect(output).toContain("Seite 7");
	expect(output).toContain("Fictional evidence");
	expect(finding.evidence.page).toBe(7);
});
