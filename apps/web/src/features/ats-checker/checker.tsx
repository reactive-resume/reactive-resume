import type { ExtractProgress } from "./extract-client";
import type { AtsCheckResult } from "./run-ats-check";
import type { PdfFinding } from "@reactive-resume/resume/ats-pdf";
import type { DragEvent, ReactNode } from "react";
import { i18n } from "@lingui/core";
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useId, useRef, useState } from "react";
import { useIsClient } from "usehooks-ts";
import { pdfVerdict } from "@reactive-resume/resume/ats-pdf/verdict";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { Tabs, TabsContent, TabsCount, TabsList, TabsTrigger } from "@reactive-resume/ui/components/tabs";
import { Textarea } from "@reactive-resume/ui/components/textarea";
import { cn } from "@reactive-resume/utils/style";
import { PdfDamagedError, PdfPasswordRequiredError, PdfTooLargeError, PdfUnreadableError } from "./extract-client";
import { getPdfCategoryLabel, getPdfFindingMessage } from "./messages";
import { savePendingImport, takePendingImport } from "./pending-import";
import { JdCoverage } from "./report/jd-coverage";
import { runAtsCheck } from "./run-ats-check";
import { useStartDocument } from "@/features/documents/use-start-document";
import { getOrpcErrorMessage } from "@/libs/error-message";
import { ENTER_CLASS, POP_CLASS } from "@/libs/motion";
import { client } from "@/libs/orpc/client";

// PDF.js and the importers load only once there is a file, so the page's first screen stays light and prerenderable.
const PdfViewer = lazy(() => import("./pdf-viewer").then((module) => ({ default: module.PdfViewer })));
const loadReadFile = () => import("@/features/resume/import/read-file");

const MAX_POSTING = 20_000;
const SAMPLE = { url: "/templates/pdf/onyx.pdf", name: "Sample resume.pdf" };

type State =
	| { name: "idle"; error?: string }
	| { name: "busy"; file: File; step: number }
	| { name: "done"; file: File; result: AtsCheckResult; importError?: string }
	| { name: "importing" };

const stepOf = (progress: ExtractProgress) => (progress.phase === "loading" ? 0 : progress.phase === "text" ? 1 : 2);

function describeError(error: unknown) {
	if (error instanceof PdfPasswordRequiredError)
		return t`This PDF is password protected. Save an unprotected copy and try again.`;
	if (error instanceof PdfTooLargeError) return t`That file is too large to check. PDFs up to 25 MB work.`;
	if (error instanceof PdfUnreadableError)
		return t`That file couldn't be read as a PDF. Choose a PDF file and try again.`;
	if (error instanceof PdfDamagedError)
		return t`This PDF looks damaged. Export it again from your editor and choose the new file.`;
	return t`Couldn't read that file. Try again.`;
}

type AtsCheckerProps = {
	signedIn: boolean;
	/** Back from signing up with a file waiting to be imported. */
	importPending: boolean;
};

/**
 * The public checker: drop a PDF, watch three steps, then see what could cost a match, numbered on the page and in the
 * text software reads from it. "Fix these in the editor" imports the same file (after signing up, if needed) and opens Check; a
 * file with no text offers a blank resume or a Word import instead.
 */
