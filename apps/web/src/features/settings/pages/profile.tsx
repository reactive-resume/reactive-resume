import type { AuthSession } from "@reactive-resume/auth/types";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { CheckIcon, WarningIcon } from "@phosphor-icons/react";
import { useStore } from "@tanstack/react-form";
import { useRouteContext, useRouter } from "@tanstack/react-router";
import { AnimatePresence, m } from "motion/react";
import z from "zod";
import { Button } from "@reactive-resume/ui/components/button";
import { FormControl, FormItem, FormLabel, FormMessage } from "@reactive-resume/ui/components/form";
import { Input } from "@reactive-resume/ui/components/input";
import { toast } from "@reactive-resume/ui/components/toast";
import { authClient } from "@/libs/auth/client";
import { getReadableErrorMessage } from "@/libs/error-message";
import { EASE_OUT_STRONG } from "@/libs/motion";
import { useAppForm } from "@/libs/tanstack-form";

const formSchema = z.object({
	name: z.string().trim().min(1).max(64),
	username: z
		.string()
		.trim()
		.min(1)
		.max(64)
		.regex(/^[a-z0-9._-]+$/, {
			message: "Username can only contain lowercase letters, numbers, dots, hyphens and underscores.",
		}),
	email: z.email().trim(),
});

type Props = {
	session: AuthSession;
};

export function ProfileSettingsPage({ session }: Props) {
	const router = useRouter();
	const context = useRouteContext({ strict: false });
	const smtpEnabled = context.flags?.smtpEnabled ?? false;

	const form = useAppForm({
		defaultValues: {
			name: session.user.name,
			username: session.user.username,
			email: session.user.email,
		},
		validators: { onSubmit: formSchema },
		onSubmit: async ({ value }) => {
			const { error } = await authClient.updateUser({
				name: value.name,
				username: value.username,
				displayUsername: value.username,
			});

			if (error) {
				toast.add({
					type: "error",
					description: getReadableErrorMessage(
						error,
						t({
							comment: "Fallback toast when updating profile details fails",
							message: "Failed to update your profile. Please try again.",
						}),
					),
				});
				return;
			}

			toast.add({ type: "success", description: t`Your profile has been updated.` });
			form.reset({ name: value.name, username: value.username, email: session.user.email });
			void router.invalidate();

			if (value.email !== session.user.email) {
				const { error } = await authClient.changeEmail({
					newEmail: value.email,
					callbackURL: "/dashboard/settings/profile",
				});

				if (error) {
					toast.add({
						type: "error",
						description: getReadableErrorMessage(
							error,
							t({
								comment: "Fallback toast when requesting email change confirmation fails",
								message: "Failed to request email change. Please try again.",
							}),
						),
					});
					return;
				}

				toast.add({
					type: "success",
					description: t`We sent a confirmation link to your new email address. Open it to confirm the change.`,
				});
				form.reset({ name: value.name, username: value.username, email: session.user.email });
				void router.invalidate();
			}
		},
	});

	const onCancel = () => {
		form.reset();
	};

	const isDirty = useStore(form.store, (s) => s.isDirty);

	const handleResendVerificationEmail = async () => {
		const toastId = toast.add({ type: "loading", description: t`Resending verification email...` });

		const { error } = await authClient.sendVerificationEmail({
			email: session.user.email,
			callbackURL: "/dashboard/settings/profile",
		});

		if (error) {
			toast.add({
				type: "error",
				description: getReadableErrorMessage(
					error,
					t({
						comment: "Fallback toast when resending account verification email fails",
						message: "Failed to resend verification email. Please try again.",
					}),
				),
				id: toastId,
			});
			return;
		}

		toast.add({
			type: "success",
			description: t`We sent a new verification link to your email address. Open it to verify your account.`,
			id: toastId,
		});
		void router.invalidate();
	};

	return (
		<form
			className="grid max-w-xl gap-6"
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
						<FormControl
							render={
								<Input
									min={3}
									max={64}
									autoComplete="name"
									placeholder={t({
										comment: "Example full name placeholder on profile settings form",
										message: "John Doe",
									})}
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

			<form.Field name="username">
				{(field) => (
					<FormItem hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
						<FormLabel>
							<Trans>Username</Trans>
						</FormLabel>
						<FormControl
							render={
								<Input
									min={3}
									max={64}
									autoComplete="username"
									placeholder={t({
										comment: "Example username placeholder on profile settings form",
										message: "john.doe",
									})}
									className="lowercase"
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

			<form.Field name="email">
				{(field) => (
					<FormItem hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
						<FormLabel>
							<Trans>Email Address</Trans>
						</FormLabel>
						<FormControl
							render={
								<Input
									type="email"
									autoComplete="email"
									placeholder="john.doe@example.com"
									className="lowercase"
									name={field.name}
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(event) => field.handleChange(event.target.value)}
								/>
							}
						/>
						<FormMessage errors={field.state.meta.errors} />
						{session.user.emailVerified === true ? (
							<p className="flex items-center gap-x-1.5 text-green-700 text-xs">
								<CheckIcon />
								<Trans>Verified</Trans>
							</p>
						) : smtpEnabled ? (
							<p className="flex items-center gap-x-1.5 text-amber-600 text-xs">
								<WarningIcon className="size-3.5" />
								<Trans>Unverified</Trans>
								<span>|</span>
								<Button
									variant="link"
									className="h-auto gap-x-1.5 p-0! text-inherit text-xs"
									onClick={handleResendVerificationEmail}
								>
									<Trans>Resend verification email</Trans>
								</Button>
							</p>
						) : (
							<p className="text-muted-foreground text-xs">
								<Trans>Email delivery isn't configured on this instance, so verification is disabled.</Trans>
							</p>
						)}
					</FormItem>
				)}
			</form.Field>

			<AnimatePresence initial={false} mode="popLayout">
				{isDirty && (
					<m.div
						initial={{ opacity: 0, y: -8 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: -8 }}
						transition={{ duration: 0.16, ease: EASE_OUT_STRONG }}
						className="flex items-center gap-x-4 justify-self-end"
					>
						<Button type="reset" variant="ghost" onClick={onCancel}>
							<Trans comment="Profile settings form action to discard unsaved edits">Cancel</Trans>
						</Button>

						<Button type="submit">
							<Trans>Save Changes</Trans>
						</Button>
					</m.div>
				)}
			</AnimatePresence>
		</form>
	);
}
