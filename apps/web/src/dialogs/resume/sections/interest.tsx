import type z from "zod";
import type { DialogProps } from "@/dialogs/store";
import { Trans } from "@lingui/react/macro";
import { PencilSimpleLineIcon, PlusIcon } from "@phosphor-icons/react";
import { useStore } from "@tanstack/react-form";
import { interestItemSchema } from "@reactive-resume/schema/resume/data";
import { FormControl, FormItem, FormLabel, FormMessage } from "@reactive-resume/ui/components/form";
import { Input } from "@reactive-resume/ui/components/input";
import { PopoverTrigger } from "@reactive-resume/ui/components/popover";
import { cn } from "@reactive-resume/utils/style";
import { ChipInput } from "@/components/input/chip-input";
import { ColorPicker } from "@/components/input/color-picker";
import { IconPicker } from "@/components/input/icon-picker";
import { useDialogStore } from "@/dialogs/store";
import { useUpdateResumeData } from "@/features/resume/builder/draft";
import { useFormBlocker } from "@/hooks/use-form-blocker";
import { makeSectionItem } from "@/libs/resume/make-section-item";
import { createSectionItem, updateSectionItem } from "@/libs/resume/section-actions";
import { useAppForm, withForm } from "@/libs/tanstack-form";
import { SectionItemDialog } from "./section-item-dialog";

const formSchema = interestItemSchema;

type FormValues = z.infer<typeof formSchema>;

const defaultValues: FormValues = {
	id: "",
	hidden: false,
	icon: "acorn",
	iconColor: "",
	name: "",
	keywords: [],
};

export function CreateInterestDialog({ data }: DialogProps<"resume.sections.interests.create">) {
	const closeDialog = useDialogStore((state) => state.closeDialog);
	const updateResumeData = useUpdateResumeData();

	const form = useAppForm({
		defaultValues: makeSectionItem(defaultValues, data?.item),
		validators: { onSubmit: formSchema },
		onSubmit: ({ value }) => {
			updateResumeData((draft) => {
				createSectionItem(draft, "interests", value, data?.customSectionId);
			});
			closeDialog();
		},
	});

	const { requestClose } = useFormBlocker(form);
	const isSubmitting = useStore(form.store, (state) => state.isSubmitting);

	return (
		<SectionItemDialog
			title={<Trans>Create a new interest</Trans>}
			icon={<PlusIcon />}
			onSubmit={() => void form.handleSubmit()}
			onCancel={requestClose}
			isSubmitting={isSubmitting}
			submitLabel={<Trans>Create</Trans>}
		>
			<InterestForm form={form} />
		</SectionItemDialog>
	);
}

export function UpdateInterestDialog({ data }: DialogProps<"resume.sections.interests.update">) {
	const closeDialog = useDialogStore((state) => state.closeDialog);
	const updateResumeData = useUpdateResumeData();

	const form = useAppForm({
		defaultValues: data.item,
		validators: { onSubmit: formSchema },
		onSubmit: ({ value }) => {
			updateResumeData((draft) => {
				updateSectionItem(draft, "interests", value, data?.customSectionId);
			});
			closeDialog();
		},
	});

	const { requestClose } = useFormBlocker(form);
	const isSubmitting = useStore(form.store, (state) => state.isSubmitting);

	return (
		<SectionItemDialog
			title={<Trans>Update an existing interest</Trans>}
			icon={<PencilSimpleLineIcon />}
			onSubmit={() => void form.handleSubmit()}
			onCancel={requestClose}
			isSubmitting={isSubmitting}
			submitLabel={<Trans>Save Changes</Trans>}
		>
			<InterestForm form={form} />
		</SectionItemDialog>
	);
}

const InterestForm = withForm({
	defaultValues,
	render: function InterestFormRenderer({ form }) {
		const nameMeta = useStore(form.store, (s) => s.fieldMeta?.name);

		const isNameInvalid = (nameMeta?.isTouched ?? false) && (nameMeta?.errors?.length ?? 0) > 0;

		return (
			<>
				<div className={cn("col-span-full flex items-end", isNameInvalid && "items-center")}>
					<form.Field name="icon">
						{(field) => (
							<FormItem className="shrink-0">
								<FormControl
									render={
										<IconPicker
											value={field.state.value}
											onChange={(icon: string) => {
												field.handleChange(icon);
											}}
											popoverProps={{ modal: true }}
											className="rounded-r-none border-input border-e-0"
										/>
									}
								/>
							</FormItem>
						)}
					</form.Field>

					<form.Field name="name">
						{(field) => (
							<FormItem className="flex-1" hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
								<FormLabel>
									<Trans>Name</Trans>
								</FormLabel>
								<FormControl
									render={
										<Input
											className="rounded-s-none rounded-e-none"
											name={field.name}
											value={field.state.value}
											onBlur={field.handleBlur}
											onChange={(event) => field.handleChange(event.target.value)}
										/>
									}
								/>
								<FormMessage errors={field.state.meta.errors} />
							</FormItem>
						)}
					</form.Field>

					<form.Field name="iconColor">
						{(field) => (
							<FormItem className="shrink-0">
								<FormControl
									render={
										<ColorPicker
											value={field.state.value}
											onChange={(v: string) => {
												field.handleChange(v);
											}}
											trigger={
												<PopoverTrigger className="h-9 rounded-e border-input border-y border-e px-2">
													<div
														className="size-4 shrink-0 cursor-pointer rounded-full border border-foreground/60 transition-transform duration-150 ease-out-strong focus-visible:outline-hidden active:scale-[0.97]"
														style={{ backgroundColor: field.state.value ?? "currentColor" }}
													/>
												</PopoverTrigger>
											}
										/>
									}
								/>
							</FormItem>
						)}
					</form.Field>
				</div>

				<form.Field name="keywords">
					{(field) => (
						<FormItem
							className="col-span-full"
							hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}
						>
							<FormLabel>
								<Trans>Keywords</Trans>
							</FormLabel>
							<FormControl
								render={
									<ChipInput
										value={field.state.value}
										onChange={(v: string[]) => {
											field.handleChange(v);
										}}
									/>
								}
							/>
							<FormMessage errors={field.state.meta.errors} />
						</FormItem>
					)}
				</form.Field>
			</>
		);
	},
});
