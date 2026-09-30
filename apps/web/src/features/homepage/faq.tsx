import type { CSSProperties } from "react";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { templateSchema } from "@reactive-resume/schema/templates";
import { localeSchema } from "@reactive-resume/utils/locale";
import { cn } from "@reactive-resume/utils/style";
import { SCENE } from "./scroll";
import { Doodle, labelClass } from "./ui";
import { serializeJsonLd } from "@/libs/seo";

type Question = {
	id: string;
	question: string;
	/** Plain text: it is also the structured data's answer, which has to match what the page shows. */
	answer: string;
	link?: { label: string } & ({ href: string } | { to: "/ats-checker" });
};

function useQuestions(): Question[] {
	const { i18n } = useLingui();
	const templates = i18n.number(templateSchema.options.length);
	// Every locale but Lingui's pseudo-locale, which only exists to test layouts.
	const languages = i18n.number(localeSchema.options.length - 1);

	return [
		{
			id: "free",
			question: t`Is Reactive Resume really free?`,
			answer: t`Yes. Every feature is free: all ${templates} templates, PDF and Word downloads, the ATS checker, cover letters and the job tracker. There are no ads, no tracking and no paid tier. Donations pay for hosting and development.`,
		},
		{
			id: "ats",
			question: t`Will my resume get past applicant tracking systems?`,
			answer: t`Every template exports a text-based PDF with the words in reading order, which is what applicant tracking systems (ATS) need to parse a resume. To test any PDF, including one made elsewhere, the free ATS checker shows the text software extracts and what to fix.`,
			link: { label: t`Try the ATS checker`, to: "/ats-checker" },
		},
		{
			id: "privacy",
			question: t`Who can see my resume?`,
			answer: t`Only you, until you share it. A resume can stay private, go live at a public link, or be protected with a password, and you can change that at any time. Deleting your account deletes your resumes with it.`,
		},
		{
			id: "import",
			question: t`Can I import a resume I already have?`,
			answer: t`Yes. Import a PDF, a LinkedIn data export, a JSON Resume file or a Reactive Resume export, then pick up where it left off. With an AI provider set up, Word documents work too.`,
		},
		{
			id: "export",
			question: t`What formats can I download?`,
			answer: t`PDF, Word (DOCX), Markdown and JSON. The JSON export imports back into any Reactive Resume, including one you host yourself, so your data is never locked in.`,
		},
		{
			id: "ai",
			question: t`Does it use AI?`,
			answer: t`Only if you want it to. Add your own key from OpenAI, Anthropic, Google Gemini, OpenRouter, Ollama or another provider for sharper lines, tailoring to a job posting and reading Word files. Without a key, nothing is sent to an AI service.`,
		},
		{
			id: "self-host",
			question: t`Can I host it myself?`,
			answer: t`Yes. Reactive Resume is open source under the MIT License and ships as a Docker image, so it runs on your own server with your own database and storage.`,
			link: { label: t`Read the self-hosting guide`, href: "https://docs.rxresu.me/self-hosting/docker" },
		},
		{
			id: "languages",
			question: t`Which languages does it speak?`,
			answer: t`The app is translated into ${languages} languages by volunteers, and a resume can be written in any language, including right-to-left scripts like Arabic and Hebrew.`,
		},
	];
}

// A pencil circling the question's number: it overshoots its start, the way a hand-drawn loop does.
const circlePath = "M18 44C6 38 3 24 14 14C28 3 66 2 84 10C99 17 99 33 86 41C70 50 32 51 14 42C6 37 7 27 16 20";
// The pencil underline under the question, a little uneven.
const underlinePath = "M2 7C30 4 58 9 96 6S160 3 196 7S262 9 298 5";

type FaqItemProps = { item: Question; index: number };