export function AtsChecker({ signedIn, importPending }: AtsCheckerProps) {
	const navigate = useNavigate();
	const [state, setState] = useState<State>({ name: "idle" });
	const [posting, setPosting] = useState("");
	const abort = useRef<AbortController | null>(null);

	const check = async (file: File) => {
		abort.current?.abort();
		const controller = new AbortController();
		abort.current = controller;
		setState({ name: "busy", file, step: 0 });
		try {
			const result = await runAtsCheck(file, {
				jobDescription: posting,
				signal: controller.signal,
				onProgress: (progress) => setState({ name: "busy", file, step: stepOf(progress) }),
			});
			if (controller.signal.aborted) return;
			setState({ name: "done", file, result });
		} catch (error) {
			if (!controller.signal.aborted) setState({ name: "idle", error: describeError(error) });
		}
	};

	// A failed import goes back to the report it came from, with the reason, rather than to an empty upload screen.
	const importAndOpen = async (file: File, result?: AtsCheckResult) => {
		setState({ name: "importing" });
		let readFile: Awaited<ReturnType<typeof loadReadFile>> | undefined;
		try {
			readFile = await loadReadFile();
			// Read in the browser, the same way the check did, so every issue lines up in Check.
			const data = await readFile.readResumeFile(file, "pdf", { aiAvailable: false });
			const resumeId = await client.resume.import({ data });
			await navigate({ to: "/builder/$resumeId", params: { resumeId }, search: { mode: "check" } });
		} catch (error) {
			const message =
				readFile && error instanceof readFile.ImportError
					? error.message
					: getOrpcErrorMessage(error, { fallback: t`Couldn't import the file. Try again from Documents.` });
			setState(result ? { name: "done", file, result, importError: message } : { name: "idle", error: message });
		}
	};

	const fix = async (file: File, result: AtsCheckResult) => {
		if (signedIn) return importAndOpen(file, result);
		await savePendingImport(file);
		await navigate({ to: "/auth/register", search: { callbackURL: "/ats-checker?import=1" } });
	};

	// Signed up (or in) with a file waiting: import it straight away.
	const resumed = useRef(false);
	useEffect(() => {
		if (!signedIn || !importPending || resumed.current) return;
		resumed.current = true;
		void takePendingImport().then((file) => {
			if (file) void importAndOpen(file);
			else void navigate({ to: "/ats-checker", replace: true });
		});
	});

	useEffect(() => () => abort.current?.abort(), []);
	// The first state is already on screen (the page is prerendered), so only the states that replace it fade in;
	// fading it too would hold back the page's largest paint until the app had loaded.
	const replacing = useIsClient();

	// Each state fades in as it replaces the last. Opacity only: a translate here would make this wrapper the
	// containing block for the result's fixed mobile bar while it animates.
	return (
		<div
			key={state.name}
			className={cn(
				"flex flex-1 flex-col",
				replacing && "transition-opacity duration-standard ease-enter starting:opacity-0",
			)}
		>
			{state.name === "importing" ? (
				<p role="status" className="flex items-center justify-center gap-2 py-24 text-sm text-ink-2">
					<Spinner decorative className="size-4" />
					<Trans>Importing it into your new resume…</Trans>
				</p>
			) : state.name === "busy" ? (
				<Progress file={state.file} step={state.step} />
			) : state.name === "done" ? (
				<Result
					result={state.result}
					file={state.file}
					signedIn={signedIn}
					importError={state.importError}
					onFix={() => void fix(state.file, state.result)}
					onFile={(file) => void check(file)}
					onReset={() => setState({ name: "idle" })}
				/>
			) : (
				<Idle error={state.error} posting={posting} onPosting={setPosting} onFile={(file) => void check(file)} />
			)}
		</div>
	);
}

async function fetchSample() {
	try {
		const res = await fetch(SAMPLE.url);
		return res.ok ? await res.blob() : null;
	} catch {
		return null;
	}
}

/** Makes an element take a dropped file. Dropping is pointer-only; a "choose a file" button is the keyboard path. */
function useFileDrop(onFile: (file: File) => void) {
	const [dragging, setDragging] = useState(false);
	return {
		dragging,
		dropProps: {
			onDragOver: (event: DragEvent) => {
				event.preventDefault();
				setDragging(true);
			},
			onDragLeave: () => setDragging(false),
			onDrop: (event: DragEvent) => {
				event.preventDefault();
				setDragging(false);
				const file = event.dataTransfer.files[0];
				if (file) onFile(file);
			},
		},
	};
}

type IdleProps = {
	error?: string | undefined;
	posting: string;
	onPosting: (value: string) => void;
	onFile: (file: File) => void;
};

