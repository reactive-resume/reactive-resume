import type z from "zod";
import { Trans } from "@lingui/react/macro";
import * as React from "react";
import { metadataSchema } from "@reactive-resume/schema/resume/data";
import { FormControl, FormItem, FormLabel, FormMessage } from "@reactive-resume/ui/components/form";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
	InputGroupText,
} from "@reactive-resume/ui/components/input-group";
import { Slider } from "@reactive-resume/ui/components/slider";
import { SectionBase } from "../../shared/section-base";
import { LayoutPages } from "./pages";
import { useCurrentResume, useUpdateResumeData } from "@/features/resume/builder/draft";
import { useSyncFormValues } from "@/hooks/use-sync-form-values";
import { useAppForm } from "@/libs/tanstack-form";

export function LayoutSectionBuilder() {
	return (
		<SectionBase type="layout" className="space-y-4">
			<LayoutPages />
			<LayoutSectionForm />
		</SectionBase>
	);
}

const formSchema = metadataSchema.shape.layout.omit({ pages: true });

type FormValues = z.infer<typeof formSchema>;

function LayoutSectionForm() {
	const resume = useCurrentResume();
	const layout = resume.data.metadata.layout;
	const updateResumeData = useUpdateResumeData();

	const persist = (data: FormValues) => {
		updateResumeData((draft) => {
			draft.metadata.layout.sidebarWidth = data.sidebarWidth;
		});
	};

	const form = useAppForm({
		defaultValues: { sidebarWidth: layout.sidebarWidth },
		validators: { onChange: formSchema },
		onSubmit: ({ value }) => {
			persist(value);
		},
	});
	useSyncFormValues(form, { sidebarWidth: layout.sidebarWidth });

	const handleAutoSave = () => {
		persist(form.state.values);
	};

	const labelId = React.useId();

	return (
		<form
			className="space-y-4"
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				void form.handleSubmit();
			}}
		>
			<form.Field name="sidebarWidth">
				{(field) => (
					<FormItem hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
						<FormLabel id={labelId}>
							<Trans>Sidebar Width</Trans>
						</FormLabel>
						<div className="flex items-center gap-4">
							<Slider
								aria-labelledby={labelId}
								min={10}
								max={50}
								step={0.01}
								value={[field.state.value]}
								onValueChange={(value) => {
									field.handleChange(Array.isArray(value) ? value[0] : value);
									handleAutoSave();
								}}
							/>

							<FormControl
								render={
									<InputGroup className="w-auto shrink-0">
										<InputGroupInput
											name={field.name}
											value={field.state.value}
											type="number"
											min={10}
											max={50}
											step={0.1}
											onBlur={field.handleBlur}
											onChange={(e) => {
												const value = e.target.value;
												if (value === "") field.handleChange("" as unknown as number);
												else field.handleChange(Number(value));
												handleAutoSave();
											}}
										/>
										<InputGroupAddon align="inline-end">
											<InputGroupText>%</InputGroupText>
										</InputGroupAddon>
									</InputGroup>
								}
							/>
						</div>
						<FormMessage errors={field.state.meta.errors} />
					</FormItem>
				)}
			</form.Field>
		</form>
	);
}
