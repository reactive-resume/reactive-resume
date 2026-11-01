import type { DialogProps } from "../store";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useSelector } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
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
import { getOrpcErrorMessage } from "@/libs/error-message";
import { client } from "@/libs/orpc/client";
import { useAppForm } from "@/libs/tanstack-form";

const formSchema = z.object({
	newPassword: z
		.string()
		.min(8, { error: () => t`Use at least 8 characters.` })
		.max(64, { error: () => t`Use 64 characters or fewer.` }),
});

/**
 * Adds a password to an account that signs in another way. Unlike account recovery it signs nobody out and keeps API
 * keys, passkeys and connected apps.
 */
export function SetPasswordDialog(_: DialogProps<"auth.set-password">) {
	const queryClient = useQueryClient();
	const closeDialog = useDialogStore((state) => state.closeDialog);

	const form = useAppForm({
		defaultValues: { newPassword: "" },
		validators: { onSubmit: formSchema },
		onSubmit: async ({ value }) => {
			const toastId = toast.add({ type: "loading", description: t`Setting your password…` });
			try {
				await client.auth.setPassword({ newPassword: value.newPassword });
			} catch (error) {
				toast.add({
					type: "error",
					description: getOrpcErrorMessage(error, {
						fallback: t`Couldn't set your password. Try again.`,
						allowServerMessage: true,
					}),
					id: toastId,
				});
				return;
			}
			toast.add({ type: "success", description: t`Password set. You can now sign in with it too.`, id: toastId });
			void queryClient.invalidateQueries({ queryKey: ["auth", "accounts"] });
			closeDialog();
		},
	});

	const isSubmitting = useSelector(form.store, (state) => state.isSubmitting);

	useFormBlocker(form);

	return (
		<DialogContent closeLabel={t`Close`}>
			<DialogHeader>
				<DialogTitle className="flex items-center gap-x-2">
					<Icon name="password" size={16} />
					<Trans>Set a password</Trans>
				</DialogTitle>
				<DialogDescription>
					<Trans>
						Add a password as another way to sign in. Your other sign-in methods and devices stay as they are.
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
				<form.Field name="newPassword">
					{(field) => (
						<FormItem hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
							<FormLabel>
								<Trans>New password</Trans>
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

				<DialogFooter>
					<Button type="submit" disabled={isSubmitting}>
						<Trans comment="Primary action button to add a password to an account without one">Set password</Trans>
					</Button>
				</DialogFooter>
			</form>
		</DialogContent>
	);
}
