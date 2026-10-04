import type { IconName } from "@reactive-resume/ui/components/icon";
import type { CSSProperties } from "react";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { templateSchema } from "@reactive-resume/schema/templates";
import { Icon } from "@reactive-resume/ui/components/icon";
import { localeSchema } from "@reactive-resume/utils/locale";
import { cn } from "@reactive-resume/utils/style";
import { prefersReducedMotion, SCENE, useLanding } from "./scroll";
import { CtaLink, Doodle, labelClass } from "./ui";
import { orpc } from "@/libs/orpc/client";

const crowdinUrl = "https://crowdin.com/project/reactive-resume";
const githubUrl = "https://github.com/reactive-resume/reactive-resume";
// The statistics service caches the totals for six hours.
const statisticsStaleTime = 6 * 60 * 60 * 1000;

type RollingNumberProps = { value: number; roll: boolean; delay: number };

/** A total whose digits roll up into place, one column per digit, in the locale's own digits. */
function RollingNumber({ value, roll, delay }: RollingNumberProps) {
	const { i18n } = useLingui();
	const text = i18n.number(value);
	const digits = Array.from({ length: 10 }, (_, digit) => i18n.number(digit));

	return (
		<>
			<span className="sr-only">{text}</span>
			<span aria-hidden="true" dir="ltr" className="inline-flex">
				{Array.from(text).map((character, index) => {
					const digit = digits.indexOf(character);
					return (
						<span key={index} className="inline-block h-[1em] overflow-hidden">
							<span
								className="flex translate-y-[calc(var(--offset)*1em)] flex-col transition-transform duration-[2s] ease-[cubic-bezier(.2,.8,.2,1)] starting:translate-y-0"
								style={
									{
										"--offset": roll ? -Math.max(0, digit) : 0,
										transitionDelay: `${delay + index * 80}ms`,
									} as CSSProperties
								}
							>
								{digit === -1 ? (
									<span className="h-[1em] leading-none">{character}</span>
								) : (
									digits.map((glyph) => (
										<span key={glyph} className="h-[1em] leading-none">
											{glyph}
										</span>
									))
								)}
							</span>
						</span>
					);
				})}
			</span>
		</>
	);
}

/** 06 Numbers: the live community totals. */
export function Numbers() {
	const inView = useLanding((state) => state.numbersInView);
	const { data } = useQuery(orpc.statistics.getTotals.queryOptions({ staleTime: statisticsStaleTime }));
	const { data: stars } = useQuery(
		orpc.statistics.github.getStarCount.queryOptions({ staleTime: statisticsStaleTime }),
	);
	const rows = [
		{ label: t`People using it`, detail: t`writing, tailoring and sending`, value: data?.users },
		{ label: t`Resumes created`, detail: t`and counting`, value: data?.resumes },
		{ label: t`Stars on GitHub`, detail: t`from developers who back it`, value: stars },
	];

	return (
		<section
			data-scene={SCENE.numbers}
			aria-labelledby="numbers-title"
			className="relative mx-auto max-w-[1440px] px-(--gutter) pt-[18vh] pb-[10vh]"
		>
			<h2 id="numbers-title" className={cn(labelClass, "text-ink-3")}>
				{t`In good company`}
			</h2>
			<dl className="mt-[22px]">
				{rows.map((row, index) => (
					<div
						key={row.label}
						className="flex flex-wrap items-end justify-between gap-x-10 gap-y-3 border-t border-line py-[3.2vh]"
					>
						<dt className="flex flex-col gap-1.5 pb-[1.2vh]">
							<span className={cn(labelClass, "text-ink-3")}>{row.label}</span>
							<span className="font-display text-[clamp(18px,1.6vw,24px)] leading-[1.3] text-ink-2 italic">
								{row.detail}
							</span>
						</dt>
						<dd className="font-anybody text-[clamp(56px,7.5vw,136px)] leading-none font-light tracking-[-.03em] text-ink tabular-nums">
							{row.value == null ? (
								<span className="text-ink-3">
									<span aria-hidden="true">—</span>
									<span className="sr-only">{t`Loading the total`}</span>
								</span>
							) : (
								<RollingNumber value={row.value} roll={inView} delay={index * 150} />
							)}
						</dd>
					</div>
				))}
			</dl>
			<p className="border-t border-line pt-3.5 font-ui text-[13px] text-ink-3">{t`Live totals, refreshed every 6 hours.`}</p>
		</section>
	);
}

