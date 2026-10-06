import type { DialogProps } from "../store";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useSelector } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import z from "zod";
import { Button } from "@reactive-resume/ui/components/button";
import { Checkbox } from "@reactive-resume/ui/components/checkbox";
import {
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@reactive-resume/ui/components/dialog";
import { FormControl, FormItem, FormLabel, FormMessage } from "@reactive-resume/ui/components/form";
import { Icon } from "@reactive-resume/ui/components/icon";
import { toast } from "@reactive-resume/ui/components/toast";
import { useDialogStore } from "../store";
import { PasswordInput } from "@/components/input/password-input";
import { useFormBlocker } from "@/hooks/use-form-blocker";
import { authClient } from "@/libs/auth/client";
import { getReadableErrorMessage } from "@/libs/error-message";
import { useAppForm } from "@/libs/tanstack-form";

const formSchema = z
	.object({
		currentPassword: z.string().min(8).max(64),
		newPassword: z.string().min(8).max(64),
		revokeOtherSessions: z.boolean(),
	})
	.refine((data) => data.newPassword !== data.currentPassword, {
		message: "New password cannot be the same as the current password.",
		path: ["newPassword"],
	});

export function ChangePasswordDialog(_: DialogProps<"auth.change-password">) {
	const queryClient = useQueryClient();
	const closeDialog = useDialogStore((state) => state.closeDialog);

	const form = useAppForm({
		defaultValues: {
			currentPassword: "",
			newPassword: "",
			revokeOtherSessions: false,
		},
		validators: {
			onSubmit: formSchema,
		},
		onSubmit: async ({ value }) => {
			const toastId = toast.add({ type: "loading", description: t`Updating your password...` });

			const { error } = await authClient.changePassword({
				currentPassword: value.currentPassword,
				newPassword: value.newPassword,
				revokeOtherSessions: value.revokeOtherSessions,
			});

			if (error) {
				toast.add({
					type: "error",
					description: getReadableErrorMessage(
						error,
						t({
							comment: "Fallback toast when changing account password fails",
							message: "Failed to update your password. Please try again.",
						}),
					),
					id: toastId,
				});
				return;
			}

			toast.add({ type: "success", description: t`Your password has been updated.`, id: toastId });
			void queryClient.invalidateQueries({ queryKey: ["auth", "accounts"] });
			closeDialog();
		},
	});

	const isSubmitting = useSelector(form.store, (state) => state.isSubmitting);

	useFormBlocker(form);

	return (
		<DialogContent>
			<DialogHeader>
				<DialogTitle className="flex items-center gap-x-2">
					<Icon name="password" size={16} />
					<Trans>Update your password</Trans>
				</DialogTitle>
				<DialogDescription>
					<Trans>Enter your current password and a new password to update your account.</Trans>
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
				<form.Field name="currentPassword">
					{(field) => (
						<FormItem hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
							<FormLabel>
								<Trans>Current Password</Trans>
							</FormLabel>
							<FormControl
								render={
									<PasswordInput
										min={8}
										max={64}
										autoComplete="current-password"
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

				<form.Field name="newPassword">
					{(field) => (
						<FormItem hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
							<FormLabel>
								<Trans>New Password</Trans>
							</FormLabel>
							<FormControl
								render={
									<PasswordInput
										min={8}
										max={64}
										autoComplete="new-password"
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

				<form.Field name="revokeOtherSessions">
					{(field) => (
						<FormItem className="flex items-center gap-2.5">
							<FormControl
								render={<Checkbox name={field.name} checked={field.state.value} onCheckedChange={field.handleChange} />}
							/>
							<FormLabel>
								<Trans>Sign out from all other devices</Trans>
							</FormLabel>
						</FormItem>
					)}
				</form.Field>

				<DialogFooter>
					<Button type="submit" disabled={isSubmitting}>
						<Trans comment="Primary action button to submit changed password">Update Password</Trans>
					</Button>
				</DialogFooter>
			</form>
		</DialogContent>
	);
}
