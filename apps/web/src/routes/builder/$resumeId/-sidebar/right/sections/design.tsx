import type { ReactNode } from "react";
import type z from "zod";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useState } from "react";
import { colorDesignSchema } from "@reactive-resume/schema/resume/data";
import { FormControl, FormItem, FormLabel, FormMessage } from "@reactive-resume/ui/components/form";
import { Input } from "@reactive-resume/ui/components/input";
import { ColorPicker } from "@/components/input/color-picker";
import { useCurrentResume, useUpdateResumeData } from "@/features/resume/builder/draft";
import { wellClassName } from "@/features/resume/editor/design/fields";
import { hexToRgba, normalizeHex, rgbaToHex } from "@/features/resume/editor/design/presets";
import { useSyncFormValues } from "@/hooks/use-sync-form-values";
import { useAppForm } from "@/libs/tanstack-form";

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
