// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { DownloadTab } from "./download-tab";

const mocks = vi.hoisted(() => ({
	generate: vi.fn(),
	download: vi.fn(),
	toast: vi.fn(),
	update: vi.fn(),
	resume: { id: "resume", data: { metadata: {} as { fileName?: string } } },
}));
vi.mock("@/features/resume/builder/draft", () => ({
	useCurrentResume: () => mocks.resume,
	useUpdateResumeData: () => mocks.update,
}));
vi.mock("@/features/resume/editor/check/use-check", () => ({ useOpenIssueCount: () => 0 }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: [] }) }));
vi.mock("@/features/applications/queries", () => ({ applicationsListQueryOptions: () => ({}) }));
vi.mock("@/features/letters/export", () => ({ createLetterFile: vi.fn(), letterFileName: vi.fn() }));
vi.mock("@/libs/orpc/client", () => ({ client: {} }));
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: mocks.toast } }));
vi.mock("@reactive-resume/utils/file", () => ({ downloadWithAnchor: mocks.download }));
vi.mock("@/features/resume/export/use-resume-export", () => ({
	createExportFile: mocks.generate,
	getDefaultFileName: () => "resume",
	preloadDocumentExport: () => undefined,
	sanitizeFileName: (value: string) => value,
}));

it("offers peer feedback only after a successful export and clears it for a new format or failure", async () => {
	i18n.load("en", {});
	i18n.activate("en");
	const file = new Blob(["fictional resume"]);
	let finish!: (file: Blob) => void;
	mocks.generate.mockReturnValueOnce(new Promise<Blob>((resolve) => (finish = resolve)));
	render(
		<I18nProvider i18n={i18n}>
			<DownloadTab onReview={() => undefined} />
		</I18nProvider>,
	);
	const invite = () => screen.queryByRole("link", { name: "Get resume feedback on Discord" });
	expect(invite()).toBeNull();
	expect(screen.queryByRole("link", { name: "Donate" })).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Download PDF" }));
	expect(invite()).toBeNull();
	expect(screen.queryByRole("link", { name: "Donate" })).toBeNull();
	finish(file);
	const link = await screen.findByRole("link", { name: "Get resume feedback on Discord" });
	expect(link.getAttribute("href")).toBe("https://discord.gg/9kAqrGcwn5");
	expect(mocks.download).toHaveBeenCalledWith(file, "resume.pdf");
	expect(screen.getByRole("link", { name: "Donate" })).toBeTruthy();

	fireEvent.click(screen.getByRole("radio", { name: /Word/ }));
	expect(invite()).toBeNull();
	expect(screen.queryByRole("link", { name: "Donate" })).toBeNull();
	mocks.generate.mockRejectedValueOnce(new Error("Export unavailable"));
	fireEvent.click(screen.getByRole("button", { name: "Download Word" }));
	await screen.findByRole("alert");
	expect(invite()).toBeNull();
	expect(screen.queryByRole("link", { name: "Donate" })).toBeNull();
	expect(mocks.download).toHaveBeenCalledTimes(1);
	mocks.generate.mockResolvedValueOnce(file);
	fireEvent.click(screen.getByRole("button", { name: "Download PDF instead" }));
	expect(await screen.findByRole("link", { name: "Get resume feedback on Discord" })).toBeTruthy();
});

it("starts from the saved file name and keeps an edited one with the resume", async () => {
	i18n.load("en", {});
	i18n.activate("en");
	mocks.resume.data.metadata.fileName = "Saved-Name";
	mocks.generate.mockResolvedValue(new Blob(["fictional resume"]));
	render(
		<I18nProvider i18n={i18n}>
			<DownloadTab onReview={() => undefined} />
		</I18nProvider>,
	);
	const field = screen.getByLabelText("File name") as HTMLInputElement;
	expect(field.value).toBe("Saved-Name");

	const save = (value: string) => {
		fireEvent.change(field, { target: { value } });
		const draft = { metadata: {} as { fileName?: string } };
		const [recipe, options] = mocks.update.mock.lastCall as [(draft: object) => void, object];
		recipe(draft);
		expect(options).toEqual({ coalesceKey: "metadata.fileName" });
		return draft.metadata.fileName;
	};
	expect(save("Jordan-Acme")).toBe("Jordan-Acme");
	fireEvent.click(screen.getByRole("button", { name: "Download PDF" }));
	await vi.waitFor(() => expect(mocks.download).toHaveBeenLastCalledWith(expect.any(Blob), "Jordan-Acme.pdf"));
	// The generated name, typed back or cleared, isn't saved: the default applies again.
	expect(save("resume")).toBe("");
	expect(save("")).toBe("");
	// After editing the field shows the resume's name again, so a default name keeps following the author's name.
	fireEvent.blur(field);
	expect(field.value).toBe("Saved-Name");
	mocks.resume.data.metadata = {};
});
