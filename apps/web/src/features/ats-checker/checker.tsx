import type { ExtractProgress } from "./extract-client";
import type { AtsCheckResult } from "./run-ats-check";
import type { PdfAtsReport, PdfCategory } from "@reactive-resume/resume/ats-pdf";
import type { CSSProperties } from "react";
import { t } from "@lingui/core/macro";
import { Plural, Trans } from "@lingui/react/macro";
import { useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useId, useRef, useState } from "react";
import { useIsClient } from "usehooks-ts";
import { Button } from "@reactive-resume/ui/components/button";
import { Collapsible, CollapsibleContent } from "@reactive-resume/ui/components/collapsible";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { Tabs, TabsList, TabsTrigger } from "@reactive-resume/ui/components/tabs";
import { Textarea } from "@reactive-resume/ui/components/textarea";
import { cn } from "@reactive-resume/utils/style";
import { PdfPasswordRequiredError, PdfTooLargeError, PdfUnreadableError } from "./extract-client";
import { getPdfCategoryDescription, getPdfCategoryLabel, getPdfFindingMessage } from "./messages";
import { savePendingImport, takePendingImport } from "./pending-import";
import { runAtsCheck } from "./run-ats-check";
import { RollingNumber } from "@/components/ui/rolling-number";
import { useStartDocument } from "@/features/documents/use-start-document";
import { getOrpcErrorMessage } from "@/libs/error-message";
import { ENTER_CLASS, POP_CLASS, stagger } from "@/libs/motion";
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
	return t`Couldn't read that file. Try again.`;
}

type AtsCheckerProps = {
	signedIn: boolean;
	/** Back from signing up with a file waiting to be imported. */
	importPending: boolean;
};

/**
 * The public checker: drop a PDF, watch three steps, then see the score, what could cost a match, and the file as
 * software reads it. "Fix these in the editor" imports the same file (after signing up, if needed) and opens Check; a
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
			className={cn(replacing && "transition-opacity duration-standard ease-enter starting:opacity-0")}
		>
			{state.name === "importing" ? (
				<p role="status" className="flex items-center justify-center gap-2 py-24 text-ink-2">
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

type IdleProps = {
	error?: string | undefined;
	posting: string;
	onPosting: (value: string) => void;
	onFile: (file: File) => void;
};

function Idle({ error, posting, onPosting, onFile }: IdleProps) {
	const id = useId();
	const input = useRef<HTMLInputElement>(null);
	const [dragging, setDragging] = useState(false);

	const [sampleError, setSampleError] = useState<string>();

	const sample = async () => {
		setSampleError(undefined);
		const blob = await fetchSample();
		if (blob) onFile(new File([blob], SAMPLE.name, { type: "application/pdf" }));
		else setSampleError(t`Couldn't load the sample file. Try again.`);
	};

	return (
		<div className="mx-auto grid w-full max-w-[640px] gap-5.5 px-4 py-16 sm:py-18">
			<div className="grid justify-items-center gap-2.5 text-center">
				<h1 className="font-display text-[34px] leading-10 font-medium sm:text-[44px] sm:leading-[48px]">
					<Trans>Can software read your resume?</Trans>
				</h1>
				<p className="max-w-[520px] text-base leading-[25px] text-ink-2">
					<Trans>
						Upload a PDF and see the text an applicant tracking system extracts: what's missing, what's out of order,
						and how to fix it. Free, no account needed.
					</Trans>
				</p>
			</div>

			{/* A drop zone, not a form: the card takes a dropped file; its buttons take the keyboard. */}
			{/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- dropping is pointer-only; "choose a file" is the keyboard path. */}
			<div
				className={cn(
					"grid justify-items-center gap-2.5 rounded-lg border-[1.5px] border-dashed border-line-2 bg-surface p-9 text-center transition-colors duration-quick",
					dragging && "border-accent bg-accent-soft",
				)}
				onDragOver={(event) => {
					event.preventDefault();
					setDragging(true);
				}}
				onDragLeave={() => setDragging(false)}
				onDrop={(event) => {
					event.preventDefault();
					setDragging(false);
					const file = event.dataTransfer.files[0];
					if (file) onFile(file);
				}}
			>
				<Icon name="file-arrow-up" size={36} className="text-accent-text" />
				<button
					type="button"
					className="text-base font-semibold underline-offset-2 hover:underline"
					onClick={() => input.current?.click()}
				>
					<Trans>Drop a PDF here or choose a file</Trans>
				</button>
				<span className="text-sm text-ink-3">
					<Trans>Up to 25 MB · checked in your browser, never uploaded</Trans>
				</span>
				<Button className="mt-1.5" onClick={() => void sample()}>
					<Trans>Check a sample file</Trans>
				</Button>
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

			{(error ?? sampleError) && (
				<p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger-text">
					{error ?? sampleError}
				</p>
			)}

			<div className="grid gap-1.5">
				<label htmlFor={id} className="text-[13px] font-medium">
					<Trans>
						Job posting <span className="font-normal text-ink-3">· optional, adds a keyword match</span>
					</Trans>
				</label>
				<Textarea
					id={id}
					rows={3}
					maxLength={MAX_POSTING}
					value={posting}
					placeholder={t`Paste the posting to see which of its terms your resume already has.`}
					onChange={(event) => onPosting(event.target.value)}
				/>
			</div>

			<section aria-labelledby={`${id}-checks`} className="mt-8 grid gap-4 border-t border-line pt-8">
				<div className="grid gap-1.5">
					<h2 id={`${id}-checks`} className="font-display text-[22px] leading-7 font-medium">
						<Trans>What it checks</Trans>
					</h2>
					<p className="text-sm leading-[21px] text-ink-2">
						<Trans>
							Applicant tracking systems turn your PDF into plain text before anyone reads it. The checker does the
							same, with the PDF.js library in your browser, then scores how much of your resume survives: 0 to 100,
							from how reliably the text comes out, not from your chances of getting the job.
						</Trans>
					</p>
				</div>
				<dl className="grid gap-x-6 gap-y-3.5 sm:grid-cols-2">
					{checkedCategories.map((category) => (
						<div key={category} className="grid gap-0.5">
							<dt className="text-sm font-semibold">{getPdfCategoryLabel(category)}</dt>
							<dd className="text-[13px] leading-[19px] text-ink-2">{getPdfCategoryDescription(category)}</dd>
						</div>
					))}
				</dl>
			</section>
		</div>
	);
}