function Idle({ error, posting, onPosting, onFile }: IdleProps) {
	const id = useId();
	const input = useRef<HTMLInputElement>(null);
	const { dragging, dropProps } = useFileDrop(onFile);
	const [sampleError, setSampleError] = useState<string>();
	const message = error ?? sampleError;

	const sample = async () => {
		setSampleError(undefined);
		const blob = await fetchSample();
		if (blob) onFile(new File([blob], SAMPLE.name, { type: "application/pdf" }));
		else setSampleError(t`Couldn't load the sample file. Try again.`);
	};

	const checks = [
		{
			title: t`The text`,
			body: t`Hiring software turns a PDF into plain text before anyone reads it. This does the same and shows you what came out.`,
		},
		{
			title: t`The order`,
			body: t`Columns, tables and text boxes can scramble the reading order. Each problem is marked on your page.`,
		},
		{
			title: t`The details`,
			body: t`Dates, headings, email, phone and links, checked for the forms parsers expect.`,
		},
	];

	return (
		<div className="mx-auto flex w-full max-w-[840px] flex-col px-4 pt-8 pb-16 sm:px-10 sm:pt-11">
			<h1 className="t-root-title text-balance sm:t-display">
				<Trans>Can software read your resume?</Trans>
			</h1>
			<p className="max-w-[640px] pt-2.5 t-body text-ink-2">
				<Trans>
					Choose a PDF and see the text an applicant tracking system pulls out of it: what is missing, what is out of
					order, and how to fix it. Free, no account needed.
				</Trans>
			</p>

			{/* The card is the drop area; its button takes the keyboard. */}
			{/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- dropping is pointer-only; "Choose a PDF" is the keyboard path. */}
			<div
				data-design="dropz"
				className={cn(
					"mt-7 flex flex-col items-center gap-2 rounded-xl bg-surface px-6 pt-[30px] pb-[26px] text-center outline-[1.5px] -outline-offset-1 outline-line-2 transition-colors duration-quick outline-dashed",
					dragging && "bg-accent-soft outline-accent",
				)}
				{...dropProps}
			>
				<Icon name="file-pdf" size={32} className="text-ink-3" />
				<Button size="lg" className="mt-1.5" onClick={() => input.current?.click()}>
					<Icon name="upload-simple" />
					{dragging ? <Trans>Drop to check</Trans> : <Trans>Choose a PDF</Trans>}
				</Button>
				<p className="t-small text-ink-3">
					<Trans>or drop it here · up to 25 MB</Trans>
				</p>
				<p className="flex items-center gap-1.5 t-small text-ink-2">
					<Icon name="shield-check" size={16} />
					<Trans>Checked in your browser. The file is never uploaded.</Trans>
				</p>
				{message && (
					<p
						role="alert"
						className="mt-2 flex items-start gap-2.5 self-stretch border-t border-line pt-3 text-start t-ui"
					>
						<Icon name="warning-circle" size={18} className="mt-px text-danger-text" />
						{message}
					</p>
				)}
				<input
					ref={input}
					type="file"
					accept="application/pdf,.pdf"
					className="sr-only"
					tabIndex={-1}
					aria-hidden
					onChange={(event) => {
						const file = event.target.files?.[0];
						if (file) onFile(file);
						event.target.value = "";
					}}
				/>
			</div>

			<p className="pt-3 text-center t-small text-ink-3">
				<Trans>
					No file to hand?{" "}
					{/* A link to the file itself, so it is inline text and opens the sample even before the app has loaded. */}
					<a
						href={SAMPLE.url}
						className="rounded-xs font-medium text-accent-text"
						onClick={(event) => {
							event.preventDefault();
							void sample();
						}}
					>
						Try a sample file
					</a>
				</Trans>
			</p>

			{/* Before the file, so a posting can be added first: it fills the result's Job match tab. */}
			<div className="mt-[22px] flex flex-col gap-1.5">
				<label htmlFor={id} className="flex justify-between gap-2 text-[13px]/[18px] font-medium text-ink-2">
					<Trans>
						Job posting <span className="text-xs/4 font-normal text-ink-3">optional · adds a keyword match</span>
					</Trans>
				</label>
				<Textarea
					id={id}
					rows={2}
					maxLength={MAX_POSTING}
					value={posting}
					className="min-h-19 resize-none"
					placeholder={t`Paste the posting to see which of its terms your resume already has.`}
					onChange={(event) => onPosting(event.target.value)}
				/>
			</div>

			<h2 className="pt-7 pb-2 t-section-title">
				<Trans>What it checks</Trans>
			</h2>
			<dl className="grid gap-x-8 gap-y-4 sm:grid-cols-3">
				{checks.map((check) => (
					<div key={check.title}>
						<dt className="t-small text-ink">{check.title}</dt>
						<dd className="inline t-small text-ink-3">{check.body}</dd>
					</div>
				))}
			</dl>
		</div>
	);
}

