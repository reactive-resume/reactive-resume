import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useSelector } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouter } from "@tanstack/react-router";
import z from "zod";
import { Button } from "@reactive-resume/ui/components/button";
import { FormControl, FormItem, FormLabel, FormMessage } from "@reactive-resume/ui/components/form";
import { toast } from "@reactive-resume/ui/components/toast";
import { PasswordInput } from "@/components/input/password-input";
import { clearAccountData } from "@/libs/auth/clear-account-data";
import { authClient } from "@/libs/auth/client";
import { useAppForm } from "@/libs/tanstack-form";

const formSchema = z.object({
	password: z
		.string()
		.min(8, { error: () => t`Use at least 8 characters.` })
		.max(64, { error: () => t`Use 64 characters or fewer.` }),
});

type Props = {
	token: string;
};

export function ResetPasswordPage({ token }: Props) {
	const navigate = useNavigate();
	const router = useRouter();
	const queryClient = useQueryClient();

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
							message: "Couldn't reset your password. Try again.",
						}),
					id: toastId,
				});
				return;
			}

			// The reset signs the reset account out everywhere. A session that's still here belongs to another account
			// (the link was opened in its browser): keep that one and its data, and say whose password changed.
			const { data: still } = await authClient.getSession({ query: { disableCookieCache: true } });
			if (still?.user) {
				toast.add({
					type: "success",
					description: t`That account's password changed and it's signed out everywhere. This browser is still signed in as ${still.user.email}.`,
					id: toastId,
				});
				await router.invalidate();
				void navigate({ to: "/dashboard", replace: true });
				return;
			}

			toast.add({
				type: "success",
				description: t`Password changed. You're signed out everywhere; sign in, then add any passkeys or API keys again.`,
				id: toastId,
			});

			// The reset revoked this browser's session too: forget the account here, or sign-in would read the cached
			// session and send the user to a dashboard that can no longer load.
			clearAccountData(queryClient);
			await router.invalidate();
			void navigate({ to: "/auth/login", replace: true });
		},
	});

	const isSubmitting = useSelector(form.store, (state) => state.isSubmitting);

	return (
		<>
			<div className="space-y-1 text-center">
				<h1 className="text-[30px] leading-9">
					<Trans>Reset your password</Trans>
				</h1>

				<div className="text-ink-3">
					<Trans>
						Choose a new password. This signs you out everywhere and removes your passkeys, API keys and connected apps.
					</Trans>
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
								<Trans comment="Label for new password input on reset-password form">New password</Trans>
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
					<Trans comment="Primary action button label on reset-password form">Reset password</Trans>
				</Button>
			</form>
		</>
	);
}