const checkedCategories: PdfCategory[] = ["parseability", "layout", "sections", "contact", "dates", "content"];

function Progress({ file, step }: { file: File; step: number }) {
	const steps = [t`Opening the file`, t`Reading the text`, t`Checking layout and content`];
	return (
		<div className="grid place-items-center px-4 py-24">
			<div role="status" className="grid w-full max-w-[420px] gap-3.5">
				<b className="truncate text-[15px] font-semibold">
					<Trans>Checking {file.name}</Trans>
				</b>
				{steps.map((label, index) => (
					<div
						key={label}
						className={cn("flex items-center gap-2.5 text-sm", index > step ? "text-ink-3" : "text-ink")}
					>
						<span className="flex w-5.5 justify-center">
							{index < step ? (
								<Icon name="check" size={20} className={cn(POP_CLASS, "text-accent-text")} />
							) : index === step ? (
								<Spinner decorative className={cn(POP_CLASS, "size-4")} />
							) : (
								<span aria-hidden className="size-3 rounded-sm border-[1.5px] border-current" />
							)}
						</span>
						{label}
					</div>
				))}
			</div>
		</div>
	);
}

const verdict = (score: number) =>
	score >= 80 ? t`Reads cleanly` : score >= 50 ? t`Mostly readable` : t`Hard for software to read`;

type Row = { key: string; title: string; count: string; tone: "danger" | "warn" | "accent"; body: React.ReactNode };