function Progress({ file, step }: { file: File; step: number }) {
	const steps = [t`Opening the file`, t`Reading the text`, t`Checking layout and content`];
	return (
		<div className="grid flex-1 place-items-center px-4 py-24">
			<div role="status" className="w-full max-w-[480px] rounded-xl border border-line bg-bg px-5 py-[18px]">
				<p className="truncate t-label">
					<Trans>Checking {file.name}</Trans>
				</p>
				<div className="flex flex-col gap-2 pt-3 t-ui">
					{steps.map((label, index) => (
						<span
							key={label}
							className={cn("flex items-center gap-2", index === step && "font-medium", index > step && "text-ink-3")}
						>
							{index < step ? (
								<Icon name="check-circle" size={18} className={cn(POP_CLASS, "text-accent-text")} />
							) : index === step ? (
								<Spinner decorative className="size-[18px] text-ink-3" />
							) : (
								<Icon name="circle" size={18} className="text-ink-3" />
							)}
							{label}
						</span>
					))}
				</div>
				<div aria-hidden className="mt-3.5 h-1 overflow-hidden rounded-full bg-sunken">
					<div
						className="h-full rounded-full bg-accent transition-[width] duration-standard ease-enter"
						style={{ width: `${[12, 40, 72][step] ?? 72}%` }}
					/>
				</div>
			</div>
		</div>
	);
}

const VERDICT_LABEL = {
	clean: () => t`Reads cleanly`,
	mostly: () => t`Mostly readable`,
	hard: () => t`Hard for software to read`,
};

type ResultProps = {
	result: AtsCheckResult;
	file: File;
	signedIn: boolean;
	importError: string | undefined;
	onFix: () => void;
	onFile: (file: File) => void;
	onReset: () => void;
};

// A file with no text behind its pages has nothing to import: the editor would open empty. A partly scanned one
// (IMAGE_ONLY_DOCUMENT) still brings its readable pages.
const UNREADABLE = new Set(["NO_TEXT_LAYER"]);

const marker =
	"grid size-5 shrink-0 place-items-center rounded-xs bg-warn font-mono text-[11px] leading-5 font-semibold text-warn-ink";

