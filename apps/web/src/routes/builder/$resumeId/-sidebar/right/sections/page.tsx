import type { DensityId, MarginId } from "@/features/resume/editor/design/presets";
import type { DateFormat } from "@reactive-resume/schema/resume/dates";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { InputGroup, InputGroupAddon, InputGroupText } from "@reactive-resume/ui/components/input-group";
import { SegmentedControl, SegmentedControlItem } from "@reactive-resume/ui/components/segmented-control";
import { SwitchRow } from "@reactive-resume/ui/components/switch";
import { NumberInput } from "@/components/input/number-input";
import { Combobox } from "@/components/ui/combobox";
import { getLocaleOptions } from "@/features/locale/locale-options";
import { applyDensity, applyMargins, matchDensity, matchMargins } from "@/features/resume/editor/design/presets";
import { useDesign } from "@/features/resume/editor/design/style-groups";

const DATE_FORMATS = (): { value: DateFormat; label: string }[] => [
	{ value: "short", label: t`Mar 2022` },
	{ value: "long", label: t`March 2022` },
	{ value: "numeric", label: "03/2022" },
	{ value: "iso", label: "2022-03" },
];

export function PageSectionBuilder() {
	const { metadata, write } = useDesign();
	if (!metadata) return null;
	const { page } = metadata;
	const margin = matchMargins(metadata);
	const density = matchDensity(metadata);
	const numbers = (names: readonly ("marginX" | "marginY" | "gapX" | "gapY")[], labels: string[]) => (
		<div className="grid grid-cols-2 gap-2">
			{names.map((name, index) => (
				<InputGroup key={name} className="h-9">
					<InputGroupAddon>
						<InputGroupText className="t-caption">{labels[index]}</InputGroupText>
					</InputGroupAddon>
					<NumberInput
						aria-label={labels[index]}
						className="min-w-0 px-1 text-end font-mono text-xs"
						value={page[name]}
						min={0}
						max={name.startsWith("margin") ? 100 : undefined}
						step={1}
						onValueChange={(next) =>
							write(name, (draft) => {
								draft.page[name] = next;
							})
						}
					/>
					<InputGroupAddon align="inline-end">
						<InputGroupText>pt</InputGroupText>
					</InputGroupAddon>
				</InputGroup>
			))}
		</div>
	);
	return (
		<div className="grid gap-3.5 pt-3.5 pb-6">
			<div className="grid gap-1.5">
				<span className="t-small font-medium">
					<Trans>Paper</Trans>
				</span>
				<SegmentedControl
					aria-label={t`Paper`}
					className="w-full"
					value={page.format}
					onValueChange={(value) =>
						write(
							"format",
							(draft) => {
								draft.page.format = value as typeof page.format;
							},
							true,
						)
					}
				>
					<SegmentedControlItem value="letter">
						<Trans context="US Letter paper size (8.5 × 11 in), shown beside A4">Letter</Trans>
					</SegmentedControlItem>
					<SegmentedControlItem value="a4">A4</SegmentedControlItem>
					<SegmentedControlItem value="free-form">
						<Trans>Free-form</Trans>
					</SegmentedControlItem>
				</SegmentedControl>
			</div>
			<div className="grid gap-2">
				<span className="t-small font-medium">
					<Trans>Margins</Trans>
				</span>
				<SegmentedControl
					aria-label={t`Margins`}
					className="w-full"
					value={margin ?? ""}
					onValueChange={(value) => write("margins", (draft) => applyMargins(draft, value as MarginId), true)}
				>
					<SegmentedControlItem value="narrow">
						<Trans>Narrow</Trans>
					</SegmentedControlItem>
					<SegmentedControlItem value="normal">
						<Trans>Normal</Trans>
					</SegmentedControlItem>
					<SegmentedControlItem value="wide">
						<Trans>Wide</Trans>
					</SegmentedControlItem>
				</SegmentedControl>
				{numbers(["marginX", "marginY"], [t`Left and right`, t`Top and bottom`])}
			</div>
			<div className="grid gap-2">
				<div className="flex items-center justify-between gap-2">
					<span className="t-small font-medium">
						<Trans>Density</Trans>
					</span>
					<span className="t-caption text-ink-3">
						<Trans>Also sets body line height, now {metadata.typography.body.lineHeight}</Trans>
					</span>
				</div>
				<SegmentedControl
					aria-label={t`Density`}
					className="w-full"
					value={density ?? ""}
					onValueChange={(value) => write("density", (draft) => applyDensity(draft, value as DensityId), true)}
				>
					<SegmentedControlItem value="compact">
						<Trans>Compact</Trans>
					</SegmentedControlItem>
					<SegmentedControlItem value="normal">
						<Trans>Normal</Trans>
					</SegmentedControlItem>
					<SegmentedControlItem value="roomy">
						<Trans>Roomy</Trans>
					</SegmentedControlItem>
				</SegmentedControl>
				{numbers(["gapY", "gapX"], [t`Between sections`, t`Between columns`])}
			</div>
			<h3 className="pt-1.5 t-section-title">
				<Trans>Language and dates</Trans>
			</h3>
			<div className="grid gap-1.5">
				<label htmlFor="page-language" className="t-small font-medium">
					<Trans>Language</Trans>
				</label>
				<Combobox
					id="page-language"
					options={getLocaleOptions()}
					value={page.locale}
					onValueChange={(value) => {
						if (value)
							write(
								"locale",
								(draft) => {
									draft.page.locale = value;
								},
								true,
							);
					}}
				/>
				<p className="t-caption text-ink-3">
					<Trans>Sets section titles, date words and text direction. Your content isn't translated.</Trans>
				</p>
			</div>
			<div className="grid gap-1.5">
				<span className="t-small font-medium">
					<Trans>Date format</Trans>
				</span>
				<SegmentedControl
					aria-label={t`Date format`}
					value={page.dateFormat ?? "short"}
					className="w-full [&_button]:px-1"
					onValueChange={(value) =>
						write(
							"dateFormat",
							(draft) => {
								draft.page.dateFormat = value as DateFormat;
							},
							true,
						)
					}
				>
					{DATE_FORMATS().map((format) => (
						<SegmentedControlItem key={format.value} value={format.value}>
							{format.label}
						</SegmentedControlItem>
					))}
				</SegmentedControl>
			</div>
			<h3 className="pt-1.5 t-section-title">
				<Trans>Icons and links</Trans>
			</h3>
			<div>
				{(
					[
						{
							name: "hideIcons",
							label: t`Icons in the contact line`,
							description: t`Also on skills, profiles and interests`,
						},
						{ name: "hideSectionIcons", label: t`Icons beside section titles` },
						{ name: "hideLinkUnderline", label: t`Underline links` },
					] as const
				).map((option) => (
					<SwitchRow
						key={option.name}
						label={option.label}
						description={"description" in option ? option.description : undefined}
						checked={!page[option.name]}
						onCheckedChange={(checked) =>
							write(
								option.name,
								(draft) => {
									draft.page[option.name] = !checked;
								},
								true,
							)
						}
					/>
				))}
			</div>
		</div>
	);
}
