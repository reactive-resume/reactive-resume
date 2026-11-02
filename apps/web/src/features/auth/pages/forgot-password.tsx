import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useSelector } from "@tanstack/react-form";
import { Link, useRouteContext } from "@tanstack/react-router";
import { useState } from "react";
import z from "zod";
import { Button } from "@reactive-resume/ui/components/button";
import { FormControl, FormItem, FormLabel, FormMessage } from "@reactive-resume/ui/components/form";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { toast } from "@reactive-resume/ui/components/toast";
import { cn } from "@reactive-resume/utils/style";
import { authClient } from "@/libs/auth/client";
import { ENTER_CLASS } from "@/libs/motion";
import { useAppForm } from "@/libs/tanstack-form";

const formSchema = z.object({
	email: z.email({ error: () => t`Enter a valid email address.` }),
});

export function ForgotPasswordPage() {
	const [submitted, setSubmitted] = useState(false);
	// A server without email can't deliver the link: say so instead of promising one.
	const smtpEnabled = useRouteContext({ strict: false }).flags?.smtpEnabled ?? false;

	const form = useAppForm({
		defaultValues: { email: "" },
		validators: { onSubmit: formSchema },
		onSubmit: async ({ value }) => {
			const toastId = toast.add({ type: "loading", description: t`Sending password reset email...` });

			const { error } = await authClient.requestPasswordReset({
				email: value.email,
				redirectTo: "/auth/reset-password",
			});

			if (error) {
				toast.add({
					type: "error",
					description:
						error.message ||
						t({
							comment: "Fallback toast when requesting password reset email fails without backend message",
							message: "Couldn't send the password reset email. Try again.",
						}),
					id: toastId,
				});
				return;
			}

			setSubmitted(true);
			toast.close(toastId);
		},
	});

	const isSubmitting = useSelector(form.store, (state) => state.isSubmitting);

	if (submitted)
		return (
			<PostForgotPasswordScreen
				onResend={async () => {
					const { error } = await authClient.requestPasswordReset({
						email: form.state.values.email,
						redirectTo: "/auth/reset-password",
					});
					toast.add(
						error
							? { type: "error", description: t`Couldn't send the password reset email. Try again.` }
							: { type: "success", description: t`Sent again. It can take a minute to arrive.` },
					);
				}}
			/>
		);

	return (
		<>
			<div className="space-y-1 text-center">
				<h1 className="text-[30px] leading-9">
					<Trans>Forgot your password?</Trans>
				</h1>

				<div className="text-ink-3">
					<Trans>
						Remember your password?{" "}
						<Button
							variant="link"
							className="h-auto gap-1.5 px-1! py-0"
							nativeButton={false}
							render={
								<Link to="/auth/login">
									<Trans comment="Call-to-action link from forgot-password page to login page">Sign in now</Trans>{" "}
									<Icon name="arrow-right" size={16} />
								</Link>
							}
						/>
					</Trans>
				</div>
			</div>

			{!smtpEnabled ? (
				<p role="status" className="rounded-lg bg-sunken p-3 text-center text-sm text-ink-2">
					<Trans>
						This server can't send email, so password reset isn't available. Ask the person who runs it to reset your
						password.
					</Trans>
				</p>
			) : (
				<form
					noValidate
					className="space-y-6"
					onSubmit={(event) => {
						event.preventDefault();
						event.stopPropagation();
						void form.handleSubmit();
					}}
				>
					<form.Field name="email">
						{(field) => (
							<FormItem hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
								<FormLabel>
									<Trans comment="Label for email input on forgot-password form">Email address</Trans>
								</FormLabel>
								<FormControl
									render={
										<Input
											type="email"
											autoComplete="email"
											placeholder="john.doe@example.com"
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
						<Trans comment="Primary action button label on forgot-password form">Send reset link</Trans>
					</Button>
				</form>
			)}
		</>
	);
}

type PostForgotPasswordScreenProps = { onResend: () => Promise<void> };

function PostForgotPasswordScreen({ onResend }: PostForgotPasswordScreenProps) {
	const [resending, setResending] = useState(false);
	return (
		// Replaces the form in place: fades up into the auth column, with the layout's 24px gap.
		<div className={cn(ENTER_CLASS, "grid gap-y-6")}>
			<div className="space-y-1 text-center">
				<h1 className="text-[30px] leading-9">
					<Trans>Check your email</Trans>
				</h1>
				{/* Worded so it doesn't reveal whether an account uses the address. */}
				<p className="text-ink-3">
					<Trans>If an account uses that address, a reset link is on its way.</Trans>
				</p>
			</div>

			<Button nativeButton={false} variant="secondary" render={<Link to="/auth/login" />}>
				<Trans>Back to sign in</Trans>
			</Button>
			<p className="text-center text-sm text-ink-3">
				<Trans>Didn't get it?</Trans>{" "}
				<Button
					variant="link"
					className="h-auto px-1 py-0"
					loading={resending}
					onClick={() => {
						setResending(true);
						void onResend().finally(() => setResending(false));
					}}
				>
					<Trans>Send again</Trans>
				</Button>
			</p>
		</div>
	);
}
