import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { ORPCError } from "@orpc/client";
import { EyeIcon, EyeSlashIcon, LockOpenIcon } from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useToggle } from "usehooks-ts";
import z from "zod";
import { Button } from "@reactive-resume/ui/components/button";
import { FormControl, FormItem, FormLabel, FormMessage } from "@reactive-resume/ui/components/form";
import { Input } from "@reactive-resume/ui/components/input";
import { toast } from "@reactive-resume/ui/components/toast";
import { getReadableErrorMessage } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";
import { useAppForm } from "@/libs/tanstack-form";

const formSchema = z.object({
	password: z.string().min(1),
	displayName: z.string().trim().min(1).max(80),
});

type CritiquePasswordPageProps = {
	username: string;
	slug: string;
	redirectPath: string;
};

export function CritiquePasswordPage({ username, slug, redirectPath }: CritiquePasswordPageProps) {
	const navigate = useNavigate();
	const [showPassword, toggleShowPassword] = useToggle(false);

	const { mutate: verify } = useMutation(orpc.resume.critique.verify.mutationOptions());

	const form = useAppForm({
		defaultValues: { password: "", displayName: "" },
		validators: { onSubmit: formSchema },
		onSubmit: ({ value, formApi }) => {
			const toastId = toast.add({ type: "loading", description: t`Verifying password...` });

			verify(
				{ username, slug, password: value.password, displayName: value.displayName },
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
										comment: "Fallback toast when critique password verification fails unexpectedly",
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
				<h1 className="font-semibold text-2xl tracking-tight">
					<Trans>Leave feedback on this resume</Trans>
				</h1>

				<div className="text-muted-foreground leading-relaxed">
					<Trans>Enter the password the resume owner shared with you, and let us know who you are.</Trans>
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
				<form.Field name="displayName">
					{(field) => (
						<FormItem hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
							<FormLabel>
								<Trans comment="Label for the critiquer's own name input on the feedback access form">Your Name</Trans>
							</FormLabel>
							<FormControl
								render={
									<Input
										autoComplete="name"
										name={field.name}
										value={field.state.value}
										onBlur={field.handleBlur}
										onChange={(event) => field.handleChange(event.target.value)}
										placeholder={t`e.g. Jane - Career Coach`}
									/>
								}
							/>
							<FormMessage errors={field.state.meta.errors} />
						</FormItem>
					)}
				</form.Field>

				<form.Field name="password">
					{(field) => (
						<FormItem hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
							<FormLabel>
								<Trans comment="Label for password input on feedback access form">Password</Trans>
							</FormLabel>
							<div className="flex items-center gap-x-1.5">
								<FormControl
									render={
										<Input
											type={showPassword ? "text" : "password"}
											autoComplete="current-password"
											name={field.name}
											value={field.state.value}
											onBlur={field.handleBlur}
											onChange={(event) => field.handleChange(event.target.value)}
										/>
									}
								/>

								<Button
									size="icon"
									variant="ghost"
									onClick={toggleShowPassword}
									aria-label={
										showPassword
											? t({
													comment: "Accessible label for button that hides password on feedback access screen",
													message: "Hide password",
												})
											: t({
													comment: "Accessible label for button that reveals password on feedback access screen",
													message: "Show password",
												})
									}
								>
									{showPassword ? <EyeIcon /> : <EyeSlashIcon />}
								</Button>
							</div>
							<FormMessage errors={field.state.meta.errors} />
						</FormItem>
					)}
				</form.Field>

				<Button type="submit" className="w-full">
					<LockOpenIcon />
					<Trans comment="Primary action button label to unlock a resume's feedback link">Continue</Trans>
				</Button>
			</form>
		</>
	);
}
