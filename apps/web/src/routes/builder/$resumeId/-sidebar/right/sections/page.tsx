import type z from "zod";
import { Trans } from "@lingui/react/macro";
import { pageSchema } from "@reactive-resume/schema/resume/data";
import { FormControl, FormItem, FormLabel, FormMessage } from "@reactive-resume/ui/components/form";
import { InputGroup, InputGroupAddon, InputGroupText } from "@reactive-resume/ui/components/input-group";
import { Switch } from "@reactive-resume/ui/components/switch";
import { SectionBase } from "../shared/section-base";
import { NumberInput } from "@/components/input/number-input";
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
	});
	useSyncFormValues(form, page);

	const handleAutoSave = () => {
		persist(form.state.values);
	};

	const pageNumberFields = [
		{ name: "marginX" as const, label: <Trans>Horizontal margin</Trans>, min: CLAMP_MIN, max: CLAMP_MAX },
		{ name: "marginY" as const, label: <Trans>Vertical margin</Trans>, min: CLAMP_MIN, max: CLAMP_MAX },
		{ name: "gapX" as const, label: <Trans>Horizontal spacing</Trans>, min: 0, max: undefined },
		{ name: "gapY" as const, label: <Trans>Vertical spacing</Trans>, min: 0, max: undefined },
	];

	const pageSwitchFields = [
		{ name: "hideLinkUnderline" as const, label: <Trans>Underline links</Trans> },
		{ name: "hideIcons" as const, label: <Trans>Show icons</Trans> },
		{ name: "hideSectionIcons" as const, label: <Trans>Show section icons</Trans> },
	];

	return (
		<div className="grid grid-cols-1 gap-4 @md:grid-cols-2">
			{pageNumberFields.map(({ name, label, min, max }) => (
				<form.Field key={name} name={name}>
					{(field) => (
						<FormItem hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
							<FormLabel>{label}</FormLabel>
							<InputGroup>
								<FormControl
									render={
										<NumberInput
											name={field.name}
											value={field.state.value}
											min={min}
											max={max}
											step={1}
											onBlur={field.handleBlur}
											onValueChange={(value) => {
												field.handleChange(value);
												handleAutoSave();
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
										// Labels describe the ON state; the stored flags are hide*, so the switch is inverted.
										checked={!field.state.value}
										onCheckedChange={(checked) => {
											field.handleChange(!checked);
											handleAutoSave();
										}}
									/>
								}
							/>
							<FormLabel>{label}</FormLabel>
						</FormItem>
					)}
				</form.Field>
			))}
		</div>
	);
}
