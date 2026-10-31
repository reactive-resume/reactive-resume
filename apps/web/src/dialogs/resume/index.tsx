import type { DialogProps } from "../store";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import z from "zod";
import { Button } from "@reactive-resume/ui/components/button";
import {
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@reactive-resume/ui/components/dialog";
import { FormControl, FormDescription, FormItem, FormLabel, FormMessage } from "@reactive-resume/ui/components/form";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { toast } from "@reactive-resume/ui/components/toast";
import { generateRandomName } from "@reactive-resume/utils/slug";
import { useDialogStore } from "../store";
import { ChipInput } from "@/components/input/chip-input";
import { saveResumeMetadata } from "@/features/resume/builder/draft";
import { useFormBlocker } from "@/hooks/use-form-blocker";
import { getResumeErrorMessage } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";
import { useAppForm } from "@/libs/tanstack-form";

const formSchema = z.object({
	id: z.string(),
	name: z.string().min(1).max(64),
	tags: z.array(z.string()),
});

type ResumeDialogProps = {
	mode: "update" | "duplicate";
	data: DialogProps<"resume.update">["data"];
};

export function ResumeDialog({ mode, data }: ResumeDialogProps) {
	const isUpdate = mode === "update";
	const navigate = useNavigate();
	const closeDialog = useDialogStore((state) => state.closeDialog);

	const updateOptions = orpc.resume.update.mutationOptions();
	const update = useMutation({
		...updateOptions,
		mutationFn: (value) =>
			saveResumeMetadata(value.id, (expectedUpdatedAt) => orpc.resume.update.call({ ...value, expectedUpdatedAt })),
	});
	const duplicate = useMutation(orpc.resume.duplicate.mutationOptions());

	const form = useAppForm({
		defaultValues: {
			id: data.id,
			name: isUpdate ? data.name : `${data.name} (Copy)`,
			tags: data.tags,
		},
		validators: { onSubmit: formSchema },
		onSubmit: ({ value }) => {
			const toastId = toast.add({
				type: "loading",
				description: isUpdate ? t`Updating your resume...` : t`Duplicating your resume...`,
			});
			const onError = (error: unknown) => {
				toast.add({ type: "error", description: getResumeErrorMessage(error), id: toastId });
			};

			if (isUpdate) {
				update.mutate(value, {
					onSuccess: () => {
						toast.add({ type: "success", description: t`Your resume has been updated.`, id: toastId });
						closeDialog();
					},
					onError,
				});
				return;
			}

			duplicate.mutate(value, {
				onSuccess: (id) => {
					toast.add({ type: "success", description: t`Your resume has been duplicated.`, id: toastId });
					closeDialog();

					void navigate({ to: "/builder/$resumeId", params: { resumeId: id } });
				},
				onError,
			});
		},
	});

	useFormBlocker(form);

	return (
		<DialogContent>
			<DialogHeader>
				<DialogTitle className="flex items-center gap-x-2">
					<Icon name="pencil-simple" size={16} />
					{isUpdate ? <Trans>Update resume</Trans> : <Trans>Duplicate resume</Trans>}
				</DialogTitle>
				<DialogDescription>
					{isUpdate ? (
						<Trans>Changed your mind? Rename your resume to something more descriptive.</Trans>
					) : (
						<Trans>Duplicate your resume to create a new one, just like the original.</Trans>
					)}
				</DialogDescription>
			</DialogHeader>

			<form
				className="space-y-4"
				onSubmit={(event) => {
					event.preventDefault();
					event.stopPropagation();
					void form.handleSubmit();
				}}
			>
				<form.Field name="name">
					{(field) => (
						<FormItem hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
							<FormLabel>
								<Trans>Name</Trans>
							</FormLabel>
							<div className="flex items-center gap-x-2">
								<FormControl
									render={
										<Input
											minLength={1}
											maxLength={64}
											name={field.name}
											value={field.state.value}
											onBlur={field.handleBlur}
											onChange={(event) => field.handleChange(event.target.value)}
										/>
									}
								/>

								<Button
									size="icon"
									variant="secondary"
									title={t`Generate a random name`}
									onClick={() => form.setFieldValue("name", generateRandomName())}
								>
									<Icon name="magic-wand" size={16} />
								</Button>
							</div>
							<FormMessage errors={field.state.meta.errors} />
							<FormDescription>
								<Trans>Name the resume after the position you are applying for.</Trans>
							</FormDescription>
						</FormItem>
					)}
				</form.Field>

				<form.Field name="tags">
					{(field) => (
						<FormItem hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
							<FormLabel>
								<Trans>Tags</Trans>
							</FormLabel>
							<FormControl
								render={
									<ChipInput
										value={field.state.value}
										onChange={(value) => {
											field.handleChange(value);
										}}
									/>
								}
							/>
							<FormMessage errors={field.state.meta.errors} />
							<FormDescription>
								<Trans>Tags can be used to categorize your resume by keywords.</Trans>
							</FormDescription>
						</FormItem>
					)}
				</form.Field>

				<DialogFooter>
					<Button type="submit" disabled={update.isPending || duplicate.isPending}>
						{isUpdate ? <Trans>Save changes</Trans> : <Trans>Duplicate</Trans>}
					</Button>
				</DialogFooter>
			</form>
		</DialogContent>
	);
}