/** One row per category with something to fix, worst first, plus the posting's terms when one was pasted. */
function issueRows(report: PdfAtsReport): Row[] {
	const byCategory = new Map<PdfCategory, PdfAtsReport["findings"]>();
	for (const finding of [...report.findings, ...report.tips])
		byCategory.set(finding.category, [...(byCategory.get(finding.category) ?? []), finding]);

	const rows: Row[] = [...byCategory.entries()]
		.map(([category, findings]) => ({
			key: category,
			title: getPdfCategoryLabel(category),
			count: String(findings.length),
			tone: findings.some((finding) => finding.severity === "blocker")
				? ("danger" as const)
				: findings.every((finding) => finding.severity === "tip")
					? ("accent" as const)
					: ("warn" as const),
			body: (
				<ul className="grid gap-2">
					{findings.map((finding) => {
						const message = getPdfFindingMessage(finding.code);
						return (
							<li key={finding.code}>
								<b className="font-medium text-ink">{message.title}</b> {message.action}
							</li>
						);
					})}
				</ul>
			),
		}))
		.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === "danger" ? -1 : 1));

	if (report.jd)
		rows.push({
			key: "posting",
			title: t`Terms from the posting`,
			count: `${report.jd.matchedCount}/${report.jd.totalTerms}`,
			tone: "accent",
			body:
				report.jd.missingTerms.length > 0 ? (
					<Trans>Not found: {report.jd.missingTerms.join(", ")}</Trans>
				) : (
					<Trans>Every term the posting stresses is already there.</Trans>
				),
		});

	return rows;
}

type ResultProps = {
	result: AtsCheckResult;
	file: File;
	signedIn: boolean;
	importError: string | undefined;
	onFix: () => void;
	onReset: () => void;
};

// A file with no text behind its pages has nothing to import: the editor would open empty. A partly scanned one
// (IMAGE_ONLY_DOCUMENT) still brings its readable pages.
const UNREADABLE = new Set(["NO_TEXT_LAYER"]);