/** The word for "résumé" in sixteen languages, each in its own script and direction, whatever the page's locale. */
const words = [
	{ word: "Résumé", language: "Français", lang: "fr" },
	{ word: "Lebenslauf", language: "Deutsch", lang: "de" },
	{ word: "Currículum", language: "Español", lang: "es" },
	{ word: "履歴書", language: "日本語", lang: "ja" },
	{ word: "Życiorys", language: "Polski", lang: "pl" },
	{ word: "السيرة الذاتية", language: "العربية", lang: "ar", dir: "rtl" },
	{ word: "Currículo", language: "Português", lang: "pt" },
	{ word: "简历", language: "中文", lang: "zh" },
	{ word: "Özgeçmiş", language: "Türkçe", lang: "tr" },
	{ word: "Резюме", language: "Русский", lang: "ru" },
	{ word: "이력서", language: "한국어", lang: "ko" },
	{ word: "קורות חיים", language: "עברית", lang: "he", dir: "rtl" },
	{ word: "Životopis", language: "Čeština", lang: "cs" },
	{ word: "Βιογραφικό", language: "Ελληνικά", lang: "el" },
	{ word: "बायोडाटा", language: "हिन्दी", lang: "hi" },
	{ word: "Curriculum", language: "Italiano", lang: "it" },
];

/** 07 Languages. The word turns over every 1.9s while the section is near; it can be paused. */
export function Languages() {
	const { i18n } = useLingui();
	const languageCount = i18n.number(localeSchema.options.length - 1);
	const near = useLanding((state) => state.activeScene >= SCENE.numbers && state.activeScene <= SCENE.support);
	const reducedMotion = useLanding((state) => state.reducedMotion);
	const [index, setIndex] = useState(0);
	const [paused, setPaused] = useState(false);
	const current = words[index % words.length] ?? words[0];
	const previous = words[(index - 1) % words.length];

	useEffect(() => {
		if (!near || paused || prefersReducedMotion()) return;
		const timer = window.setInterval(() => setIndex((value) => value + 1), 1900);
		return () => window.clearInterval(timer);
	}, [near, paused, reducedMotion]);

	return (
		<section
			data-scene={SCENE.languages}
			aria-labelledby="languages-title"
			className="relative flex flex-col items-center gap-[22px] overflow-hidden px-(--gutter) py-[14vh] text-center"
		>
			<Doodle
				name="globe"
				wipe="clamp(0, (var(--p) - .25) / .2, 1)"
				className="start-[6vw] top-[10vh] w-[11vw] translate-y-[calc(var(--p)*-40px)] rotate-[-6deg] max-[900px]:hidden"
			/>
			<h2 id="languages-title" className={cn(labelClass, "text-ink-3")}>
				{t`Speaks your language`}
			</h2>
			<div
				aria-hidden="true"
				className="font-anybody h-[1.25em] w-full overflow-hidden text-[clamp(48px,7.5vw,140px)] leading-[1.25] font-light tracking-[-.03em] text-ink"
			>
				<div
					key={index}
					className={cn(index > 0 && "motion-safe:animate-language-turn [transform:translateY(-1.25em)]")}
				>
					{previous && (
						<div lang={previous.lang} dir={previous.dir} className="h-[1.25em] whitespace-nowrap">
							{previous.word}
						</div>
					)}
					<div lang={current?.lang} dir={current?.dir} className="h-[1.25em] whitespace-nowrap">
						{current?.word}
					</div>
				</div>
			</div>
			<div className="flex items-center gap-2">
				<span
					lang={current?.lang}
					className="font-martian text-[12px] leading-[1.4] font-medium tracking-[.1em] text-accent-text"
				>
					{current?.language}
				</span>
				<button
					type="button"
					onClick={() => setPaused((value) => !value)}
					aria-label={paused ? t`Play the list of languages` : t`Pause the list of languages`}
					className="grid size-6 place-items-center rounded-full text-ink-3 transition-colors hover:bg-hover hover:text-ink motion-reduce:hidden"
				>
					<Icon name={paused ? "play_arrow" : "pause"} size={16} filled />
				</button>
			</div>
			<p className="mt-3 max-w-[30em] font-display text-[clamp(17px,1.4vw,21px)] leading-normal text-pretty text-ink-2">
				<a
					href={crowdinUrl}
					className="text-accent-text italic underline underline-offset-[3px] transition-colors hover:text-accent-hover"
				>
					{t`Translated into ${languageCount} languages. Help translate it into yours.`}
				</a>
			</p>
		</section>
	);
}

