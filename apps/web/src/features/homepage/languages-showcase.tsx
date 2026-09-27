import type { Locale } from "@reactive-resume/utils/locale";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { ArrowUpRightIcon, CheckIcon, DownloadSimpleIcon, PlusIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { cn } from "@reactive-resume/utils/style";
import { changeLocale, isLocale, isRTL, localeMap, resolveLocale } from "@/libs/locale";
import { section, sectionHeading, sectionText, sectionTitle, textLink, wrap } from "./classes";
import "./languages-showcase.css";

const featuredLocales = [
	{ locale: "en-US", name: "English" },
	{ locale: "de-DE", name: "Deutsch" },
	{ locale: "fr-FR", name: "Français" },
	{ locale: "es-ES", name: "Español" },
	{ locale: "pt-BR", name: "Português" },
	{ locale: "ar-SA", name: "العربية" },
	{ locale: "ja-JP", name: "日本語" },
	{ locale: "hi-IN", name: "हिन्दी" },
] satisfies { locale: Locale; name: string }[];

// A locale name can exist before its catalog ships. Only offer files the app can load.
const availableLocales = Object.keys(import.meta.glob("../../../locales/*.po"))
	.map((path) => path.split("/").at(-1)?.replace(/\.po$/, "") ?? "")
	.filter(isLocale);

const wordClass = "animate-[home-language-appear_190ms_ease-out_both] group-data-[instant=true]/languages:animate-none";
const headingClass = `${wordClass} mb-[15px] font-semibold text-[13px] leading-[1.6] wrap-anywhere`;
const paperClass =
	"language-paper relative mx-auto w-full max-w-[440px] rotate-2 rounded border border-[#e0dcd5] bg-[#efede7] font-[Arial,Noto_Sans,sans-serif] text-[#29272b] text-start shadow-[4px_5px_0_#d5d0c8,5px_6px_0_#77716b,11px_16px_0_-4px_#b9b1a7,10px_28px_42px_#0005]";
const optionClass =
	"group/option flex min-h-[62px] items-center justify-between gap-2 rounded border border-[#454345] bg-[#222224] px-[17px] py-[14px] text-[#e3dfda] text-[clamp(16px,1.6vw,21px)] shadow-[0_3px_0_#101011] transition-[background-color,color,translate,box-shadow] duration-[160ms] ease-[ease] hover:not-aria-pressed:-translate-y-[2px] hover:not-aria-pressed:bg-[#343031] hover:not-aria-pressed:shadow-[0_5px_0_#101011] focus-visible:outline-2 focus-visible:outline-offset-[5px] focus-visible:outline-(--home-accent) active:translate-y-[2px] active:shadow-[0_1px_0_#101011] aria-pressed:translate-y-[2px] aria-pressed:border-[#d0b9a5] aria-pressed:bg-[#d0b9a5] aria-pressed:text-[#24201d] aria-pressed:shadow-[0_1px_0_#101011] group-data-[instant=true]/languages:transition-none max-[420px]:min-h-[56px] max-[420px]:px-[11px] max-[420px]:py-[10px] max-[420px]:text-[16px]";

type LinesProps = { count: 2 | 3; className?: string };

function Lines({ count, className }: LinesProps) {
	return (
		<div className={cn("grid gap-[7px]", className)} aria-hidden="true">
			<i className="block h-1 w-[51%] bg-[#9d9183]" />
			{count === 3 && <i className="block h-1 bg-[#d2ccc3]" />}
			<i className="block h-1 w-[79%] bg-[#d2ccc3]" />
		</div>
	);
}

export default function LanguagesShowcase() {
	const { i18n } = useLingui();
	const selectedLocale = resolveLocale(i18n.locale);
	const [instant, setInstant] = useState(false);

	return (
		<section
			className={cn(section, wrap, "group/languages")}
			id="languages"
			aria-labelledby="languages-title"
			data-instant={instant}
			onClickCapture={(event) => setInstant(event.detail === 0)}
		>
			<div className={sectionHeading}>
				<h2 id="languages-title" className={sectionTitle}>
					<Trans>
						A little more
						<br />
						at home.
					</Trans>
				</h2>
				<p className={sectionText}>
					<Trans>
						Use the app in a language you’re comfortable with. Try a few of the translations made by the community.
					</Trans>
				</p>
			</div>
			<div className="grid grid-cols-[0.9fr_1.1fr] items-center gap-[clamp(32px,6vw,88px)] rounded border border-(--home-line) bg-[#19191b] p-[clamp(24px,5vw,64px)] shadow-[inset_0_1px_0_#ffffff05] max-[760px]:grid-cols-1 max-[760px]:gap-3 max-[420px]:px-4 max-[420px]:pt-[22px] max-[420px]:pb-[25px]">
				<div className="min-w-0 max-[760px]:mx-auto max-[760px]:w-full max-[760px]:max-w-[460px]">
					<p className="mb-[26px] text-(--home-ink) text-[17px]">
						<Trans>Pick a language. See it on the page.</Trans>
					</p>
					<fieldset
						className="grid min-w-0 grid-cols-2 gap-[10px] max-[420px]:gap-2"
						aria-label={t`Choose app language`}
					>
						{featuredLocales
							.filter(({ locale }) => availableLocales.includes(locale))
							.map(({ locale, name }) => (
								<button
									key={locale}
									type="button"
									className={optionClass}
									aria-label={name}
									aria-pressed={selectedLocale === locale}
									onClick={() => changeLocale(locale)}
								>
									<bdi lang={locale}>{name}</bdi>
									<CheckIcon
										className="shrink-0 opacity-0 group-aria-pressed/option:opacity-100"
										size={16}
										aria-hidden="true"
									/>
								</button>
							))}
					</fieldset>
					<p className="mt-6 max-w-[31ch] text-(--home-muted) text-[13px] leading-[1.6] max-[760px]:max-w-none">
						<Trans>Your choice applies across the app.</Trans>
					</p>
				</div>
				<div className="relative min-w-0 px-2 pt-3 max-[760px]:mx-auto max-[760px]:w-full max-[760px]:max-w-[430px] max-[760px]:px-[6px] max-[760px]:pt-2">
					<div className={paperClass} lang={selectedLocale} dir={isRTL(selectedLocale) ? "rtl" : "ltr"}>
						<div className="flex min-h-[56px] items-center gap-[9px] border-b border-b-[#d8d3cb] px-[17px] py-[10px] text-[12px] max-[420px]:gap-[6px] max-[420px]:p-[10px] max-[420px]:text-[10px]">
							<img className="shrink-0" src="/icon/light.svg" alt="Reactive Resume" width="25" height="25" />
							<span className={wordClass}>
								<Trans>Resumes</Trans>
							</span>
							<div className="ms-auto flex items-center gap-[5px] text-[#62594f] text-[10px] max-[420px]:gap-[3px] max-[420px]:text-[9px]">
								<DownloadSimpleIcon className="shrink-0 max-[420px]:hidden" size={14} aria-hidden="true" />
								<span className={wordClass}>
									<Trans>Download</Trans>
								</span>
							</div>
						</div>
						<div className="p-[clamp(23px,3vw,40px)] max-[420px]:px-5 max-[420px]:py-[23px]">
							<p className="font-[Georgia,Times_New_Roman,serif] text-[clamp(26px,3vw,36px)] tracking-[-0.06em]">
								<bdi>Alex Morgan</bdi>
							</p>
							<div className="mt-[13px] mb-7 flex gap-[11px]" aria-hidden="true">
								<i className="block h-[3px] w-[23%] bg-[#c5bfb6]" />
								<i className="block h-[3px] w-[36%] bg-[#c5bfb6]" />
							</div>
							<div>
								<h3
									className={`${wordClass} wrap-anywhere mb-[15px] font-normal text-[clamp(22px,3vw,34px)] leading-[1.6] tracking-[-0.035em]`}
								>
									<Trans>Experience</Trans>
								</h3>
								<Lines count={3} className="mb-[23px]" />
								<Lines count={3} className="mb-[23px]" />
							</div>
							<div className="grid grid-cols-[1.2fr_1fr] gap-[27px] border-t border-t-[#d6d0c6] pt-[15px] max-[420px]:gap-[18px]">
								<div>
									<h3 className={headingClass}>
										<Trans>Education</Trans>
									</h3>
									<Lines count={2} />
								</div>
								<div>
									<h3 className={headingClass}>
										<Trans>Skills</Trans>
									</h3>
									<Lines count={2} />
								</div>
							</div>
						</div>
					</div>
					<p className="mt-[31px] text-center text-(--home-muted) text-[11px] leading-[1.5]">
						{i18n._(localeMap[selectedLocale])}
						<span aria-hidden="true"> · </span>
						<Trans>App language</Trans>
					</p>
				</div>
			</div>
			<div className="grid grid-cols-[1fr_auto] items-start gap-10 pt-[25px] max-[760px]:grid-cols-1 max-[760px]:gap-[22px]">
				<details className="group/all min-w-0">
					<summary className="flex min-h-[44px] w-fit cursor-pointer list-none items-center justify-between gap-5 py-[5px] text-(--home-ink) text-[14px] focus-visible:outline-(--home-accent) focus-visible:outline-2 focus-visible:outline-offset-[5px] [&::-webkit-details-marker]:hidden">
						<Trans>Show all languages</Trans>
						<PlusIcon
							className="transition-transform duration-[180ms] ease-[ease-out] group-open/all:rotate-45 group-data-[instant=true]/languages:transition-none"
							size={18}
							aria-hidden="true"
						/>
					</summary>
					<fieldset
						className="mt-[23px] grid min-w-0 grid-cols-3 gap-x-3 gap-y-1 group-data-[instant=false]/languages:group-open/all:animate-[home-language-unfold_220ms_ease-out_both] max-[420px]:grid-cols-2"
						aria-label={t`All app languages`}
					>
						{availableLocales.map((locale) => (
							<button
								key={locale}
								type="button"
								className="min-h-[44px] rounded-[3px] border border-transparent bg-transparent px-[10px] py-[9px] text-start text-(--home-muted) text-[13px] leading-[1.5] hover:bg-[#242225] hover:text-(--home-ink) focus-visible:outline-(--home-accent) focus-visible:outline-2 focus-visible:outline-offset-[5px] aria-pressed:border-[#756253] aria-pressed:bg-[#211e1c] aria-pressed:text-[#d0b9a5] aria-pressed:hover:bg-[#242225] aria-pressed:hover:text-(--home-ink)"
								aria-pressed={selectedLocale === locale}
								onClick={() => changeLocale(locale)}
							>
								{i18n._(localeMap[locale])}
							</button>
						))}
					</fieldset>
				</details>
				<a href="https://crowdin.com/project/reactive-resume" className={cn(textLink, "mt-[5px]")}>
					<Trans>Help translate the app</Trans>
					<ArrowUpRightIcon size={17} aria-hidden="true" />
				</a>
			</div>
		</section>
	);
}
