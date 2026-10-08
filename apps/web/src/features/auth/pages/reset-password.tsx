import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useSelector } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import z from "zod";
import { Button } from "@reactive-resume/ui/components/button";
import { FormControl, FormItem, FormLabel, FormMessage } from "@reactive-resume/ui/components/form";
import { toast } from "@reactive-resume/ui/components/toast";
import { PasswordInput } from "@/components/input/password-input";
import { authClient } from "@/libs/auth/client";
import { useAppForm } from "@/libs/tanstack-form";

const formSchema = z.object({
	password: z.string().min(8).max(64),
});

type Props = {
	token: string;
};

export function ResetPasswordPage({ token }: Props) {
	const navigate = useNavigate();

	const form = useAppForm({
		defaultValues: { password: "" },
		validators: { onSubmit: formSchema },
		onSubmit: async ({ value }) => {
			const toastId = toast.add({ type: "loading", description: t`Resetting your password...` });

			const { error } = await authClient.resetPassword({ token, newPassword: value.password });

			if (error) {
				toast.add({
					type: "error",
					description:
						error.message ||
						t({
							comment: "Fallback toast when resetting password fails and no backend message is available",
							message: "Failed to reset your password. Please try again.",
						}),
					id: toastId,
				});
				return;
			}

			toast.add({
				type: "success",
				description: t`Your password has been reset. You can now sign in with your new password.`,
				id: toastId,
			});

			void navigate({ to: "/auth/login" });
		},
	});

	const isSubmitting = useSelector(form.store, (state) => state.isSubmitting);

	return (
		<>
			<div className="space-y-1 text-center">
				<h1 className="text-2xl font-semibold tracking-tight">
					<Trans>Reset your password</Trans>
				</h1>

				<div className="text-ink-3">
					<Trans>Enter a new password for your account</Trans>
				</div>
			</div>

			<form
				className="space-y-6"
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
								<Trans comment="Label for new password input on reset-password form">New Password</Trans>
							</FormLabel>
							<FormControl
								render={
									<PasswordInput
										minLength={8}
										maxLength={64}
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

				<Button type="submit" className="w-full" disabled={isSubmitting}>
					<Trans comment="Primary action button label on reset-password form">Reset Password</Trans>
				</Button>
			</form>
		</>
	);
}
