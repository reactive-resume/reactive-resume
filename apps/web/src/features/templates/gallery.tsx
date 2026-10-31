import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Link } from "@tanstack/react-router";
import { templateLayouts, templateSchema } from "@reactive-resume/schema/templates";
import { cn } from "@reactive-resume/utils/style";
import { templates } from "@/dialogs/resume/template/data";
import { LandingBackground } from "@/features/homepage/background";
import { CtaLink, Doodle, labelClass } from "@/features/homepage/ui";

const linkClass = "text-accent-text underline underline-offset-4 transition-colors hover:text-accent-hover";

/** The template gallery, on the homepage's desk: its grain and window light, paper shadows, type and French curve. */
export function TemplateGallery() {
	const { i18n } = useLingui();
	const count = i18n.number(templateSchema.options.length);

	return (
		<div className="landing relative isolate overflow-x-clip bg-bg font-ui text-ink">
			<LandingBackground />
			<main id="main-content" className="relative px-5 pt-28 pb-16 sm:px-8">
				<div className="relative mx-auto max-w-6xl">
					<Doodle
						name="curve"
						wipe="1"
						sizes="(min-width: 900px) 14vw, 1px"
						className="end-0 top-4 w-[clamp(140px,14vw,220px)] rotate-[8deg] max-[900px]:hidden"
					/>

					<div className="relative max-w-3xl">
						<h1 className="font-anybody text-[clamp(40px,6vw,80px)] leading-[1.02] font-light tracking-[-.03em] text-balance">
							{t`${count} free resume templates. Find your fit.`}
						</h1>
						<p className="mt-6 max-w-2xl font-display text-[clamp(17px,1.4vw,21px)] leading-normal text-pretty text-ink-2">
							{t`Compare real resume layouts before you sign up. Every template is free to customize, with PDF and Word downloads and no watermark.`}
						</p>

						<div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-4">
							<CtaLink size="hero" />
							<a
								href="https://docs.rxresu.me/guides/choosing-a-template"
								className={cn(linkClass, "inline-flex min-h-11 items-center")}
							>
								{t`How to choose a template`}
							</a>
						</div>
						<p className="mt-3 text-sm text-ink-3">
							{t`Create a free account, then choose your template in Design. Switch layouts anytime without rewriting your content.`}
						</p>

						<section aria-labelledby="layout-advice" className="mt-10 max-w-2xl">
							<h2 id="layout-advice" className={cn(labelClass, "text-ink-3")}>
								{t`One column or two?`}
							</h2>
							<p className="mt-2 font-display text-[clamp(17px,1.4vw,21px)] leading-normal text-pretty text-ink-2">
								{t`One-column templates give hiring software a simple top-to-bottom reading order. Two-column templates put supporting details in a sidebar and leave more room for visual hierarchy. Choose for your content, then check the exported PDF.`}
							</p>
							<p className="mt-2 text-sm text-ink-3">
								<Link to="/ats-checker" className={linkClass}>
									{t`Check your resume’s ATS readability`}
								</Link>{" "}
								{t`Readability does not guarantee an interview or a particular ATS result.`}
							</p>
						</section>
					</div>

					<div className="mt-16 grid gap-x-8 gap-y-14 sm:grid-cols-2 lg:grid-cols-3">
						{templateSchema.options.map((id, index) => {
							const template = templates[id];
							const name = template.name;
							const layout = templateLayouts[id];
							return (
								<article key={id} id={id} className="scroll-mt-24">
									<a
										href={`/templates/pdf/${id}.pdf`}
										aria-label={t`Preview ${name} sample PDF`}
										className="mx-auto block w-full max-w-74.5 rounded-sm focus-visible:outline-offset-4"
									>
										<img
											src={`/templates/thumb/${id}.webp`}
											srcSet={`/templates/thumb/${id}-small.webp 300w, /templates/thumb/${id}.webp 596w`}
											sizes="298px"
											alt={t`${name} resume template preview`}
											width={298}
											height={420}
											// The first row is on the first screen, and the first preview is its largest paint.
											loading={index < 3 ? "eager" : "lazy"}
											fetchPriority={index === 0 ? "high" : "auto"}
											decoding="async"
											className="aspect-[298/420] w-full rounded-sm bg-paper object-contain shadow-paper dark:brightness-[.93]"
										/>
									</a>
									<h2 className="font-anybody mt-6 text-[32px] leading-tight font-light tracking-[-.02em]">{name}</h2>
									<p className={cn(labelClass, "mt-1 text-ink-3")}>
										{layout.columns === 1 ? t`One column` : t`Two columns`}
									</p>
									<p className="mt-3 font-display text-[17px] leading-[1.45] text-pretty text-ink-2">
										{i18n._(template.description)}
									</p>
									<a
										href={`/templates/pdf/${id}.pdf`}
										download={`${name}-resume-example.pdf`}
										className={cn(linkClass, "mt-2 inline-flex min-h-11 items-center text-sm font-semibold")}
										aria-label={t`Download ${name} sample PDF`}
									>
										{t`Download sample PDF`}
									</a>
								</article>
							);
						})}
					</div>

					<section
						className="mt-20 flex flex-col items-start gap-5 border-t border-line pt-10"
						aria-labelledby="make-it-yours"
					>
						<h2
							id="make-it-yours"
							className="font-anybody text-[clamp(36px,4vw,56px)] leading-[1.02] font-light tracking-[-.03em] text-balance"
						>
							{t`Make it yours, then take it with you.`}
						</h2>
						<p className="max-w-[34em] font-display text-[clamp(17px,1.4vw,21px)] leading-normal text-pretty text-ink-2">
							{t`Adjust fonts, colors, spacing and sections in the resume builder. Export your finished resume to PDF or Word, or share a link. The PDFs above are examples to help you compare designs.`}
						</p>
						<CtaLink size="closing" />
					</section>
				</div>
			</main>
		</div>
	);
}
