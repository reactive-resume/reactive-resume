import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { ORPCError } from "@orpc/client";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import z from "zod";
import { Button } from "@reactive-resume/ui/components/button";
import { FormControl, FormItem, FormLabel, FormMessage } from "@reactive-resume/ui/components/form";
import { Icon } from "@reactive-resume/ui/components/icon";
import { toast } from "@reactive-resume/ui/components/toast";
import { PasswordInput } from "@/components/input/password-input";
import { getReadableErrorMessage } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";
import { useAppForm } from "@/libs/tanstack-form";

const formSchema = z.object({
	password: z.string().min(6).max(64),
});

type ResumePasswordPageProps = {
	username: string;
	slug: string;
	redirectPath: string;
};

export function ResumePasswordPage({ username, slug, redirectPath }: ResumePasswordPageProps) {
	const navigate = useNavigate();

	const { mutate: verifyPassword } = useMutation(orpc.resume.verifyPassword.mutationOptions());

	const form = useAppForm({
		defaultValues: { password: "" },
		validators: { onSubmit: formSchema },
		onSubmit: ({ value, formApi }) => {
			const toastId = toast.add({ type: "loading", description: t`Verifying password...` });

			verifyPassword(
				{ username, slug, password: value.password },
				{
					onSuccess: () => {
						toast.close(toastId);
						void navigate({ to: redirectPath, replace: true });
					},
					onError: (error) => {
						if (error instanceof ORPCError && error.code === "INVALID_PASSWORD") {
							toast.close(toastId);
							formApi.setFieldMeta("password", (meta) => ({
								...meta,
								isTouched: true,
								errors: [{ message: t`The password you entered is incorrect` }],
								errorMap: {
									...meta.errorMap,
									onSubmit: { message: t`The password you entered is incorrect` },
								},
							}));
						} else {
							toast.add({
								type: "error",
								description: getReadableErrorMessage(
									error,
									t({
										comment: "Fallback toast when resume password verification fails unexpectedly",
										message: "Failed to verify the password. Please try again.",
									}),
								),
								id: toastId,
							});
						}
					},
				},
			);
		},
	});

	return (
		<>
			<div className="space-y-4 text-center">
				<h1 className="text-2xl font-semibold tracking-tight">
					<Trans>This resume is password protected</Trans>
				</h1>

				<div className="leading-relaxed text-ink-3">
					<Trans>Enter the password the resume owner shared with you.</Trans>
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
								<Trans comment="Label for password input on protected resume access form">Password</Trans>
							</FormLabel>
							<FormControl
								render={
									<PasswordInput
										min={6}
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

				<Button type="submit" className="w-full">
					<Icon name="lock_open" size={16} />
					<Trans comment="Primary action button label to unlock a password-protected resume">Unlock</Trans>
				</Button>
			</form>
		</>
	);
}
