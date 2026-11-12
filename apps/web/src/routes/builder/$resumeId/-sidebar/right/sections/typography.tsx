import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { getFont, sortFontWeights } from "@reactive-resume/fonts";
import { Icon } from "@reactive-resume/ui/components/icon";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupText,
	InputGroupButton,
} from "@reactive-resume/ui/components/input-group";
import { SwitchRow } from "@reactive-resume/ui/components/switch";
import { Chip } from "@/components/calm/filter-bar";
import { NumberInput } from "@/components/input/number-input";
import { FontFamilyCombobox } from "@/components/typography/combobox";
import { getNextWeights } from "@/components/typography/get-next-weights";
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
						<h3 className={`pb-2 t-section-title ${prefix === "body" ? "pt-[18px]" : "pt-[22px]"}`}>
							{prefix === "body" ? <Trans>Body</Trans> : <Trans>Headings</Trans>}
						</h3>
						<div className="grid gap-1.5">
							<label htmlFor={`font-${prefix}`} className="t-small font-medium">
								<Trans>Font</Trans>
							</label>
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
						</div>
						<div className="mt-3 grid gap-1.5">
							<div className="flex items-baseline justify-between gap-2 t-small font-medium">
								{prefix === "body" ? <Trans>Weights</Trans> : <Trans>Weight</Trans>}
								<span className="t-caption text-ink-3">
									{weights.length === 1
										? t`${value.fontFamily} has one weight`
										: prefix === "body"
											? t`${value.fontWeights[0] ?? "400"} for text, ${value.fontWeights.at(-1) ?? "700"} for bold`
											: null}
								</span>
							</div>
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
						</div>
						<div className="mt-3 grid grid-cols-2 gap-3">
							<div className="grid gap-1.5">
								<label className="t-small font-medium" htmlFor={`size-${prefix}`}>
									<Trans>Size</Trans>
								</label>
								<InputGroup className="h-9">
									<InputGroupAddon>
										<InputGroupButton
											variant="ghost"
											size="icon-xs"
											aria-label={prefix === "body" ? t`Smaller body text` : t`Smaller headings`}
											disabled={value.fontSize <= 6}
											onClick={() =>
												write(
													`${prefix}.size`,
													(draft) => {
														draft.typography[prefix].fontSize = Math.max(6, Number((value.fontSize - 0.1).toFixed(1)));
													},
													true,
												)
											}
										>
											<Icon name="minus" size={16} />
										</InputGroupButton>
									</InputGroupAddon>
									<NumberInput
										className="[appearance:textfield] px-0 text-center font-mono text-xs [&::-webkit-inner-spin-button]:appearance-none"
										id={`size-${prefix}`}
										value={value.fontSize}
										min={6}
										max={24}
										step={0.1}
										onValueChange={(next) =>
											write(`${prefix}.size`, (draft) => {
												draft.typography[prefix].fontSize = next;
											})
										}
									/>
									<InputGroupAddon align="inline-end">
										<InputGroupText>pt</InputGroupText>
										<InputGroupButton
											variant="ghost"
											size="icon-xs"
											aria-label={prefix === "body" ? t`Larger body text` : t`Larger headings`}
											disabled={value.fontSize >= 24}
											onClick={() =>
												write(
													`${prefix}.size`,
													(draft) => {
														draft.typography[prefix].fontSize = Math.min(24, Number((value.fontSize + 0.1).toFixed(1)));
													},
													true,
												)
											}
										>
											<Icon name="plus" size={16} />
										</InputGroupButton>
									</InputGroupAddon>
								</InputGroup>
							</div>
							<div className="grid gap-1.5">
								<label className="t-small font-medium" htmlFor={`line-${prefix}`}>
									<Trans>Line height</Trans>
								</label>
								<InputGroup className="h-9">
									<InputGroupAddon>
										<InputGroupButton
											variant="ghost"
											size="icon-xs"
											aria-label={prefix === "body" ? t`Tighter body lines` : t`Tighter heading lines`}
											disabled={value.lineHeight <= 0.5}
											onClick={() =>
												write(
													`${prefix}.lineHeight`,
													(draft) => {
														draft.typography[prefix].lineHeight = Math.max(
															0.5,
															Number((value.lineHeight - 0.05).toFixed(2)),
														);
													},
													true,
												)
											}
										>
											<Icon name="minus" size={16} />
										</InputGroupButton>
									</InputGroupAddon>
									<NumberInput
										className="[appearance:textfield] px-0 text-center font-mono text-xs [&::-webkit-inner-spin-button]:appearance-none"
										id={`line-${prefix}`}
										value={value.lineHeight}
										min={0.5}
										max={4}
										step={0.05}
										onValueChange={(next) =>
											write(`${prefix}.lineHeight`, (draft) => {
												draft.typography[prefix].lineHeight = next;
											})
										}
									/>
									<InputGroupAddon align="inline-end">
										<InputGroupButton
											variant="ghost"
											size="icon-xs"
											aria-label={prefix === "body" ? t`Looser body lines` : t`Looser heading lines`}
											disabled={value.lineHeight >= 4}
											onClick={() =>
												write(
													`${prefix}.lineHeight`,
													(draft) => {
														draft.typography[prefix].lineHeight = Math.min(
															4,
															Number((value.lineHeight + 0.05).toFixed(2)),
														);
													},
													true,
												)
											}
										>
											<Icon name="plus" size={16} />
										</InputGroupButton>
									</InputGroupAddon>
								</InputGroup>
							</div>
						</div>
					</section>
				);
			})}
			<SwitchRow
				className="mt-3.5"
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
		</div>
	);
}
