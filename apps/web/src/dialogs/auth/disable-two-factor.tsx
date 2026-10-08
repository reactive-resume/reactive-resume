import type { DialogProps } from "../store";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useSelector } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import z from "zod";
import { Button } from "@reactive-resume/ui/components/button";
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
import { sessionQueryKey } from "@/libs/root-context";
import { useAppForm } from "@/libs/tanstack-form";

const formSchema = z.object({
	password: z.string().min(6).max(64),
});

export function DisableTwoFactorDialog(_: DialogProps<"auth.two-factor.disable">) {
	const router = useRouter();
	const queryClient = useQueryClient();
	const closeDialog = useDialogStore((state) => state.closeDialog);

	const form = useAppForm({
		defaultValues: { password: "" },
		validators: { onSubmit: formSchema },
		onSubmit: async ({ value }) => {
			const toastId = toast.add({
				type: "loading",
				description: t`Disabling two-factor authentication...`,
			});

			const { error } = await authClient.twoFactor.disable({ password: value.password });

			if (error) {
				toast.add({
					type: "error",
					description: getReadableErrorMessage(
						error,
						t({
							comment: "Fallback toast when disabling two-factor authentication fails",
							message: "Failed to disable two-factor authentication. Please try again.",
						}),
					),
					id: toastId,
				});
				return;
			}

			toast.add({
				type: "success",
				description: t`Two-factor authentication is now disabled.`,
				id: toastId,
			});
			void queryClient.invalidateQueries({ queryKey: sessionQueryKey }).then(() => router.invalidate());
			closeDialog();
			form.reset();
		},
	});

	const isSubmitting = useSelector(form.store, (state) => state.isSubmitting);

	useFormBlocker(form);

	return (
		<DialogContent>
			<DialogHeader>
				<DialogTitle className="flex items-center gap-x-2">
					<Icon name="lock_open" size={16} />
					<Trans>Disable Two-Factor Authentication</Trans>
				</DialogTitle>
				<DialogDescription>
					<Trans>
						Enter your password to disable two-factor authentication. Your account will be less secure without 2FA
						enabled.
					</Trans>
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
				<form.Field name="password">
					{(field) => (
						<FormItem hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
							<FormLabel>
								<Trans>Password</Trans>
							</FormLabel>
							<FormControl
								render={
									<PasswordInput
										minLength={6}
										maxLength={64}
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

				<DialogFooter>
					<Button type="submit" variant="danger" disabled={isSubmitting}>
						<Trans comment="Destructive action button to turn off two-factor authentication">Disable 2FA</Trans>
					</Button>
				</DialogFooter>
			</form>
		</DialogContent>
	);
}
