import type { AuthSession } from "@reactive-resume/auth/types";
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouteContext, useRouter } from "@tanstack/react-router";
import { useId, useRef, useState } from "react";
import z from "zod";
import { Avatar, AvatarFallback, AvatarImage } from "@reactive-resume/ui/components/avatar";
import { Button } from "@reactive-resume/ui/components/button";
import { Input } from "@reactive-resume/ui/components/input";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
	InputGroupText,
} from "@reactive-resume/ui/components/input-group";
import { toast } from "@reactive-resume/ui/components/toast";
import { getInitials } from "@reactive-resume/utils/string";
import { cn } from "@reactive-resume/utils/style";
import { SettingsSection } from "../section";
import { useConfirm } from "@/hooks/use-confirm";
import { authClient } from "@/libs/auth/client";
import { getReadableErrorMessage } from "@/libs/error-message";
import { isImeComposing } from "@/libs/keyboard";
import { client, orpc } from "@/libs/orpc/client";
import { sessionQueryKey } from "@/libs/root-context";

const nameSchema = z.string().trim().min(1).max(64);
const usernameSchema = z
	.string()
	.trim()
	.min(3)
	.max(64)
	.regex(/^[a-z0-9._-]+$/);
const emailSchema = z.email().trim();

type FieldProps = {
	label: string;
	value: string;
	/** Saves the new value; resolves to an error message, or null when it saved. */
	save: (value: string) => Promise<string | null>;
	validate: (value: string) => string | null;
	/** Asks before saving a valid change; false puts the saved value back. */
	confirm?: (value: string) => Promise<boolean>;
	prefix?: string;
	hint?: React.ReactNode;
	type?: "text" | "email";
	autoComplete?: string;
	className?: string;
	/** After a save the field shows `value` again: an email change waits for approval, so the address hasn't changed. */
	resetOnSave?: boolean;
};

/** A text setting that saves when it loses focus. Invalid or failed values stay, with the reason under them. */
function SavedField({
	label,
	value,
	save,
	validate,
	confirm,
	prefix,
	hint,
	type = "text",
	autoComplete,
	className,
	resetOnSave = false,
}: FieldProps) {
	const id = useId();
	const [draft, setDraft] = useState(value);
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);

	const commit = async () => {
		const next = draft.trim();
		if (next === value) return setError(null);
		const invalid = validate(next);
		if (invalid) return setError(invalid);
		if (confirm && !(await confirm(next))) {
			setDraft(value);
			return setError(null);
		}
		setSaving(true);
		let failure: string | null;
		try {
			failure = await save(next);
		} catch {
			failure = t`Couldn't save. Try again.`;
		}
		setSaving(false);
		setError(failure);
		if (!failure && resetOnSave) setDraft(value);
	};

	const inputProps = {
		id,
		type,
		value: draft,
		autoComplete,
		"aria-invalid": error ? true : undefined,
		"aria-describedby": error ? `${id}-error` : hint ? `${id}-hint` : undefined,
		"aria-busy": saving || undefined,
		onChange: (event: React.ChangeEvent<HTMLInputElement>) => setDraft(event.target.value),
		onBlur: () => void commit(),
		onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
			if (isImeComposing(event)) return;
			if (event.key === "Enter") event.currentTarget.blur();
			if (event.key === "Escape") {
				setDraft(value);
				setError(null);
			}
		},
	};

	return (
		<div className={cn("grid content-start gap-1.5", className)}>
			<label htmlFor={id} className="text-xs font-medium text-ink-2">
				{label}
			</label>
			{prefix ? (
				<InputGroup>
					<InputGroupAddon>
						<InputGroupText>{prefix}</InputGroupText>
					</InputGroupAddon>
					<InputGroupInput {...inputProps} />
				</InputGroup>
			) : (
				<Input {...inputProps} />
			)}
			{error ? (
				<p id={`${id}-error`} role="alert" className="text-xs text-danger-text">
					{error}
				</p>
			) : (
				hint && (
					<p id={`${id}-hint`} className="text-xs text-ink-3">
						{hint}
					</p>
				)
			)}
		</div>
	);
}

type ProfileSectionProps = { session: AuthSession };