const pillLinkClass =
	"flex h-10 items-center gap-2 rounded-full border border-line-2 px-3.5 font-medium font-ui text-ink text-sm transition-colors hover:bg-hover";
const receiptButtonClass =
	"flex h-[42px] items-center justify-between rounded-md px-3.5 font-semibold text-sm transition-colors";

/** 08 Support: the case for donations, printed as a receipt that totals nothing. */
export function Support() {
	const { i18n } = useLingui();
	// oxlint-disable-next-line react/purity -- The receipt shows the current calendar date on each render, including after midnight.
	const receiptDate = new Date();
	const nothing = i18n.number(0, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
	const templates = i18n.number(templateSchema.options.length);
	const none = t({
		message: "none",
		comment: "Receipt line amount for something Reactive Resume doesn't have, e.g. ads.",
	});
	const lineItems = [
		[t`Resume builder`, nothing],
		[t`Templates × ${templates}`, nothing],
		[t`Assistant (your key)`, nothing],
		[t`ATS checker`, nothing],
		[t`Job tracker`, nothing],
		[t`Cover letters`, nothing],
		[t`Ads`, none],
		[t`Tracking`, none],
	] as const;
	const pills: { href: string; icon: IconName; label: string }[] = [
		{ href: crowdinUrl, icon: "translate", label: t`Translate the app` },
		{ href: `${githubUrl}/issues`, icon: "bug_report", label: t`Report a bug` },
		{ href: "https://docs.rxresu.me/contributing/development", icon: "code", label: t`Contribute code` },
	];

	return (
		<section
			id="support"
			data-scene={SCENE.support}
			aria-labelledby="support-title"
			className="relative mx-auto grid max-w-[1440px] grid-cols-[repeat(auto-fit,minmax(min(100%,440px),1fr))] items-start gap-16 border-t border-line px-(--gutter) pt-[12vh] pb-[16vh]"
		>
			<Doodle
				name="jar"
				wipe="clamp(0, (var(--p) - .3) / .2, 1)"
				className="start-[3vw] bottom-[4vh] w-[9vw] translate-y-[calc(var(--p)*-30px)] rotate-[4deg] max-[900px]:hidden"
			/>

			<div className="flex flex-col gap-[22px] pt-[4vh]">
				<span className={cn(labelClass, "text-ink-3")}>{t`Support`}</span>
				<h2
					id="support-title"
					className="font-anybody text-[clamp(48px,5.6vw,100px)] leading-[.98] font-light tracking-[-.03em] text-ink"
				>
					<Trans>
						Keep it <em className="font-display font-normal text-accent-text italic">free.</em>
					</Trans>
				</h2>
				<p className="max-w-[28em] font-display text-[clamp(17px,1.4vw,21px)] leading-normal text-pretty text-ink-2">
					{t`Reactive Resume is open source under the MIT License. Amruth Pillai and a community of contributors keep it running, and donations pay for hosting and development. There are 0 paid tiers.`}
				</p>
				<ul className="flex flex-wrap gap-2">
					{pills.map((pill) => (
						<li key={pill.href}>
							<a href={pill.href} className={pillLinkClass}>
								<Icon name={pill.icon} size={18} className="text-ink-2" />
								{pill.label}
							</a>
						</li>
					))}
				</ul>
			</div>

			<div className="flex w-[min(100%,400px)] flex-col items-center justify-self-center">
				<div
					aria-hidden="true"
					className="relative z-2 h-[18px] w-[calc(100%+36px)] rounded-[9px] bg-ink shadow-[inset_0_-4px_0_oklch(0_0_0/.35),0_6px_14px_-6px_oklch(0_0_0/.4)]"
				>
					<span className="absolute inset-x-[18px] top-2 h-[3px] rounded-[2px] bg-[oklch(0_0_0/.6)]" />
				</div>
				<div className="-mx-3 -mt-[9px] box-content w-full overflow-hidden px-3 pb-10">
					<div className="[transform:translateY(calc((1-clamp(0,var(--p)*1.7-.15,1))*-100%))] drop-shadow-[0_18px_24px_oklch(0.2_0.01_95/.22)] [transition:transform_.4s_linear]">
						<div className="receipt-paper font-receipt bg-[#fdfcf8] px-[26px] pt-[30px] pb-[46px] text-[14px] leading-[1.75] font-medium text-[oklch(0.25_0.01_95)]">
							<div className="mb-4 flex flex-col gap-0.5 text-center">
								<b className="text-[18px] leading-[1.1] font-bold tracking-[-.01em]">REACTIVE RESUME</b>
								<span className="text-[oklch(0.5_0.01_95)]">{t`A free and open-source resume builder`}</span>
								<span className="text-[oklch(0.5_0.01_95)] uppercase">
									{i18n.date(receiptDate, { day: "2-digit", month: "short", year: "numeric" })}
								</span>
							</div>
							<dl className="grid grid-cols-[1fr_auto] gap-x-3.5 border-t-[1.5px] border-dashed border-[oklch(0.7_0.01_95)] pt-2.5">
								{lineItems.map(([item, amount]) => (
									<div key={item} className="contents">
										<dt className="capitalize">{item}</dt>
										<dd>{amount}</dd>
									</div>
								))}
							</dl>
							<p className="mt-2.5 flex justify-between border-t-[1.5px] border-dashed border-[oklch(0.7_0.01_95)] pt-2.5 text-base font-bold">
								<span className="uppercase">{t`Total`}</span>
								<span>{i18n.number(0, { style: "currency", currency: "USD" })}</span>
							</p>
							<p className="mt-2.5 border-t-[1.5px] border-dashed border-[oklch(0.7_0.01_95)] pt-3 text-[oklch(0.4_0.01_95)]">
								{t`Hosting and development are paid for by people like you. Optional tip:`}
							</p>
							<div className="mt-2.5 flex flex-col gap-1.5">
								<a
									href="https://github.com/sponsors/AmruthPillai"
									className={cn(
										receiptButtonClass,
										"bg-[oklch(0.22_0.01_95)] text-white hover:bg-[oklch(0.32_0.01_95)]",
									)}
								>
									GitHub Sponsors
									<Icon name="arrow_outward" size={19} />
								</a>
								<a
									href="https://opencollective.com/reactive-resume/donate"
									className={cn(
										receiptButtonClass,
										"border border-[oklch(0.82_0.008_95)] text-[oklch(0.22_0.01_95)] hover:bg-[oklch(0.96_0.005_95)]",
									)}
								>
									Open Collective
									<Icon name="arrow_outward" size={19} />
								</a>
							</div>
							<div aria-hidden="true" className="receipt-barcode mx-auto mt-[18px] mb-1.5 h-11 w-[78%]" />
							<p className="text-center text-[oklch(0.5_0.01_95)]">{t`Thank you for keeping it free.`}</p>
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}

/** 10 Closing call to action. */
export function Closing() {
	return (
		<section
			aria-labelledby="closing-title"
			className="relative mx-auto flex max-w-[1440px] flex-col items-center gap-7 border-t border-line px-(--gutter) pt-[16vh] pb-[18vh] text-center"
		>
			<span className={cn(labelClass, "text-ink-3")}>{t`Your turn`}</span>
			<h2
				id="closing-title"
				className="font-anybody text-[clamp(48px,6vw,108px)] leading-none font-light tracking-[-.03em] text-balance text-ink"
			>
				<Trans>
					Put it all on <em className="font-display font-normal text-accent-text italic">one page.</em>
				</Trans>
			</h2>
			<p className="max-w-[28em] font-display text-[clamp(17px,1.4vw,21px)] leading-normal text-pretty text-ink-2">
				{t`Start from scratch or import what you have. It takes a few minutes, and you can come back to it anytime. Start with 1 resume.`}
			</p>
			<CtaLink size="closing" />
		</section>
	);
}