function FaqItem({ item, index }: FaqItemProps) {
	const number = String(index + 1).padStart(2, "0");
	const linkClass =
		"mt-3 inline-flex items-center gap-1 font-medium font-ui text-[14px] text-[oklch(0.42_0.1_150)] underline underline-offset-[3px] transition-colors hover:text-[oklch(0.32_0.1_150)]";

	return (
		<details name="faq" className="faq-item border-b border-line">
			<summary className="flex cursor-pointer list-none items-start gap-5 rounded-sm py-6 outline-offset-4 focus-visible:outline-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
				<span className={cn(labelClass, "relative mt-[.7em] w-8 shrink-0 text-center text-ink-3")}>
					{number}
					<svg
						aria-hidden="true"
						viewBox="0 0 100 52"
						preserveAspectRatio="none"
						className="pointer-events-none absolute -inset-x-2.5 -inset-y-2.5 size-[calc(100%+20px)] overflow-visible text-accent"
					>
						<path data-stroke="circle" pathLength={1} d={circlePath} strokeWidth={2.6} />
					</svg>
				</span>
				<span className="font-anybody flex-1 text-[clamp(21px,2vw,30px)] leading-[1.2] font-light tracking-[-.015em] text-pretty text-ink">
					{/* Shrink-wrapped, so the underline runs under the words rather than the whole row. */}
					<span className="relative inline-block pb-1.5">
						{item.question}
						<svg
							aria-hidden="true"
							viewBox="0 0 300 12"
							preserveAspectRatio="none"
							className="pointer-events-none absolute inset-x-0 -bottom-1 h-2.5 w-full overflow-visible text-ink-3"
						>
							<path data-stroke="underline" pathLength={1} d={underlinePath} strokeWidth={1.6} />
						</svg>
					</span>
				</span>
				<span aria-hidden="true" data-plus className="relative mt-[.55em] size-5 shrink-0 text-ink-2">
					<span className="absolute inset-x-0 top-1/2 h-[1.5px] -translate-y-1/2 rounded-full bg-current" />
					<span className="absolute inset-y-0 left-1/2 w-[1.5px] -translate-x-1/2 rounded-full bg-current" />
				</span>
			</summary>

			<div className="ps-13 pe-2 pb-8">
				<div
					data-note
					className="relative rounded-[3px] bg-paper px-6 py-5 text-[oklch(0.28_0.01_95)] shadow-[0_1px_2px_oklch(0.2_0.01_95/.12),0_18px_36px_-18px_oklch(0.2_0.01_95/.4)]"
					style={{ "--tilt": `${index % 2 === 0 ? -0.5 : 0.4}deg` } as CSSProperties}
				>
					<p className="font-display text-[clamp(17px,1.3vw,20px)] leading-normal text-pretty">{item.answer}</p>
					{item.link &&
						("to" in item.link ? (
							<Link to={item.link.to} className={linkClass}>
								{item.link.label} <span aria-hidden="true">→</span>
							</Link>
						) : (
							<a href={item.link.href} className={linkClass}>
								{item.link.label} <span aria-hidden="true">→</span>
							</a>
						))}
				</div>
			</div>
		</details>
	);
}

/**
 * 09 Questions: the answers people look for before they start, as folded notes. Opening a question circles its number
 * in pencil, underlines it and unfolds the answer; only one stays open. The same answers go out as FAQPage structured
 * data, so search engines and assistants can quote them.
 */
export function Faq() {
	const questions = useQuestions();
	const structuredData = {
		"@context": "https://schema.org",
		"@type": "FAQPage",
		mainEntity: questions.map((item) => ({
			"@type": "Question",
			name: item.question,
			acceptedAnswer: { "@type": "Answer", text: item.answer },
		})),
	};

	return (
		<section
			id="faq"
			data-scene={SCENE.faq}
			aria-labelledby="faq-title"
			className="relative mx-auto grid max-w-[1440px] items-start gap-x-16 gap-y-10 border-t border-line px-(--gutter) pt-[12vh] pb-[14vh] min-[900px]:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]"
		>
			<Doodle
				name="note"
				wipe="clamp(0, (var(--p) - .3) / .2, 1)"
				className="start-[4vw] bottom-[8vh] w-[11vw] translate-y-[calc(var(--p)*-30px)] rotate-[-6deg] max-[900px]:hidden"
			/>

			<div className="flex flex-col gap-[22px] min-[900px]:sticky min-[900px]:top-[14vh]">
				<span className={cn(labelClass, "text-ink-3")}>{t`Questions`}</span>
				<h2
					id="faq-title"
					className="font-anybody text-[clamp(48px,5.6vw,100px)] leading-[.98] font-light tracking-[-.03em] text-ink"
				>
					<Trans>
						Asked and <em className="font-display font-normal text-accent-text italic">answered.</em>
					</Trans>
				</h2>
				<p className="max-w-[24em] font-display text-[clamp(17px,1.4vw,21px)] leading-normal text-pretty text-ink-2">
					<Trans>
						The short answers to what people ask before they start. Anything else, ask on{" "}
						<a
							href="https://discord.gg/aSyA5ZSxpb"
							className="text-accent-text italic underline underline-offset-[3px] transition-colors hover:text-accent-hover"
						>
							Discord
						</a>
						.
					</Trans>
				</p>
			</div>

			<div className="border-t border-line">
				{questions.map((item, index) => (
					<FaqItem key={item.id} item={item} index={index} />
				))}
			</div>

			{/* oxlint-disable-next-line react/no-danger -- structured data, serialized so no answer can close the script. */}
			<script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredData) }} />
		</section>
	);
}
