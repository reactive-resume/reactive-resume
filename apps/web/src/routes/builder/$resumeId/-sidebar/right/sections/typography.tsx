import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { getFont, sortFontWeights } from "@reactive-resume/fonts";
import { Chip } from "@/components/calm/filter-bar";
import { List } from "@/components/calm/list-row";
import { FontFamilyCombobox } from "@/components/typography/combobox";
import { getNextWeights } from "@/components/typography/get-next-weights";
import { DesignHeading, Field, Stepper, SwitchListRow } from "@/features/resume/editor/design/fields";
import { useDesign } from "@/features/resume/editor/design/style-groups";

export function TypographySectionBuilder() {
	const { metadata, write } = useDesign();
	if (!metadata) return null;
	return (
		<div className="grid gap-0">
			{(["body", "heading"] as const).map((prefix) => {
				const value = metadata.typography[prefix];
				const weights = sortFontWeights(getFont(value.fontFamily)?.weights ?? ["400"]);
				return (
					<section key={prefix} className="grid gap-0">
						<DesignHeading className={prefix === "body" ? "pt-[18px]" : "pt-[22px]"}>
							{prefix === "body" ? <Trans>Body</Trans> : <Trans>Headings</Trans>}
						</DesignHeading>
						<Field label={<Trans>Font</Trans>} htmlFor={`font-${prefix}`}>
							<FontFamilyCombobox
								id={`font-${prefix}`}
								value={value.fontFamily}
								onValueChange={(family) => {
									if (!family) return;
									write(
										`${prefix}.font`,
										(draft) => {
											draft.typography[prefix].fontFamily = family;
											const next = getNextWeights(family, prefix === "heading");
											if (next) draft.typography[prefix].fontWeights = next;
										},
										true,
									);
								}}
							/>
						</Field>
						<Field
							className="mt-3"
							label={prefix === "body" ? <Trans>Weights</Trans> : <Trans>Weight</Trans>}
							help={
								weights.length === 1
									? t`${value.fontFamily} has one weight`
									: prefix === "body"
										? t`${value.fontWeights[0] ?? "400"} for text, ${value.fontWeights.at(-1) ?? "700"} for bold`
										: undefined
							}
						>
							<div
								role="group"
								aria-label={prefix === "body" ? t`Body weights` : t`Heading weight`}
								className="flex flex-wrap gap-1.5"
							>
								{weights.map((weight) => (
									<Chip
										key={weight}
										pressed={value.fontWeights.includes(weight)}

										onClick={() => {
											const next =
												prefix === "heading"
													? [weight]
													: value.fontWeights.includes(weight)
														? value.fontWeights.filter((entry) => entry !== weight)
														: sortFontWeights([...value.fontWeights, weight]);
											if (next.length)
												write(
													`${prefix}.weights`,
													(draft) => {
														draft.typography[prefix].fontWeights = next;
													},
													true,
												);
										}}
									>
										{weight}
									</Chip>
								))}
							</div>
						</Field>
						<div className="mt-3 grid grid-cols-2 gap-3">
							<Field
								label={<Trans>Size</Trans>}
								help={prefix === "body" ? <Trans>10 to 11 reads best</Trans> : undefined}
								htmlFor={`size-${prefix}`}
							>
								<Stepper
									id={`size-${prefix}`}
									label={t`Size`}
									decrease={prefix === "body" ? t`Smaller body text` : t`Smaller headings`}
									increase={prefix === "body" ? t`Larger body text` : t`Larger headings`}
									value={value.fontSize}
									min={6}
									max={24}
									step={0.1}
									unit="pt"
									onStep={(next) =>
										write(
											`${prefix}.size`,
											(draft) => {
												draft.typography[prefix].fontSize = next;
											},
											true,
										)
									}
									onValueChange={(next) =>
										write(`${prefix}.size`, (draft) => {
											draft.typography[prefix].fontSize = next;
										})
									}
								/>
							</Field>
							<Field label={<Trans>Line height</Trans>} htmlFor={`line-${prefix}`}>
								<Stepper
									id={`line-${prefix}`}
									label={t`Line height`}
									decrease={prefix === "body" ? t`Tighter body lines` : t`Tighter heading lines`}
									increase={prefix === "body" ? t`Looser body lines` : t`Looser heading lines`}
									value={value.lineHeight}
									min={0.5}
									max={4}
									step={0.05}
									onStep={(next) =>
										write(
											`${prefix}.lineHeight`,
											(draft) => {
												draft.typography[prefix].lineHeight = next;
											},
											true,
										)
									}
									onValueChange={(next) =>
										write(`${prefix}.lineHeight`, (draft) => {
											draft.typography[prefix].lineHeight = next;
										})
									}
								/>
							</Field>
						</div>
					</section>
				);
			})}
			<List cap className="mt-3.5">
				<SwitchListRow
					wrap
					tall
					label={t`Hyphenation`}
					description={t`Breaks long words between syllables, using the language set in Page.`}
					checked={metadata.typography.hyphenation === true}
					onCheckedChange={(checked) =>
						write(
							"hyphenation",
							(draft) => {
								draft.typography.hyphenation = checked;
							},
							true,
						)
					}
				/>
			</List>
		</div>
	);
}
