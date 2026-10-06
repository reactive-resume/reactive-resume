import type { ReactNode } from "react";
import type z from "zod";
import { Trans } from "@lingui/react/macro";
import { useSelector } from "@tanstack/react-form";
import { typographySchema } from "@reactive-resume/schema/resume/data";
import { FormControl, FormDescription, FormItem, FormLabel, FormMessage } from "@reactive-resume/ui/components/form";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
	InputGroupText,
} from "@reactive-resume/ui/components/input-group";
import { Separator } from "@reactive-resume/ui/components/separator";
import { Switch } from "@reactive-resume/ui/components/switch";
import { SectionBase } from "../shared/section-base";
import { FontFamilyCombobox, FontWeightCombobox } from "@/components/typography/combobox";
import { getNextWeights } from "@/components/typography/get-next-weights";
import { useCurrentResume, useUpdateResumeData } from "@/features/resume/builder/draft";
import { useSyncFormValues } from "@/hooks/use-sync-form-values";
import { useAppForm } from "@/libs/tanstack-form";

export function TypographySectionBuilder() {
	return (
		<SectionBase type="typography">
			<TypographySectionForm />
		</SectionBase>
	);
}

const formSchema = typographySchema;

type FormValues = z.infer<typeof formSchema>;
type FontWeight = FormValues["body"]["fontWeights"][number];
type TypographyPrefix = "body" | "heading";

function useTypographyForm(typography: FormValues, persist: (data: FormValues) => void) {
	const form = useAppForm({
		defaultValues: typography,
		validators: { onChange: formSchema },
		onSubmit: ({ value }) => {
			persist(value);
		},
	});
	useSyncFormValues(form, typography);
	return form;
}

type TypographyForm = ReturnType<typeof useTypographyForm>;

function TypographySectionForm() {
	const resume = useCurrentResume();
	const typography = resume.data.metadata.typography;
	const updateResumeData = useUpdateResumeData();

	const persist = (data: FormValues) => {
		updateResumeData((draft) => {
			draft.metadata.typography.body = data.body;
			draft.metadata.typography.heading = data.heading;
			if (data.hyphenation !== undefined) draft.metadata.typography.hyphenation = data.hyphenation;
		});
	};

	const form = useTypographyForm(typography, persist);

	const handleAutoSave = () => {
		persist(form.state.values);
	};

	return (
		<form
			className="grid grid-cols-1 gap-4 @md:grid-cols-2"
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				void form.handleSubmit();
			}}
		>
			<TypographyFieldGroup label={<Trans context="Body Text (paragraphs, lists, etc.)">Body</Trans>} />
			<TypographyGroupFields form={form} prefix="body" handleAutoSave={handleAutoSave} />
			<TypographyFieldGroup label={<Trans context="Headings or Titles (H1, H2, H3, H4, H5, H6)">Heading</Trans>} />
			<TypographyGroupFields form={form} prefix="heading" handleAutoSave={handleAutoSave} />
			<form.Field name="hyphenation">
				{(field) => (
					<FormItem className="col-span-full mt-2">
						<div className="flex items-center gap-x-3">
							<FormControl
								render={
									<Switch
										checked={field.state.value === true}
										onCheckedChange={(checked) => {
											field.handleChange(checked);
											handleAutoSave();
										}}
									/>
								}
							/>
							<FormLabel>
								<Trans>Hyphenation</Trans>
							</FormLabel>
						</div>
						<FormDescription>
							<Trans>Breaks long words between syllables, using the language set in Page.</Trans>
						</FormDescription>
					</FormItem>
				)}
			</form.Field>
		</form>
	);
}

type TypographyGroupFieldsProps = {
	form: TypographyForm;
	prefix: TypographyPrefix;
	handleAutoSave: () => void;
};

function TypographyGroupFields({ form, prefix, handleAutoSave }: TypographyGroupFieldsProps) {
	const fontFamily = useSelector(form.store, (s) => s.values[prefix].fontFamily);

	return (
		<>
			<form.Field name={`${prefix}.fontFamily`}>
				{(field) => (
					<FormItem
						className="col-span-full"
						hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}
					>
						<FormLabel>
							<Trans>Font Family</Trans>
						</FormLabel>
						<FormControl
							render={
								<FontFamilyCombobox
									value={field.state.value}
									className="text-base"
									onValueChange={(value: string | null) => {
										if (value === null) return;
										field.handleChange(value);
										const nextWeights = getNextWeights(value, prefix === "heading");
										if (nextWeights) form.setFieldValue(`${prefix}.fontWeights`, nextWeights);
										handleAutoSave();
									}}
								/>
							}
						/>
						<FormMessage errors={field.state.meta.errors} />
					</FormItem>
				)}
			</form.Field>

			<form.Field name={`${prefix}.fontWeights`}>
				{(field) => (
					<FormItem
						className="col-span-full"
						hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}
					>
						<FormLabel>{prefix === "body" ? <Trans>Font Weights</Trans> : <Trans>Font Weight</Trans>}</FormLabel>
						<FormControl
							render={
								<FontWeightCombobox
									single={prefix === "heading"}
									value={field.state.value}
									fontFamily={fontFamily}
									onValueChange={(value) => {
										if (value?.length === 0) return;
										field.handleChange(value as FontWeight[]);
										handleAutoSave();
									}}
								/>
							}
						/>
						<FormMessage errors={field.state.meta.errors} />
					</FormItem>
				)}
			</form.Field>

			<form.Field name={`${prefix}.fontSize`}>
				{(field) => (
					<FormItem hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
						<FormLabel>
							<Trans>Font Size</Trans>
						</FormLabel>
						<InputGroup>
							<FormControl
								render={
									<InputGroupInput
										name={field.name}
										value={field.state.value}
										min={6}
										max={24}
										step={0.1}
										type="number"
										onBlur={field.handleBlur}
										onChange={(e) => {
											const value = e.target.value;
											if (value === "") field.handleChange("" as unknown as number);
											else field.handleChange(Number(value));
											handleAutoSave();
										}}
									/>
								}
							/>
							<InputGroupAddon align="inline-end">
								<InputGroupText>pt</InputGroupText>
							</InputGroupAddon>
						</InputGroup>
					</FormItem>
				)}
			</form.Field>

			<form.Field name={`${prefix}.lineHeight`}>
				{(field) => (
					<FormItem hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
						<FormLabel>
							<Trans>Line Height</Trans>
						</FormLabel>
						<InputGroup>
							<FormControl
								render={
									<InputGroupInput
										name={field.name}
										value={field.state.value}
										min={0.5}
										max={4}
										step={0.05}
										type="number"
										onBlur={field.handleBlur}
										onChange={(e) => {
											const value = e.target.value;
											if (value === "") field.handleChange("" as unknown as number);
											else field.handleChange(Number(value));
											handleAutoSave();
										}}
									/>
								}
							/>
							<InputGroupAddon align="inline-end">
								<InputGroupText>x</InputGroupText>
							</InputGroupAddon>
						</InputGroup>
					</FormItem>
				)}
			</form.Field>
		</>
	);
}

type TypographyFieldGroupProps = {
	label: ReactNode;
};

function TypographyFieldGroup({ label }: TypographyFieldGroupProps) {
	return (
		<div className="col-span-full flex items-center gap-x-2">
			<Separator className="basis-[16px]" />
			<div className="shrink-0 text-base leading-none font-medium">{label}</div>
			<Separator className="flex-1" />
		</div>
	);
}