function Result({ result, file, signedIn, importError, onFix, onReset }: ResultProps) {
	const { report } = result;
	const unreadable = report.findings.some((finding) => UNREADABLE.has(finding.code));
	const rows = issueRows(report);
	const [open, setOpen] = useState<string | null>(rows[0]?.key ?? null);
	const [lens, setLens] = useState<"page" | "text">("page");
	const issues = report.findings.length;

	return (
		<div className="grid min-h-[calc(100svh-5rem)] lg:grid-cols-[440px_minmax(0,1fr)]">
			<aside className="grid content-start gap-4.5 border-line bg-surface p-6 max-lg:pb-28 lg:border-e">
				<div className="flex items-center gap-4">
					<div
						role="img"
						aria-label={t`Readability score: ${report.score} out of 100`}
						className="score-ring score-ring-reveal grid size-[84px] shrink-0 place-items-center rounded-full"
						style={
							{
								"--ring-value": `${report.score}%`,
								"--ring-color": report.score >= 80 ? "var(--accent)" : "var(--warn)",
							} as CSSProperties
						}
					>
						<span className="grid size-[70px] place-items-center rounded-full bg-surface font-display text-[26px] font-medium">
							<RollingNumber value={report.score} duration="480ms" />
						</span>
					</div>
					<div className="grid gap-1">
						<b className="text-base font-semibold">{verdict(report.score)}</b>
						<span className="text-[13px] leading-[19px] text-ink-2">
							{issues > 0 ? (
								<Plural value={issues} one="# issue could cost you a match." other="# issues could cost you a match." />
							) : (
								<Trans>Nothing here should cost you a match.</Trans>
							)}{" "}
							<Trans>The score reflects how reliably text is extracted, not your chances.</Trans>
						</span>
					</div>
				</div>

				{report.document.truncated && (
					<p className="text-xs text-ink-3">
						<Trans>Only the first {report.document.pageCount} pages were checked.</Trans>
					</p>
				)}

				{rows.length > 0 && (
					<div className="overflow-hidden rounded-xl border border-line">
						{rows.map((row, index) => {
							const expanded = open === row.key;
							return (
								<div
									key={row.key}
									style={stagger(index)}
									className={cn(ENTER_CLASS, index > 0 && "border-t border-line")}
								>
									<button
										type="button"
										aria-expanded={expanded}
										onClick={() => setOpen(expanded ? null : row.key)}
										className="flex h-12 w-full items-center gap-2.5 px-3.5 text-start text-sm font-medium transition-colors duration-quick hover:bg-hover"
									>
										<Icon
											name={
												row.key === "content"
													? "pencil-simple"
													: row.tone === "accent"
														? "briefcase"
														: row.tone === "danger"
															? "warning-circle"
															: "warning"
											}
											size={20}
											className={cn(
												row.tone === "danger" && "text-danger-text",
												row.tone === "warn" && "text-warn-text",
												row.tone === "accent" && "text-accent-text",
											)}
										/>
										{row.title}
										<span className="text-xs text-ink-3">{row.count}</span>
										<Icon
											name="caret-down"
											size={20}
											className={cn(
												"ms-auto text-ink-3 transition-transform duration-standard ease-enter",
												expanded && "rotate-180",
											)}
										/>
									</button>
									<Collapsible open={expanded}>
										<CollapsibleContent>
											<div className="px-3.5 ps-11 pb-3.5 text-[13px] leading-[19px] text-ink-2">{row.body}</div>
										</CollapsibleContent>
									</Collapsible>
								</div>
							);
						})}
					</div>
				)}

				<div className="grid gap-2.5 rounded-xl bg-accent-soft p-4 max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-20 max-lg:rounded-none max-lg:border-t max-lg:border-line max-lg:bg-surface max-lg:pb-[max(1rem,env(safe-area-inset-bottom))]">
					{importError && (
						<p role="alert" className="text-[13px] leading-[19px] text-danger-text">
							{importError}
						</p>
					)}
					{unreadable ? (
						<>
							<b className="text-[15px] font-semibold max-lg:hidden">
								<Trans>There's no text here to bring into the editor</Trans>
							</b>
							<span className="text-[13px] leading-[19px] text-ink-2 max-lg:hidden">
								<Trans>
									Start a blank resume and paste your sections in, or import the Word version from Documents.
								</Trans>
							</span>
							<StartInstead signedIn={signedIn} />
						</>
					) : (
						<>
							<b className="text-[15px] font-semibold max-lg:hidden">
								<Trans>Fix these in a few minutes</Trans>
							</b>
							<span className="text-[13px] leading-[19px] text-ink-2 max-lg:hidden">
								<Trans>
									Import this file into a free Reactive Resume, then keep checking it in Check as you edit. Check reads
									the resume you're editing, so its findings can differ from this file's.
								</Trans>
							</span>
							<Button className="h-10" onClick={onFix}>
								<Trans>Fix these in the editor</Trans>
							</Button>
						</>
					)}
				</div>

				<button type="button" className="w-fit text-sm text-ink-2 underline underline-offset-2" onClick={onReset}>
					<Trans>Check another file</Trans>
				</button>
			</aside>

			<section aria-label={t`Your file`} className="grid content-start bg-sunken">
				<div className="flex justify-center p-4">
					<Tabs value={lens} onValueChange={(value) => setLens(value as "page" | "text")}>
						<TabsList aria-label={t`How to show the file`}>
							<TabsTrigger value="page">
								<Trans>What a person sees</Trans>
							</TabsTrigger>
							<TabsTrigger value="text">
								<Trans>What a parser reads</Trans>
							</TabsTrigger>
						</TabsList>
					</Tabs>
				</div>
				<div className="grid justify-items-center px-4 pb-10 sm:px-10">
					{/* Both lenses stay mounted, so switching back never re-reads the PDF. The page lens collapses instead of
					    display:none, so the viewer keeps its width for "page-width" scaling even if the switch happens while
					    it is still loading. */}
					<div
						inert={lens !== "page"}
						className={cn(
							"w-full max-w-[612px] bg-white shadow-e2 transition-opacity duration-standard ease-enter",
							lens !== "page" && "h-0 overflow-hidden opacity-0 shadow-none",
						)}
					>
						<Suspense fallback={<Spinner className="mx-auto my-24 size-5" />}>
							<PdfViewer file={file} className="block w-full" />
						</Suspense>
					</div>
					<pre
						hidden={lens !== "text"}
						className={cn(
							ENTER_CLASS,
							"w-full max-w-[612px] rounded-lg border border-line bg-raised px-7 py-6 font-mono text-[13px] leading-[21px] whitespace-pre-wrap",
						)}
					>
						{result.fullText || t`No text could be read from this file.`}
					</pre>
				</div>
			</section>
		</div>
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
		<div className="flex flex-wrap gap-2">
			<Button
				className="h-10"
				loading={creating}
				onClick={() => (signedIn ? void startBlank() : signUp("/dashboard?new=resume"))}
			>
				<Trans>Start a blank resume</Trans>
			</Button>
			<Button
				variant="secondary"
				className="h-10"
				onClick={() => (signedIn ? void navigate({ to: "/dashboard" }) : signUp("/dashboard"))}
			>
				<Trans>Import a Word file instead</Trans>
			</Button>
		</div>
	);
}
