import type { ReactNode } from "react";
import type z from "zod";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useSelector } from "@tanstack/react-form";
import { useState } from "react";
import { colorDesignSchema, levelDesignSchema } from "@reactive-resume/schema/resume/data";
import { resolveLevelDisplaySizes } from "@reactive-resume/schema/resume/level-display-sizes";
import { FormControl, FormItem, FormLabel, FormMessage } from "@reactive-resume/ui/components/form";
import { Input } from "@reactive-resume/ui/components/input";
import { Separator } from "@reactive-resume/ui/components/separator";
import { SectionBase } from "../shared/section-base";
import { ColorPicker } from "@/components/input/color-picker";
import { IconPicker } from "@/components/input/icon-picker";
import { LevelTypeCombobox } from "@/components/level/combobox";
import { LevelDisplay } from "@/components/level/display";
import { useCurrentResume, useUpdateResumeData } from "@/features/resume/builder/draft";
import { wellClassName } from "@/features/resume/editor/design/fields";
import { hexToRgba, normalizeHex, rgbaToHex } from "@/features/resume/editor/design/presets";
import { useSyncFormValues } from "@/hooks/use-sync-form-values";
import { useAppForm } from "@/libs/tanstack-form";

export function DesignSectionBuilder() {
	return (
		<SectionBase type="design" className="space-y-6">
			<ColorSectionForm />
			<Separator />
			<LevelSectionForm />
		</SectionBase>
	);
}

type ColorValues = z.infer<typeof colorDesignSchema>;

function useColorSectionForm(colors: ColorValues, persist: (data: ColorValues) => void) {
	const form = useAppForm({
		defaultValues: colors,
		validators: { onChange: colorDesignSchema },
		listeners: {
			onChange: ({ formApi }) => {
				persist(formApi.state.values);
			},
		},
	});
	useSyncFormValues(form, colors);
	return form;
}

type ColorSectionForm = ReturnType<typeof useColorSectionForm>;

export function ColorSectionForm({ includePrimary = true }: { includePrimary?: boolean }) {
	const resume = useCurrentResume();
	const colors = resume.data.metadata.design.colors;
	const updateResumeData = useUpdateResumeData();

	const persist = (data: ColorValues) => {
		updateResumeData((draft) => {
			draft.metadata.design.colors = data;
		});
	};

	const form = useColorSectionForm(colors, persist);

	return (
		<div className={includePrimary ? "space-y-4" : "grid grid-cols-2 gap-3"}>
			{includePrimary && <ColorFormField form={form} name="primary" label={<Trans>Primary color</Trans>} />}
			<ColorFormField form={form} name="text" label={<Trans>Text</Trans>} />
			<ColorFormField form={form} name="background" label={<Trans>Background</Trans>} />
		</div>
	);
}

type ColorFormFieldProps = {
	form: ColorSectionForm;
	name: keyof ColorValues;
	label: ReactNode;
};

/** An opaque colour reads as hex, as Color shows it; one with transparency keeps its rgba(). */
const displayColor = (value: string) => {
	const alpha = /rgba\([^)]*,\s*([\d.]+)\s*\)/i.exec(value)?.[1];
	return alpha === undefined || Number(alpha) === 1 ? (rgbaToHex(value) ?? value) : value;
};

function ColorFormField({ form, name, label }: ColorFormFieldProps) {
	const [typed, setTyped] = useState<string | null>(null);
	return (
		<form.Field name={name}>
			{(field) => (
				<FormItem className="gap-1.5" hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
					<FormLabel>{label}</FormLabel>
					<div className="flex items-center gap-2">
						<ColorPicker
							aria-label={
								name === "text"
									? t`Pick the text color`
									: name === "background"
										? t`Pick the background color`
										: t`Choose accent color`
							}
							compact
							popupLabel={
								name === "text" ? t`Text color` : name === "background" ? t`Background color` : t`Accent color`
							}
							className={wellClassName}
							value={field.state.value}
							onChange={(color) => {
								field.handleChange(color);
							}}
						/>
						<FormControl
							render={
								<Input
									name={field.name}
									value={typed ?? displayColor(field.state.value)}
									className="font-mono text-[13px]/4 font-medium"
									onBlur={() => {
										setTyped(null);
										field.handleBlur();
									}}
									onChange={(e) => {
										const value = e.target.value;
										setTyped(value);
										const hex = normalizeHex(value);
										if (hex) field.handleChange(hexToRgba(hex));
										else if (/^rgba?\(/i.test(value.trim())) field.handleChange(value);
									}}
								/>
							}
						/>
					</div>
					<FormMessage errors={field.state.meta.errors} />
				</FormItem>
			)}
		</form.Field>
	);
}

type LevelValues = z.infer<typeof levelDesignSchema>;
type LevelType = LevelValues["type"];

export function LevelSectionForm() {
	const resume = useCurrentResume();
	const colors = resume.data.metadata.design.colors;
	const levelDesign = resume.data.metadata.design.level;
	const updateResumeData = useUpdateResumeData();

	const persist = (data: LevelValues) => {
		updateResumeData((draft) => {
			draft.metadata.design.level = data;
		});
	};

	const form = useAppForm({
		defaultValues: levelDesign,
		validators: { onChange: levelDesignSchema },
		listeners: {
			onChange: ({ formApi }) => {
				persist(formApi.state.values);
			},
		},
	});
	useSyncFormValues(form, levelDesign);

	const previewType = useSelector(form.store, (s) => s.values.type);
	const previewIcon = useSelector(form.store, (s) => s.values.icon);
	const { decorationSize, levelIconExplicitSize } = resolveLevelDisplaySizes({
		bodyFontSize: resume.data.metadata.typography.body.fontSize,
	});

	return (
		<div className="space-y-4">
			<h4 className="text-lg leading-none font-semibold tracking-tight">
				<Trans>Level</Trans>
			</h4>

			<div
				style={{ "--page-primary-color": colors.primary, backgroundColor: colors.background } as React.CSSProperties}
				className="flex items-center justify-center rounded-md p-6"
			>
				<LevelDisplay
					level={3}
					type={previewType}
					icon={previewIcon}
					decorationSizePx={decorationSize}
					iconSizePx={levelIconExplicitSize}
					className="w-full max-w-[220px] justify-center"
				/>
			</div>

			<div className="flex items-center gap-2">
				<form.Field name="icon">
					{(field) => (
						<FormItem className="shrink-0" hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
							<FormLabel>
								<Trans>Icon</Trans>
							</FormLabel>
							<FormControl
								render={
									<IconPicker
										size="icon"
										value={field.state.value}
										onChange={(value) => {
											field.handleChange(value);
										}}
									/>
								}
							/>
						</FormItem>
					)}
				</form.Field>

				<form.Field name="type">
					{(field) => (
						<FormItem className="flex-1" hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
							<FormLabel>
								<Trans>Type</Trans>
							</FormLabel>
							<FormControl
								render={
									<LevelTypeCombobox
										value={field.state.value}
										onValueChange={(value) => {
											if (!value) return;
											field.handleChange(value as LevelType);
										}}
									/>
								}
							/>
						</FormItem>
					)}
				</form.Field>
			</div>
		</div>
	);
}
