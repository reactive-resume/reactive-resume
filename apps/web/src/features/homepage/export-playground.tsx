import type { Template } from "@reactive-resume/schema/templates";
import type { CSSProperties } from "react";
import { i18n } from "@lingui/core";
import { msg, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { ArrowDownIcon, ArrowUpRightIcon } from "@phosphor-icons/react";
import { useId, useMemo, useState } from "react";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { toast } from "@reactive-resume/ui/components/toast";
import { useResumeExport } from "@/features/resume/export/use-resume-export";
import { resolveLocale } from "@/libs/locale";

// Shared by every button inside the playground (press feedback, busy state, focus ring).
const buttonState =
	"active:not-disabled:transform-[scale(0.98)] disabled:cursor-wait disabled:opacity-55 focus-visible:outline-2 focus-visible:outline-(--home-ink) focus-visible:outline-offset-4 focus-visible:transition-none motion-reduce:active:transform-none";

type ExportPlaygroundProps = {
	name: string;
	accent: string;
	typeface: "sans" | "serif";
	template: Template;
};

export function buildExportSample({ name, accent, typeface, template }: ExportPlaygroundProps, locale = i18n.locale) {
	const data = structuredClone(defaultResumeData);
	data.basics = {
		...data.basics,
		name: name.trim() || "Alex Morgan",
		headline: t`Product designer`,
		email: "alex@example.com",
		location: "London, UK",
	};
	data.picture.hidden = true;
	data.summary.title = t`Summary`;
	data.summary.content = t`<p>I design software for teams, from early research to the details people use every day.</p>`;
	data.sections.experience.title = t`Experience`;
	data.sections.experience.items = [
		{
			id: "sample-experience",
			hidden: false,
			company: "Northstar Studio",
			position: t`Senior product designer`,
			location: "London, UK",
			period: t`2022 - Present`,
			website: { url: "", label: "", inlineLink: false },
			roles: [],
			description: t`<ul><li>Led research and interface design for a collaborative planning tool.</li><li>Built a shared component library with engineers and documented accessibility patterns.</li><li>Tested prototypes with customers and used their feedback to simplify onboarding.</li></ul>`,
		},
		{
			id: "sample-experience-previous",
			hidden: false,
			company: "Form & Field",
			position: t`Product designer`,
			location: "Bristol, UK",
			period: "2019 - 2022",
			website: { url: "", label: "", inlineLink: false },
			roles: [],
			description: t`<ul><li>Designed responsive websites and mobile experiences for small businesses.</li><li>Worked with developers from first sketches through release.</li></ul>`,
		},
	];
	data.sections.education.title = t`Education`;
	data.sections.education.items = [
		{
			id: "sample-education",
			hidden: false,
			school: "University of the West of England",
			degree: t`BA`,
			area: t`Graphic Design`,
			grade: "",
			location: "Bristol, UK",
			period: "2015 - 2019",
			website: { url: "", label: "", inlineLink: false },
			description: "",
		},
	];
	data.sections.skills.title = t`Skills`;
	data.sections.skills.items = [
		{
			id: "sample-skills",
			hidden: false,
			icon: "",
			iconColor: "",
			name: t`Design`,
			proficiency: "",
			level: 0,
			keywords: [t`User research`, t`Interaction design`, t`Prototyping`, t`Design systems`, t`Accessibility`],
		},
	];
	data.metadata.template = template;
	data.metadata.page.locale = resolveLocale(locale);
	data.metadata.design.colors.primary = accent;
	data.metadata.typography.body.fontFamily = typeface === "sans" ? "Helvetica" : "Times-Roman";
	data.metadata.typography.heading.fontFamily = data.metadata.typography.body.fontFamily;
	data.metadata.typography.body.fontWeights = ["400", "700"];
	data.metadata.typography.heading.fontWeights = ["700"];
	data.metadata.layout.pages = [
		{ fullWidth: false, main: ["summary", "experience", "education"], sidebar: ["skills"] },
	];
	return data;
}

const formats = [
	{
		id: "pdf",
		label: "PDF",
		extension: ".pdf",
		description: msg`Keep your layout intact. Ready to send, upload, or print.`,
		note: msg`For your next application`,
		downloadLabel: msg`Download sample PDF`,
		color: "#dbb5a1",
	},
	{
		id: "docx",
		label: "Word",
		extension: ".docx",
		description: msg`Keep editing in Word, Google Docs, or Pages. Layout may differ from the PDF.`,
		note: msg`For a few more edits`,
		downloadLabel: msg`Download sample DOCX`,
		color: "#a7bddd",
	},
	{
		id: "md",
		label: "Markdown",
		extension: ".md",
		description: msg`Your words as a plain-text document, with headings, lists, and links.`,
		note: msg`For your words, anywhere`,
		downloadLabel: msg`Download sample Markdown`,
		color: "#b7c5ad",
	},
	{
		id: "json",
		label: "JSON",
		extension: ".json",
		description: msg`Keep a backup of your content and settings. Import it into Reactive Resume later.`,
		note: msg`For keeping a copy`,
		downloadLabel: msg`Download sample JSON`,
		color: "#c6b7d7",
	},
] as const;

export default function ExportPlayground({ name, accent, typeface, template }: ExportPlaygroundProps) {
	const { i18n } = useLingui();
	const [format, setFormat] = useState<(typeof formats)[number]["id"]>("pdf");
	const [busy, setBusy] = useState(false);
	const descriptionId = useId();
	const data = useMemo(
		() => buildExportSample({ name, accent, typeface, template }, i18n.locale),
		[name, accent, typeface, template, i18n.locale],
	);
	const { onDownloadPDF, onDownloadDOCX, onDownloadMarkdown, onDownloadJSON } = useResumeExport({
		name: t`${data.basics.name} Sample Resume`,
		slug: "sample-resume",
		data,
	});
	const selected = formats.find((item) => item.id === format) ?? formats[0];
	// A Map rather than an object literal: static analysis flags computed member access as object injection,
	// even though `format` is a closed union set only from `formats`.
	const actions = new Map<typeof format, () => void | Promise<void>>([
		["pdf", onDownloadPDF],
		["docx", onDownloadDOCX],
		["md", onDownloadMarkdown],
		["json", onDownloadJSON],
	]);

	const download = async () => {
		setBusy(true);
		try {
			await actions.get(format)?.();
		} catch {
			toast.add({ type: "error", description: t`Could not prepare the sample. Please try again.` });
		} finally {
			setBusy(false);
		}
	};

	return (
		<div
			className="group grid grid-cols-[1.1fr_1fr] items-center gap-[clamp(32px,7vw,104px)] text-(--home-ink) max-[700px]:grid-cols-1 max-[700px]:gap-[10px]"
			data-format={format}
			style={{ "--home-export-color": selected.color } as CSSProperties}
		>
			<div
				className="perspective-[1000px] grid justify-items-center px-[30px] pt-[44px] pb-4 max-[700px]:pt-[35px]"
				aria-hidden="true"
			>
				<div className="transform-3d transform-[rotate(-7deg)_rotateY(-12deg)] group-data-[format=docx]:transform-[rotate(-3deg)_rotateY(8deg)] group-data-[format=json]:transform-[rotate(7deg)_rotateY(9deg)] group-data-[format=md]:transform-[rotate(4deg)_rotateY(-7deg)] motion-reduce:transform-[rotate(-4deg)] relative aspect-[0.76] w-[min(100%,285px)] [transition:transform_280ms_var(--ease-out-strong)] group-has-focus-visible:transition-none max-[700px]:w-[225px]">
					<div className="transform-[translate(-26px,21px)_rotate(-10deg)] absolute inset-0 rounded border border-[#535154] bg-[#242427]" />
					<div className="transform-[translate(-14px,10px)_rotate(-5deg)] absolute inset-0 rounded border border-[#535154] bg-[#383739]" />
					<div className="absolute inset-0 flex flex-col overflow-hidden rounded bg-(--home-export-color) p-[25px] text-[#29272c] shadow-[1px_1px_0_#ffffff60_inset,0_24px_48px_#00000050] max-[700px]:p-5">
						<div className="absolute top-0 right-0 size-8 rounded-bl bg-[#ffffff40] shadow-[-2px_3px_4px_#0000000f]" />
						<div className="flex items-center justify-between gap-3 pr-1.5 font-medium text-[10px]">
							<span>Reactive Resume</span>
							<ArrowUpRightIcon size={18} />
						</div>
						<div className="wrap-anywhere mt-8 font-semibold text-[23px] leading-[1.2] max-[700px]:mt-[25px] max-[700px]:text-[20px]">
							{data.basics.name}
							<span className="mt-[5px] block font-normal text-[11px]">
								<Trans>Product designer</Trans>
							</span>
						</div>
						<div className="mt-[21px] grid gap-1.5">
							<i className="h-0.5 bg-current opacity-20" />
							<i className="h-0.5 w-[91%] bg-current opacity-20" />
							<i className="h-0.5 bg-current opacity-20" />
							<i className="h-0.5 w-[62%] bg-current opacity-20" />
						</div>
						<div className="mt-auto pt-[14px] pb-[15px] font-[ui-monospace,monospace] text-[length:clamp(42px,6vw,72px)] leading-none tracking-[-0.08em] max-[700px]:text-[55px]">
							{selected.extension}
						</div>
						<div className="flex items-center justify-between gap-3 border-[#29272c30] border-t pt-2.5 font-medium text-[10px] max-[700px]:text-[8px]">
							<span>
								<Trans>Sample resume</Trans>
							</span>
							<ArrowDownIcon size={20} />
						</div>
					</div>
				</div>
				<p className="mt-[45px] text-center text-(--home-muted) text-[13px] max-[700px]:mt-[37px]">
					{i18n._(selected.note)}
				</p>
			</div>
			<div className="py-5">
				<fieldset className="grid border-(--home-line) border-t" aria-label={t`Sample download format`}>
					{formats.map((item) => (
						<button
							key={item.id}
							type="button"
							className={`group flex min-h-16 w-full items-center gap-[17px] border-(--home-line) border-b py-3 pr-[15px] pl-2 text-left text-(--home-muted) text-[17px] [transition:color_160ms_ease,background-color_160ms_ease,transform_120ms_var(--ease-out-strong)] hover:not-disabled:bg-[#ffffff08] hover:not-disabled:text-(--home-ink) aria-pressed:bg-[#ffffff04] aria-pressed:text-(--home-ink) aria-pressed:hover:not-disabled:bg-[#ffffff08] ${buttonState}`}
							aria-pressed={format === item.id}
							disabled={busy}
							onClick={() => setFormat(item.id)}
						>
							<span
								className="grid h-[37px] min-w-[43px] place-items-center rounded-[3px_4px_3px_3px] border border-current font-[ui-monospace,monospace] text-[10px] opacity-80"
								aria-hidden="true"
							>
								{item.extension}
							</span>
							<span>{item.label}</span>
							<span
								className="ml-auto size-[9px] rounded-full border border-[#67676b] group-aria-pressed:border-(--home-export-color) group-aria-pressed:bg-(--home-export-color) group-aria-pressed:shadow-[0_0_0_4px_#ffffff05]"
								aria-hidden="true"
							/>
						</button>
					))}
				</fieldset>
				<p
					className="my-[25px] min-h-12 text-(--home-muted) text-[15px] leading-[1.6] max-[700px]:min-h-0"
					id={descriptionId}
				>
					{i18n._(selected.description)}
				</p>
				<button
					type="button"
					className={`flex min-h-14 w-full items-center justify-between gap-5 rounded border border-transparent bg-(--home-export-color) px-5 py-4 font-[550] text-[#252329] text-[15px] [transition:transform_120ms_var(--ease-out-strong),opacity_160ms_ease] hover:not-disabled:opacity-90 ${buttonState}`}
					disabled={busy}
					aria-describedby={descriptionId}
					onClick={() => void download()}
				>
					<span>{busy ? <Trans>Preparing sample…</Trans> : i18n._(selected.downloadLabel)}</span>
					<ArrowDownIcon aria-hidden="true" size={19} />
				</button>
				<p className="mt-[13px] text-(--home-muted) text-[12px] leading-[1.6]">
					<Trans>Uses the name, template, color, and type you chose above.</Trans>
				</p>
			</div>
		</div>
	);
}
