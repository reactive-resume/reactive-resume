import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { ArrowRightIcon, ArrowUpRightIcon, FilePdfIcon, SpinnerGapIcon } from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState } from "react";

const focusRing = "focus-visible:outline-2 focus-visible:outline-(--home-accent) focus-visible:outline-offset-4";
const message = "max-w-[300px] text-[14px] leading-[1.8]";

export default function AtsPlayground() {
	const inputId = useId();
	const controllerRef = useRef<AbortController | null>(null);
	const [file, setFile] = useState<File | null>(null);
	const [phase, setPhase] = useState<"idle" | "reading" | "done" | "error">("idle");
	const [text, setText] = useState("");
	const [error, setError] = useState("");

	useEffect(() => () => controllerRef.current?.abort(), []);

	const reset = () => {
		controllerRef.current?.abort();
		setFile(null);
		setText("");
		setError("");
		setPhase("idle");
	};

	const read = async (selected: File | null) => {
		controllerRef.current?.abort();
		const controller = new AbortController();
		controllerRef.current = controller;
		setFile(selected);
		setText("");
		setError("");
		if (selected && selected.type !== "application/pdf" && !/\.pdf$/i.test(selected.name)) {
			setError(t`Choose a PDF file to read its text.`);
			setPhase("error");
			return;
		}
		setPhase("reading");
		try {
			let source = selected;
			if (!source) {
				const response = await fetch("/templates/pdf/rhyhorn.pdf", { signal: controller.signal });
				if (!response.ok) throw new Error("Sample PDF unavailable");
				source = new File([await response.blob()], "rhyhorn.pdf", { type: "application/pdf" });
			}
			if (controller.signal.aborted) return;
			const { runAtsCheck } = await import("@/features/ats-checker/run-ats-check");
			if (controller.signal.aborted) return;
			const result = await runAtsCheck(source, { signal: controller.signal });
			if (controller.signal.aborted) return;
			setText(result.fullText);
			setPhase("done");
		} catch (caught) {
			if (controller.signal.aborted) return;
			const pdfErrors: Record<string, string> = {
				PdfPasswordRequiredError: t`This PDF is password protected. Save an unprotected copy and try again.`,
				PdfTooLargeError: t`This PDF is too large. Choose a file smaller than 25 MB.`,
				PdfUnreadableError: t`This file could not be read as a PDF. Export a new copy and try again.`,
			};
			setError(
				(caught instanceof Error && pdfErrors[caught.name]) ||
					t`Something went wrong while reading this file. Please try again.`,
			);
			setPhase("error");
		}
	};

	const isReading = phase === "reading";
	return (
		<div className="grid grid-cols-[minmax(180px,0.8fr)_auto_minmax(260px,1.25fr)] items-center gap-[38px] text-(--home-ink) max-[600px]:grid-cols-1 max-[900px]:grid-cols-[minmax(150px,0.8fr)_minmax(260px,1.2fr)] max-[600px]:gap-6 max-[900px]:gap-[25px]">
			<div className="min-w-0 text-center max-[900px]:col-[1]">
				<div className="transform-[perspective(1000px)_rotateY(9deg)_rotateZ(-5deg)] mx-auto mt-3 mb-[27px] aspect-[210/297] max-w-[235px] overflow-hidden bg-[#f5f4ef] text-[#414145] shadow-[12px_20px_36px_#0006] max-[600px]:max-w-[165px] max-[900px]:max-w-[180px]">
					{file ? (
						<div className="flex h-full flex-col items-center justify-center gap-[18px] text-[13px]">
							<FilePdfIcon size={58} weight="thin" aria-hidden="true" />
							<span>
								<Trans>Your selected file</Trans>
							</span>
						</div>
					) : (
						<img
							className="size-full object-cover"
							src="/templates/jpg/rhyhorn.jpg"
							alt={t`Rhyhorn sample resume`}
							width="510"
							height="720"
							loading="lazy"
						/>
					)}
				</div>
				<p className="wrap-anywhere text-[14px]">{file?.name ?? "rhyhorn.pdf"}</p>
				<span className="mt-[5px] block text-(--home-muted) text-[12px]">
					{file ? t`Stays in your browser` : t`A real sample PDF`}
				</span>
			</div>
			<div className="flex flex-col items-center gap-[15px] max-[900px]:col-[1] max-[600px]:row-auto max-[900px]:row-[2] max-[600px]:flex-row max-[600px]:flex-wrap max-[600px]:justify-center max-[600px]:gap-2.5">
				<button
					className={`motion-safe:active:not-disabled:not-focus-visible:transform-[scale(0.97)] flex min-w-[140px] flex-col items-center gap-[14px] rounded border border-(--home-line) bg-(--home-panel) px-4 py-5 text-(--home-ink) text-[13px] [transition:transform_140ms_var(--ease-out-strong),border-color_150ms_ease] hover:not-disabled:border-(--home-accent) disabled:cursor-progress max-[900px]:flex-row max-[900px]:gap-2.5 max-[900px]:py-[13px] ${focusRing}`}
					type="button"
					disabled={isReading}
					onClick={() => void read(file)}
				>
					{isReading ? (
						<SpinnerGapIcon className="animate-spin text-(--home-accent)" size={22} aria-hidden="true" />
					) : (
						<ArrowRightIcon className="text-(--home-accent)" size={22} aria-hidden="true" />
					)}
					{isReading
						? t`Reading PDF`
						: phase === "error"
							? t`Try again`
							: phase === "done"
								? t`Read again`
								: t`Read this resume`}
				</button>
				<label
					className="relative inline-flex min-h-[44px] cursor-pointer items-center p-2 text-[13px] underline underline-offset-[5px] focus-within:outline-(--home-accent) focus-within:outline-2 focus-within:outline-offset-4"
					htmlFor={inputId}
				>
					<Trans>Try your PDF</Trans>
					<input
						className="absolute inset-0 w-full cursor-pointer opacity-0"
						id={inputId}
						type="file"
						accept="application/pdf,.pdf"
						onChange={(event) => {
							const selected = event.target.files?.[0];
							event.target.value = "";
							if (selected) void read(selected);
						}}
					/>
				</label>
				{phase !== "idle" && (
					<button
						className={`min-h-9 px-3 py-1.5 text-(--home-muted) text-[12px] ${focusRing}`}
						type="button"
						onClick={reset}
					>
						{isReading ? t`Cancel` : t`Reset`}
					</button>
				)}
			</div>
			<div className="min-w-0 overflow-hidden rounded border border-(--home-line) bg-(--home-panel) max-[600px]:col-[1] max-[900px]:col-[2] max-[600px]:row-auto max-[900px]:row-[1/3]">
				<div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 border-(--home-line) border-b px-[22px] py-[18px] text-[13px]">
					<span>
						<Trans>Extracted text</Trans>
					</span>
					<span className="text-(--home-muted) text-[11px]" role="status">
						{isReading
							? t`Reading locally`
							: phase === "done"
								? text.trim()
									? t`Text extracted`
									: t`No text found`
								: t`PDF text layer`}
					</span>
				</div>
				<section
					className="h-80 overflow-auto overscroll-contain p-[23px] focus-visible:outline-(--home-accent) focus-visible:outline-2 focus-visible:outline-offset-[-3px] max-[600px]:h-[280px] max-[600px]:p-5"
					aria-label={t`Extracted text`}
					aria-busy={isReading}
					// biome-ignore lint/a11y/noNoninteractiveTabindex: The extracted text overflows and must be keyboard scrollable.
					tabIndex={0}
				>
					{phase === "error" ? (
						<p className={`${message} text-[#e1bda8]`} role="alert">
							{error}
						</p>
					) : phase === "done" && text.trim() ? (
						<pre className="wrap-anywhere whitespace-pre-wrap font-[IBM_Plex_Mono,monospace] text-[12px] leading-[1.9]">
							{text}
						</pre>
					) : (
						<p className={`${message} text-(--home-muted)`}>
							{isReading
								? t`Reading this PDF in your browser. Your file is not uploaded.`
								: phase === "done"
									? t`No readable text found. This PDF may contain scanned images. Export a PDF with selectable text and try again.`
									: t`Read the sample to see its text without the layout. Or try a PDF of your own.`}
						</p>
					)}
				</section>
				<a
					className={`flex items-center justify-between gap-[15px] border-(--home-line) border-t px-[22px] py-[18px] text-(--home-ink) text-[12px] hover:underline hover:underline-offset-4 ${focusRing}`}
					href="/ats-checker"
				>
					<Trans>Open the full ATS checker</Trans> <ArrowUpRightIcon size={17} aria-hidden="true" />
				</a>
			</div>
		</div>
	);
}
