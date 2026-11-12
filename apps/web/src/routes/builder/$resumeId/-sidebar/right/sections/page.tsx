import type { DensityId, MarginId } from "@/features/resume/editor/design/presets";
import type { DateFormat } from "@reactive-resume/schema/resume/dates";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { SegmentedControl, SegmentedControlItem } from "@reactive-resume/ui/components/segmented-control";
import { cn } from "@reactive-resume/utils/style";
import { List } from "@/components/calm/list-row";
import { Combobox } from "@/components/ui/combobox";
import { getLocaleOptions } from "@/features/locale/locale-options";
import { DesignHeading, Field, Help, PointField, SwitchListRow } from "@/features/resume/editor/design/fields";
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
		<div className="mt-0.5 grid grid-cols-2 gap-2">
			{names.map((name, index) => (
				<PointField
					key={name}
					label={labels[index] ?? name}
					value={page[name]}
					min={0}
					max={name.startsWith("margin") ? 100 : undefined}
					onValueChange={(next) =>
						write(name, (draft) => {
							draft.page[name] = next;
						})
					}
				/>
			))}
		</div>
	);
	return (
		<div className="flex flex-col pt-3.5 pb-6">
			<Field label={<Trans>Paper</Trans>}>
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
			</Field>
			<Field label={<Trans>Margins</Trans>} className="mt-3.5">
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
			</Field>
			<Field
				label={<Trans>Density</Trans>}
				help={<Trans>Also sets body line height, now {metadata.typography.body.lineHeight}</Trans>}
				className="mt-3.5"
			>
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
			</Field>
			<DesignHeading>
				<Trans>Language and dates</Trans>
			</DesignHeading>
			<Field label={<Trans>Language</Trans>} htmlFor="page-language">
				<Combobox
					id="page-language"
					options={getLocaleOptions()}
					value={page.locale}
					render={(props) => (
						<Button
							{...props}
							variant="secondary"
							className={cn(
								"h-10 justify-start bg-raised px-3 text-start font-normal shadow-[inset_0_0_0_1px_var(--control-border)] hover:bg-raised",
								props.className,
							)}
						>
							<Icon name="translate" className="text-ink-3" />
							{props.children}
						</Button>
					)}
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
				<Help>
					<Trans>Sets section titles, date words and text direction. Your own text isn't translated.</Trans>
				</Help>
			</Field>
			<Field label={<Trans>Date format</Trans>} className="mt-3">
				<SegmentedControl
					aria-label={t`Date format`}
					value={page.dateFormat ?? "short"}
					className="w-full [&_[data-slot=segmented-control-item]]:px-1.5"
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
			</Field>
			<DesignHeading>
				<Trans>Icons and links</Trans>
			</DesignHeading>
			<List>
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
					<SwitchListRow
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
			</List>
		</div>
	);
}