function Result({ result, file, signedIn, importError, onFix, onFile, onReset }: ResultProps) {
	const { report } = result;
	const unreadable = report.findings.some((finding) => UNREADABLE.has(finding.code));
	const issues = report.findings;
	const [tab, setTab] = useState("issues");
	const [lens, setLens] = useState<"page" | "text">("page");
	const [passedOpen, setPassedOpen] = useState(false);
	const { dragging, dropProps } = useFileDrop(onFile);
	const { verdict } = pdfVerdict(report);
	const pageCount = report.document.pageCount;

	const failing = new Set(issues.map((finding) => finding.category));
	const passing = report.categories.filter((category) => !failing.has(category.category));

	return (
		// From 1024 the result is one screen, like the builder: the panel and the file each scroll on their own.
		<div className="flex flex-1 max-lg:flex-col lg:h-[calc(100svh-4rem)] lg:flex-none">
			<aside
				data-design="epanel"
				aria-label={t`Result`}
				className="flex flex-col bg-bg lg:w-[400px] lg:shrink-0 lg:border-e lg:border-line"
			>
				<div className="flex min-h-0 flex-1 flex-col px-4 pt-5 max-lg:pb-28 sm:px-6 lg:overflow-y-auto lg:pb-6">
					{/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- dropping is pointer-only; "Check another" is the keyboard path. */}
					<div
						className={cn(
							"flex items-center gap-3 rounded-lg px-3 py-2.5 outline -outline-offset-1 outline-line-2 transition-colors duration-quick outline-dashed",
							dragging && "bg-accent-soft outline-accent",
						)}
						{...dropProps}
					>
						<Icon name="file-pdf" size={20} className="text-ink-2" />
						<span className="flex min-w-0 flex-1 flex-col">
							<span className="truncate text-sm font-medium">{file.name}</span>
							<span className="text-xs/4 text-ink-3">
								{plural(pageCount, { one: "# page · never uploaded", other: "# pages · never uploaded" })}
							</span>
						</span>
						<Button variant="ghost" size="sm" className="text-accent-text" onClick={onReset}>
							<Trans>Check another</Trans>
						</Button>
					</div>

					<h1 className="mt-[22px] t-page-title">
						{unreadable || issues.length === 0
							? VERDICT_LABEL[unreadable ? "hard" : verdict]()
							: plural(issues.length, { one: "# thing to review", other: "# things to review" })}
					</h1>
					<p className="pt-1.5 t-small text-ink-3">
						{unreadable ? (
							<Trans>It is probably a scan: start a blank resume, or import the Word version.</Trans>
						) : issues.length === 0 ? (
							<Trans>Nothing here should cost you a match.</Trans>
						) : verdict === "hard" ? (
							<Trans>They could cost you a match. Software reads little of this file as you wrote it.</Trans>
						) : (
							<Trans>They could cost you a match. The rest of this file reads cleanly.</Trans>
						)}{" "}
						{report.document.truncated && <Trans>Only the first {i18n.number(pageCount)} pages were checked.</Trans>}
					</p>

					<Tabs value={tab} onValueChange={(value) => setTab(String(value))} className="mt-[18px] gap-1">
						<TabsList aria-label={t`Result`} className="w-full">
							<TabsTrigger value="issues">
								<Trans>Issues</Trans>
								{issues.length > 0 && <TabsCount>{i18n.number(issues.length)}</TabsCount>}
							</TabsTrigger>
							{/* Only with a posting pasted on the start page. */}
							{report.jd && (
								<TabsTrigger value="match">
									<Trans>Job match</Trans>
								</TabsTrigger>
							)}
							<TabsTrigger value="writing">
								<Trans>Writing</Trans>
								{report.tips.length > 0 && <TabsCount>{i18n.number(report.tips.length)}</TabsCount>}
							</TabsTrigger>
						</TabsList>

						<TabsContent value="issues">
							<ol className="flex flex-col">
								{issues.map((finding, index) => (
									<FindingItem
										key={finding.code}
										finding={finding}
										lead={
											<span aria-hidden className={cn(marker, "mt-px")}>
												{i18n.number(index + 1)}
											</span>
										}
									/>
								))}
							</ol>
							{passing.length > 0 && (
								<>
									<button
										type="button"
										aria-expanded={passedOpen}
										onClick={() => setPassedOpen(!passedOpen)}
										className="flex min-h-14 w-full items-center gap-3.5 rounded-md py-2.5 text-start"
									>
										<Icon name="check-circle" size={20} className="text-accent-text" />
										<span className="flex min-w-0 flex-1 flex-col gap-px">
											<span className="t-row-title">
												{issues.length > 0 ? <Trans>Everything else passes</Trans> : <Trans>Everything passes</Trans>}
											</span>
											<span className="truncate t-small text-ink-3">
												{passing.map((category) => getPdfCategoryLabel(category.category)).join(", ")}
											</span>
										</span>
										<Icon
											name="caret-right"
											size={18}
											className={cn(
												"text-ink-3 transition-transform duration-quick rtl:-scale-x-100",
												passedOpen && "rotate-90",
											)}
										/>
									</button>
									{passedOpen && (
										<ul className={cn(ENTER_CLASS, "flex flex-col ps-[34px] pb-2 t-small text-ink-2")}>
											{passing.map((category) => (
												<li key={category.category} className="flex justify-between gap-3 py-1">
													{getPdfCategoryLabel(category.category)}
													<span className="text-ink-3">
														<Trans>
															{i18n.number(category.passedChecks)} of {i18n.number(category.applicableChecks)} checks
														</Trans>
													</span>
												</li>
											))}
										</ul>
									)}
								</>
							)}
						</TabsContent>

						{report.jd && (
							<TabsContent value="match" className="pt-3.5">
								<JdCoverage jd={report.jd} />
							</TabsContent>
						)}

						<TabsContent value="writing">
							{report.tips.length > 0 ? (
								<ul className="flex flex-col">
									{report.tips.map((tip) => (
										<FindingItem
											key={tip.code}
											finding={tip}
											lead={<Icon name="pencil-simple" size={20} className="text-ink-3" />}
										/>
									))}
								</ul>
							) : (
								<p className="py-4 t-small text-ink-3">
									<Trans>Nothing to suggest.</Trans>
								</p>
							)}
						</TabsContent>
					</Tabs>
				</div>

				<div className="flex flex-col gap-2.5 border-t border-line bg-bg px-4 pt-4 pb-5 max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-20 max-lg:pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
					{importError && (
						<p role="alert" className="t-small text-danger-text">
							{importError}
						</p>
					)}
					{unreadable ? (
						<StartInstead signedIn={signedIn} />
					) : (
						<>
							<Button size="lg" className="w-full leading-5" onClick={onFix}>
								{issues.length === 0 ? (
									<Trans>Edit it in Reactive Resume</Trans>
								) : (
									<Trans>Fix these in the editor</Trans>
								)}
							</Button>
							<p className="text-center text-xs/4 text-ink-3 max-lg:hidden">
								<Trans>Brings this file into a free resume and opens Check.</Trans>
								{!signedIn && (
									<>
										<br />
										<Trans>No account yet? You create one first, and the file waits.</Trans>
									</>
								)}
							</p>
						</>
					)}
				</div>
			</aside>

			<section
				data-design="canvas"
				aria-label={t`Your file`}
				className="flex min-w-0 flex-1 flex-col items-center gap-4 bg-sunken px-4 pt-4 pb-10 sm:px-6 lg:overflow-y-auto xl:flex-row xl:items-start xl:justify-center xl:gap-6 dark:bg-raised"
			>
				{/* Side by side from 1280; narrower windows show one at a time. */}
				<Tabs value={lens} onValueChange={(value) => setLens(value as "page" | "text")} className="xl:hidden">
					<TabsList aria-label={t`How to show the file`}>
						<TabsTrigger value="page">
							<Trans>What a person sees</Trans>
						</TabsTrigger>
						<TabsTrigger value="text">
							<Trans>What a parser reads</Trans>
						</TabsTrigger>
					</TabsList>
				</Tabs>

				{/* Both stay mounted, so switching back never re-reads the PDF. The hidden page collapses instead of
				    display:none, so the viewer keeps its width for "page-width" scaling even while it is still loading. */}
				<div
					className={cn(
						"flex w-full max-w-[612px] flex-col items-center gap-2.5 xl:max-w-[471px] xl:flex-1",
						lens !== "page" && "max-xl:invisible max-xl:h-0 max-xl:overflow-hidden",
					)}
				>
					<span className="t-mono text-ink-3 max-xl:hidden">
						<Trans>What a person sees</Trans>
					</span>
					<div data-design="paper" className="@container relative w-full rounded-paper bg-white shadow-page">
						<Suspense
							fallback={
								<div className="grid aspect-[210/297] place-items-center">
									<Spinner className="size-5" />
								</div>
							}
						>
							<PdfViewer file={file} className="block w-full" />
						</Suspense>
						<PageMarks findings={issues} pages={result.pages} />
					</div>
				</div>

				<div
					className={cn(
						"flex w-full max-w-[612px] flex-col items-center gap-2.5 xl:max-w-[471px] xl:flex-1",
						lens !== "text" && "max-xl:hidden",
					)}
				>
					<span className="t-mono text-ink-3 max-xl:hidden">
						<Trans>What a parser reads</Trans>
					</span>
					<ParsedText text={result.fullText} findings={issues} />
				</div>
			</section>
		</div>
	);
}

