import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
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
	email: z.email(),
});

export function ForgotPasswordPage() {
	const [submitted, setSubmitted] = useState(false);

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
							message: "Failed to send password reset email. Please try again.",
						}),
					id: toastId,
				});
				return;
			}

			setSubmitted(true);
			toast.close(toastId);
		},
	});

	if (submitted) return <PostForgotPasswordScreen />;

	return (
		<>
			<div className="space-y-1 text-center">
				<h1 className="text-2xl font-semibold tracking-tight">
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
									<Icon name="arrow_forward" size={16} />
								</Link>
							}
						/>
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
				<form.Field name="email">
					{(field) => (
						<FormItem hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
							<FormLabel>
								<Trans comment="Label for email input on forgot-password form">Email Address</Trans>
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

				<Button type="submit" className="w-full">
					<Trans comment="Primary action button label on forgot-password form">Send Password Reset Email</Trans>
				</Button>
			</form>
		</>
	);
}

function PostForgotPasswordScreen() {
	return (
		// Replaces the form in place: fades up into the auth column, with the layout's 24px gap.
		<div className={cn(ENTER_CLASS, "grid gap-y-6")}>
			<div className="space-y-1 text-center">
				<h1 className="text-2xl font-semibold tracking-tight">
					<Trans>You've got mail!</Trans>
				</h1>
				<p className="text-ink-3">
					<Trans>Check your email for a link to reset your password.</Trans>
				</p>
			</div>

			<Button
				nativeButton={false}
				render={
					<a href="mailto:">
						<Trans comment="Button label to open the user's default email app">Open Email Client</Trans>
					</a>
				}
			/>
		</div>
	);
}
