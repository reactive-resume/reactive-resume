import type z from "zod";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { pageSchema } from "@reactive-resume/schema/resume/data";
import { FormControl, FormItem, FormLabel, FormMessage } from "@reactive-resume/ui/components/form";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
	InputGroupText,
} from "@reactive-resume/ui/components/input-group";
import { Switch } from "@reactive-resume/ui/components/switch";
import { SectionBase } from "../shared/section-base";
import { Combobox } from "@/components/ui/combobox";
import { useCurrentResume, useUpdateResumeData } from "@/features/resume/builder/draft";
import { useSyncFormValues } from "@/hooks/use-sync-form-values";
import { useAppForm } from "@/libs/tanstack-form";

export function PageSectionBuilder() {
	return (
		<SectionBase type="page">
			<PageSectionForm />
		</SectionBase>
	);
}

const formSchema = pageSchema;

type FormValues = z.infer<typeof formSchema>;

const CLAMP_MIN = 0;
const CLAMP_MAX = 100;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

function PageSectionForm() {
	const resume = useCurrentResume();
	const page = resume.data.metadata.page;
	const updateResumeData = useUpdateResumeData();

	const persist = (data: FormValues) => {
		updateResumeData((draft) => {
			draft.metadata.page = data;
		});
	};

	const form = useAppForm({
		defaultValues: page,
		validators: { onChange: formSchema },
		onSubmit: ({ value }) => {
			persist(value);
		},
	});
	useSyncFormValues(form, page);

	const handleAutoSave = <K extends keyof FormValues>(name: K, value: FormValues[K]) => {
		const next = { ...form.state.values, [name]: value };
		// Keep last-saved numeric page fields when the form holds a transient empty/NaN value
		for (const key of ["marginX", "marginY", "gapX", "gapY"] as const) {
			if (!Number.isFinite(next[key])) next[key] = page?.[key] ?? 0;
		}
		persist(next);
	};

	const pageNumberFields = [
		{ name: "marginX" as const, label: <Trans>Margin (Horizontal)</Trans>, min: CLAMP_MIN, max: CLAMP_MAX },
		{ name: "marginY" as const, label: <Trans>Margin (Vertical)</Trans>, min: CLAMP_MIN, max: CLAMP_MAX },
		{ name: "gapX" as const, label: <Trans>Spacing (Horizontal)</Trans>, min: 0, max: undefined },
		{ name: "gapY" as const, label: <Trans>Spacing (Vertical)</Trans>, min: 0, max: undefined },
	];

	const pageSwitchFields = [
		{ name: "hideLinkUnderline" as const, label: <Trans>Hide Link Underline</Trans> },
		{ name: "hideIcons" as const, label: <Trans>Hide Icons</Trans> },
		{ name: "hideSectionIcons" as const, label: <Trans>Hide Section Icons</Trans> },
	];

	return (
		<form
			className="grid grid-cols-1 gap-4 @md:grid-cols-2"
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				void form.handleSubmit();
			}}
		>
			<form.Field name="format">
				{(field) => (
					<FormItem
						className="col-span-full"
						hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}
					>
						<FormLabel>
							<Trans context="Page Format (A4, Letter, Free-form)">Format</Trans>
						</FormLabel>
						<FormControl
							render={
								<Combobox
									options={[
										{ value: "a4", label: t`A4` },
										{ value: "letter", label: t`Letter` },
										{ value: "free-form", label: t`Free-form` },
									]}
									value={field.state.value}
									onValueChange={(value) => {
										const format = value as FormValues["format"];
										field.handleChange(format);
										handleAutoSave("format", format);
									}}
								/>
							}
						/>
						<FormMessage errors={field.state.meta.errors} />
					</FormItem>
				)}
			</form.Field>

			{pageNumberFields.map(({ name, label, min, max }) => (
				<form.Field key={name} name={name}>
					{(field) => (
						<FormItem hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
							<FormLabel>{label}</FormLabel>
							<InputGroup>
								<FormControl
									render={
										<InputGroupInput
											name={field.name}
											value={Number.isFinite(field.state.value) ? field.state.value : ""}
											min={min}
											{...(max !== undefined ? { max } : {})}
											step={1}
											type="number"
											onBlur={field.handleBlur}
											onChange={(e) => {
												const v = e.target.value;
												if (v === "") {
													// Allow clearing the controlled input without persisting invalid metadata
													field.handleChange(Number.NaN);
													return;
												}

												const raw = Number(v);
												if (!Number.isFinite(raw)) return;

												const num = max !== undefined ? clamp(raw, min ?? 0, max) : Math.max(raw, min ?? 0);
												field.handleChange(num);
												handleAutoSave(name, num);
											}}
										/>
									}
								/>
								<InputGroupAddon align="inline-end">
									<InputGroupText>pt</InputGroupText>
								</InputGroupAddon>
							</InputGroup>
							<FormMessage errors={field.state.meta.errors} />
						</FormItem>
					)}
				</form.Field>
			))}

			{pageSwitchFields.map(({ name, label }) => (
				<form.Field key={name} name={name}>
					{(field) => (
						<FormItem
							className="col-span-full flex items-center gap-x-3 py-1"
							hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}
						>
							<FormControl
								render={
									<Switch
										checked={field.state.value}
										onCheckedChange={(checked) => {
											field.handleChange(checked);
											handleAutoSave(name, checked);
										}}
									/>
								}
							/>
							<FormLabel>{label}</FormLabel>
						</FormItem>
					)}
				</form.Field>
			))}
		</form>
	);
}