function FindingItem({ finding, lead }: { finding: PdfFinding; lead: ReactNode }) {
	const message = getPdfFindingMessage(finding.code);
	return (
		<li className="flex items-start gap-3 border-b border-line pt-3 pb-3.5">
			{lead}
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="t-row-title">{message.title}</span>
				<span className="t-small text-ink-3">{message.action}</span>
			</div>
		</li>
	);
}

type PageMarksProps = { findings: readonly PdfFinding[]; pages: AtsCheckResult["pages"] };

/**
 * The issues' numbers on the page: beside the line a finding points at, with a wavy underline, or at the top of its
 * page when it is about the whole page.
 */
function PageMarks({ findings, pages }: PageMarksProps) {
	// ponytail: PDF.js fits the first page to the width and scales every page the same; a file whose pages differ in
	// width puts later marks slightly off. Measure the rendered pages if that ever matters.
	const base = pages[0]?.width;
	if (!base) return null;
	const share = (points: number) => `${(points / base) * 100}cqw`;
	// Pages stack with 16px between them (pdf-viewer.tsx).
	const pageTop = (index: number) =>
		`${share(pages.slice(0, index).reduce((sum, page) => sum + page.height, 0))} + ${index * 16}px`;
	const loose = new Map<number, number>();

	return (
		<div className="pointer-events-none absolute inset-0">
			{findings.map((finding, index) => {
				const { page = 1, box } = finding.evidence ?? {};
				const pageIndex = Math.min(Math.max(page, 1), pages.length) - 1;
				const label = t`Issue ${i18n.number(index + 1)}: ${getPdfFindingMessage(finding.code).title}`;
				const stack = box ? 0 : (loose.get(pageIndex) ?? 0);
				if (!box) loose.set(pageIndex, stack + 1);
				return (
					<div key={finding.code}>
						{box && (
							<div
								aria-hidden
								className="wavy-underline absolute h-1"
								style={{
									insetInlineStart: share(box.x),
									top: `calc(${pageTop(pageIndex)} + ${share(box.y + box.height)})`,
									width: share(box.width),
								}}
							/>
						)}
						<span
							role="img"
							aria-label={label}
							title={label}
							className={cn(marker, "pointer-events-auto absolute shadow-e1")}
							style={
								box
									? {
											left: `max(2px, calc(${share(box.x)} - 26px))`,
											top: `calc(${pageTop(pageIndex)} + ${share(box.y)} - 3px)`,
										}
									: { left: 6, top: `calc(${pageTop(pageIndex)} + ${6 + stack * 26}px)` }
							}
						>
							{i18n.number(index + 1)}
						</span>
					</div>
				);
			})}
		</div>
	);
}