export function ProfileSection({ session }: ProfileSectionProps) {
	const router = useRouter();
	const queryClient = useQueryClient();
	const context = useRouteContext({ strict: false });
	const smtpEnabled = context.flags?.smtpEnabled ?? false;
	const user = session.user;
	const host = window.location.host;
	const ask = useConfirm();

	// The username is part of every public link: changing it moves them, so say how many first.
	const confirmUsername = async () => {
		let total: number;
		try {
			({ total } = await client.documents.page({ type: "resume", public: true, limit: 1 }));
		} catch {
			// Unknown is not none: still warn, without a count.
			total = -1;
		}
		if (total === 0) return true;
		return ask(
			total > 0
				? plural(total, { one: "# public link will change", other: "# public links will change" })
				: t`Your public links will change`,
			{
				description: t`Links you've already shared keep working for 30 days, then stop. Share the new ones before then.`,
				confirmText: t`Change username`,
				cancelText: t`Keep username`,
			},
		);
	};

	const updateUser = async (patch: Parameters<typeof authClient.updateUser>[0]) => {
		const { error } = await authClient.updateUser(patch);
		if (error) return getReadableErrorMessage(error, t`Couldn't save. Try again.`);
		await queryClient.invalidateQueries({ queryKey: sessionQueryKey });
		await router.invalidate();
		return null;
	};

	const [pendingEmail, setPendingEmail] = usePendingEmailChange(user.id, user.email);
	const changeEmail = async (email: string) => {
		// Without email delivery the approval link never arrives, so the change could never finish.
		if (!smtpEnabled)
			return t`This server can't send email, so the address can't be changed here. Ask the person who runs it.`;
		const { error } = await authClient.changeEmail({ newEmail: email, callbackURL: "/dashboard/settings/account" });
		if (error) return getReadableErrorMessage(error, t`Couldn't change the email. Try again.`);
		// A verified address approves the change first; Better Auth then sends the new address its own link.
		const currentEmail = user.email;
		setPendingEmail(email);
		toast.add({
			type: "success",
			description: user.emailVerified
				? t`We sent a link to ${currentEmail} to approve the change. Then open the link we send to ${email}.`
				: t`We sent a confirmation link to ${email}. Open it to finish the change.`,
		});
		return null;
	};
	const resendEmailChange = async (email: string) => {
		const failure = await changeEmail(email);
		if (failure) toast.add({ type: "error", description: failure });
	};

	const resendVerification = async () => {
		const { error } = await authClient.sendVerificationEmail({
			email: user.email,
			callbackURL: "/dashboard/settings/account",
		});
		toast.add(
			error
				? { type: "error", description: getReadableErrorMessage(error, t`Couldn't send the email. Try again.`) }
				: { type: "success", description: t`We sent a new verification link to ${user.email}.` },
		);
	};

	return (
		<SettingsSection title={<Trans>Account details</Trans>}>
			<ProfilePhoto name={user.name} image={user.image ?? null} onChange={(image) => updateUser({ image })} />

			<div className="grid gap-3 sm:grid-cols-2">
				<SavedField
					label={t`Name`}
					value={user.name}
					autoComplete="name"
					validate={(value) => (nameSchema.safeParse(value).success ? null : t`Enter a name, up to 64 characters.`)}
					save={(name) => updateUser({ name })}
				/>
				<SavedField
					label={t`Username`}
					value={user.username ?? ""}
					prefix={`${host}/`}
					autoComplete="username"
					validate={(value) =>
						usernameSchema.safeParse(value).success
							? null
							: t`Use 3 to 64 lowercase letters, numbers, dots, hyphens and underscores.`
					}
					confirm={confirmUsername}
					save={(username) => updateUser({ username, displayUsername: username })}
					hint={<Trans>Part of every public link. Old links keep working for 30 days after a change.</Trans>}
				/>
				<SavedField
					className="sm:col-span-2"
					type="email"
					label={t`Email`}
					value={user.email}
					autoComplete="email"
					validate={(value) => (emailSchema.safeParse(value).success ? null : t`Enter a valid email address.`)}
					save={changeEmail}
					resetOnSave
					hint={
						<>
							{pendingEmail ? (
								<>
									{user.emailVerified ? (
										<Trans>
											Change to {pendingEmail} is waiting for approval from {user.email}. The link works for an hour.
										</Trans>
									) : (
										<Trans>
											Change to {pendingEmail} is waiting: open the link we sent there. The link works for an hour.
										</Trans>
									)}{" "}
									<button
										type="button"
										className="underline underline-offset-2"
										onClick={() => void resendEmailChange(pendingEmail)}
									>
										<Trans>Resend</Trans>
									</button>
									{" · "}
									<button type="button" className="underline underline-offset-2" onClick={() => setPendingEmail(null)}>
										<Trans>Cancel</Trans>
									</button>
								</>
							) : (
								<Trans>
									Changing it sends a confirmation to the new address. Your username is part of every public link.
								</Trans>
							)}{" "}
							{user.emailVerified ? null : smtpEnabled ? (
								<button
									type="button"
									className="underline underline-offset-2"
									onClick={() => void resendVerification()}
								>
									<Trans>Not verified yet. Resend the link</Trans>
								</button>
							) : (
								<Trans>Email delivery isn't set up on this server, so the address isn't verified.</Trans>
							)}
						</>
					}
				/>
			</div>
		</SettingsSection>
	);
}