/** The text a parser extracts, in reading order, with each issue's number on the line that shows it. */
function ParsedText({ text, findings }: { text: string; findings: readonly PdfFinding[] }) {
	const lines = text.split("\n");
	const marks = new Map<number, { number: number; needle: string }>();
	findings.forEach((finding, index) => {
		// Long snippets are cut with an ellipsis and may run over lines: their start is enough to find them.
		const needle = finding.evidence?.snippet?.replace(/…$/, "").trim().slice(0, 60);
		if (!needle) return;
		const line = lines.findIndex((candidate, at) => !marks.has(at) && candidate.includes(needle));
		if (line >= 0) marks.set(line, { number: index + 1, needle });
	});

	return (
		<pre
			className={cn(
				ENTER_CLASS,
				"min-h-[667px] w-full rounded-lg border border-line bg-bg px-6 py-[22px] font-mono text-[11.5px] leading-[19px] whitespace-pre-wrap text-ink max-xl:min-h-0",
			)}
		>
			{text
				? lines.map((line, index) => {
						const mark = marks.get(index);
						const at = mark ? line.indexOf(mark.needle) : -1;
						return (
							// oxlint-disable-next-line react/no-array-index-key -- lines of one fixed text, never reordered
							<span key={index}>
								{mark ? (
									<>
										<span
											role="img"
											aria-label={t`Issue ${i18n.number(mark.number)}`}
											className={cn(marker, "me-1.5 inline-grid size-4 align-[1px] text-[10px] leading-4")}
										>
											{i18n.number(mark.number)}
										</span>
										{line.slice(0, at)}
										<span className="rounded-[3px] bg-warn-soft px-[3px] py-px text-warn-text underline decoration-warn decoration-wavy underline-offset-[3px]">
											{mark.needle}
										</span>
										{line.slice(at + mark.needle.length)}
									</>
								) : (
									line
								)}
								{"\n"}
							</span>
						);
					})
				: t`No text could be read from this file.`}
		</pre>
	);
}

/**
 * For a file with no text: a blank resume to paste into, or Documents to import the Word version. Signed out, both go
 * through sign-up first.
 */
function StartInstead({ signedIn }: { signedIn: boolean }) {
	const navigate = useNavigate();
	const { creating, startBlank } = useStartDocument();
	// Signing up first carries the choice: Documents starts the blank resume once the account exists.
	const signUp = (callbackURL: string) => void navigate({ to: "/auth/register", search: { callbackURL } });
	return (
		<div className="flex flex-col gap-2">
			<Button
				size="lg"
				loading={creating}
				onClick={() => (signedIn ? void startBlank() : signUp("/dashboard/documents?new=resume"))}
			>
				<Trans>Start a blank resume</Trans>
			</Button>
			<Button
				variant="secondary"
				size="lg"
				onClick={() => (signedIn ? void navigate({ to: "/dashboard/documents" }) : signUp("/dashboard/documents"))}
			>
				<Trans>Import a Word file instead</Trans>
			</Button>
		</div>
	);
}