// Better Auth's change-email link expires after an hour (`emailVerification.expiresIn`).
const EMAIL_CHANGE_TTL_MS = 60 * 60 * 1000;

/**
 * The address an email change is waiting on, kept on this device so it survives a reload. It clears once the account
 * has the new address or the link has expired; Cancel only forgets it here, and the link expires on its own.
 */
function usePendingEmailChange(userId: string, currentEmail: string) {
	const key = `reactive-resume:email-change:${userId}`;
	const [pending, setPending] = useState<{ email: string; at: number } | null>(() => {
		try {
			const stored = JSON.parse(window.localStorage.getItem(key) ?? "null") as { email?: unknown; at?: unknown };
			// An expired link can't finish the change, so its note isn't brought back.
			return typeof stored?.email === "string" &&
				typeof stored.at === "number" &&
				Date.now() - stored.at < EMAIL_CHANGE_TTL_MS
				? { email: stored.email, at: stored.at }
				: null;
		} catch {
			return null;
		}
	});
	const current = pending && pending.email !== currentEmail ? pending.email : null;
	const set = (email: string | null) => {
		const next = email ? { email, at: Date.now() } : null;
		setPending(next);
		try {
			if (next) window.localStorage.setItem(key, JSON.stringify(next));
			else window.localStorage.removeItem(key);
		} catch {
			// Blocked storage keeps the note for this visit only.
		}
	};
	return [current, set] as const;
}

type ProfilePhotoProps = {
	name: string;
	image: string | null;
	onChange: (image: string | null) => Promise<string | null>;
};

/** The account photo, shown in the app. Resumes keep their own picture. */
function ProfilePhoto({ name, image, onChange }: ProfilePhotoProps) {
	const input = useRef<HTMLInputElement>(null);
	const upload = useMutation(orpc.storage.uploadFile.mutationOptions({ meta: { noInvalidate: true } }));

	const choose = (file: File | undefined) => {
		if (!file) return;
		upload.mutate(file, {
			onSuccess: async ({ url }) => {
				const failure = await onChange(url);
				if (failure) toast.add({ type: "error", description: failure });
			},
			onError: (error) =>
				toast.add({
					type: "error",
					description: getReadableErrorMessage(error, t`Couldn't upload the photo. Try again.`),
				}),
			onSettled: () => {
				if (input.current) input.current.value = "";
			},
		});
	};

	return (
		<div className="flex items-center gap-3.5">
			<Avatar className="size-14">
				<AvatarImage src={image ?? undefined} alt="" />
				<AvatarFallback className="bg-accent-soft text-lg font-semibold text-accent-text">
					{getInitials(name)}
				</AvatarFallback>
			</Avatar>
			<input
				ref={input}
				type="file"
				accept="image/*"
				className="sr-only"
				tabIndex={-1}
				aria-hidden
				onChange={(event) => choose(event.target.files?.[0])}
			/>
			<Button size="sm" variant="secondary" loading={upload.isPending} onClick={() => input.current?.click()}>
				<Trans>Change photo</Trans>
			</Button>
			{image && (
				<Button size="sm" variant="ghost" onClick={() => void onChange(null)}>
					<Trans>Remove photo</Trans>
				</Button>
			)}
		</div>
	);
}
