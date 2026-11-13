import type { AuthSession } from "@reactive-resume/auth/types";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouteContext, useRouter } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState } from "react";
import z from "zod";
import { Alert } from "@reactive-resume/ui/components/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@reactive-resume/ui/components/avatar";
import { Badge } from "@reactive-resume/ui/components/badge";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
	InputGroupText,
} from "@reactive-resume/ui/components/input-group";
import { toast } from "@reactive-resume/ui/components/toast";
import { getInitials } from "@reactive-resume/utils/string";
import { SettingsOpenRow, SettingsRow, SettingsSection, TextAction } from "../section";
import { useConfirm } from "@/hooks/use-confirm";
import { authClient } from "@/libs/auth/client";
import { getReadableErrorMessage } from "@/libs/error-message";
import { isImeComposing } from "@/libs/keyboard";
import { client, orpc } from "@/libs/orpc/client";
import { sessionQueryKey } from "@/libs/root-context";

const nameSchema = z.string().trim().min(1).max(64);
// Usernames are lowercase: capitals typed are taken as their lowercase letters rather than refused.
const usernameSchema = z
	.string()
	.trim()
	.toLowerCase()
	.min(3)
	.max(64)
	.regex(/^[a-z0-9._-]+$/);
const emailSchema = z.email().trim();

type FieldProps = {
	anchor?: string;
	label: string;
	value: string;
	/** The line under the label while the row is closed; the value itself when absent. */
	display?: React.ReactNode;
	/** The closed row's action: "Edit" or "Change". Absent when the value can't be changed here. */
	action?: string | undefined;
	/** Sits before the action on the closed row: a status badge, a second action. */
	status?: React.ReactNode;
	/** Stays under the row, open or closed: a change that is waiting. */
	note?: React.ReactNode;
	/** Saves the new value; resolves to an error message, or null when it saved. */
	save: (value: string) => Promise<string | null>;
	validate: (value: string) => string | null;
	/** Asks before saving a valid change; false keeps the row open. */
	confirm?: (value: string) => Promise<boolean>;
	prefix?: string;
	hint?: React.ReactNode;
	type?: "text" | "email";
	autoComplete?: string;
};

/**
 * A text setting as a row: its value and one action. The action opens the field in the row, with Cancel and Save.
 * Invalid or failed values stay, with the reason under them.
 */
function EditableRow({
	anchor,
	label,
	value,
	display,
	action,
	status,
	note,
	save,
	validate,
	confirm,
	prefix,
	hint,
	type = "text",
	autoComplete,
}: FieldProps) {
	const id = useId();
	const [open, setOpen] = useState(false);
	const [draft, setDraft] = useState(value);
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const opener = useRef<HTMLButtonElement>(null);
	const returnFocus = useRef(false);
	// Closing hands focus back to the action that opened the row.
	useEffect(() => {
		if (open || !returnFocus.current) return;
		returnFocus.current = false;
		opener.current?.focus();
	}, [open]);

	const close = () => {
		returnFocus.current = true;
		setOpen(false);
		setError(null);
	};

	const commit = async () => {
		const next = draft.trim();
		if (next === value) return close();
		const invalid = validate(next);
		if (invalid) return setError(invalid);
		if (confirm && !(await confirm(next))) return;
		setSaving(true);
		let failure: string | null;
		try {
			failure = await save(next);
		} catch {
			failure = t`Couldn't save. Try again.`;
		}
		setSaving(false);
		if (failure) return setError(failure);
		close();
	};

	const noteRow = note && <div className="border-b border-line pb-3">{note}</div>;

	if (!open)
		return (
			<>
				<SettingsRow
					id={anchor}
					title={label}
					description={display ?? value}
					className={note ? "border-b-0" : undefined}
				>
					{status}
					{action && (
						<TextAction
							ref={opener}
							aria-label={t`${action}: ${label}`}
							onClick={() => {
								setDraft(value);
								setOpen(true);
							}}
						>
							{action}
						</TextAction>
					)}
				</SettingsRow>
				{noteRow}
			</>
		);

	const inputProps = {
		id,
		type,
		value: draft,
		autoComplete,
		autoFocus: true,
		"aria-invalid": error ? true : undefined,
		"aria-describedby": error ? `${id}-error` : hint ? `${id}-hint` : undefined,
		onChange: (event: React.ChangeEvent<HTMLInputElement>) => setDraft(event.target.value),
		onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
			if (isImeComposing(event)) return;
			if (event.key === "Escape") {
				event.preventDefault();
				close();
			}
		},
	};

	return (
		<>
			<SettingsOpenRow id={anchor} className={note ? "border-b-0 pb-3" : undefined}>
				<label htmlFor={id} className="text-[15px]/[22px] font-medium">
					{label}
				</label>
				<form
					noValidate
					className="flex flex-wrap items-center gap-2"
					onSubmit={(event) => {
						event.preventDefault();
						void commit();
					}}
				>
					{prefix ? (
						// A web address (host/username) reads left to right in every language.
						<InputGroup dir="ltr" className="min-w-48 flex-1">
							<InputGroupAddon>
								<InputGroupText className="font-mono text-[13px]">{prefix}</InputGroupText>
							</InputGroupAddon>
							<InputGroupInput {...inputProps} />
						</InputGroup>
					) : (
						<Input {...inputProps} className="min-w-48 flex-1" />
					)}
					<Button type="button" variant="ghost" disabled={saving} onClick={close}>
						<Trans>Cancel</Trans>
					</Button>
					<Button type="submit" variant="secondary" loading={saving}>
						<Trans>Save</Trans>
					</Button>
				</form>
				{error ? (
					<p id={`${id}-error`} role="alert" className="text-xs/4 text-danger-text">
						{error}
					</p>
				) : (
					hint && (
						<p id={`${id}-hint`} className="text-xs/4 text-ink-3">
							{hint}
						</p>
					)
				)}
			</SettingsOpenRow>
			{noteRow}
		</>
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

	// Show an actual public link before changing its username; still warn when the lookup is unavailable.
	const confirmUsername = async (next: string) => {
		let total = -1;
		let slug: string | null | undefined;
		try {
			const page = await client.documents.page({ type: "resume", public: true, limit: 1 });
			total = page.total;
			slug = page.items[0]?.slug;
		} catch {
			// Unknown is not none: still warn, without a count.
		}
		if (total === 0) return true;
		const oldAddress = `${host}/${user.username}${slug ? `/${slug}` : ""}`;
		const newAddress = `${host}/${next.trim().toLowerCase()}${slug ? `/${slug}` : ""}`;
		return ask(total === 1 ? t`Your public link will change` : t`Your public links will change`, {
			description: (
				<>
					<Trans>
						<code dir="ltr" className="font-mono text-xs">
							{oldAddress}
						</code>{" "}
						becomes{" "}
						<code dir="ltr" className="font-mono text-xs">
							{newAddress}
						</code>
						.
					</Trans>{" "}
					<Trans>
						Links you've already shared keep working for 30 days, then stop. Share the new ones before then.
					</Trans>
				</>
			),
			confirmText: t`Change username`,
			cancelText: t`Keep username`,
		});
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
		const { error } = await authClient.changeEmail({
			newEmail: email,
			callbackURL: `/dashboard/settings/account${window.location.search}#email`,
		});
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
			callbackURL: `/dashboard/settings/account${window.location.search}#email`,
		});
		toast.add(
			error
				? { type: "error", description: getReadableErrorMessage(error, t`Couldn't send the email. Try again.`) }
				: { type: "success", description: t`We sent a new verification link to ${user.email}.` },
		);
	};

	const noteLink = "font-semibold underline underline-offset-2";

	return (
		<SettingsSection id="account-details" title={<Trans>Account</Trans>}>
			<ProfilePhoto name={user.name} image={user.image ?? null} onChange={(image) => updateUser({ image })} />
			<EditableRow
				label={t`Name`}
				value={user.name}
				action={t`Edit`}
				autoComplete="name"
				validate={(value) => (nameSchema.safeParse(value).success ? null : t`Enter a name, up to 64 characters.`)}
				save={(name) => updateUser({ name })}
			/>
			<EditableRow
				label={t`Username`}
				value={user.username ?? ""}
				display={
					user.username ? (
						<Trans>
							<span dir="ltr" className="font-mono text-xs/4 font-medium">
								{host}/{user.username}
							</span>{" "}
							· part of every public link
						</Trans>
					) : (
						<Trans>Not set</Trans>
					)
				}
				action={t`Change`}
				prefix={`${host}/`}
				autoComplete="username"
				validate={(value) =>
					usernameSchema.safeParse(value).success
						? null
						: t`Use 3 to 64 Latin letters a–z, numbers, dots, hyphens and underscores.`
				}
				confirm={confirmUsername}
				save={(value) => {
					const username = value.trim().toLowerCase();
					return updateUser({ username, displayUsername: username });
				}}
				hint={<Trans>Part of every public link. Old links keep working for 30 days after a change.</Trans>}
			/>
			<EditableRow
				anchor="email"
				type="email"
				label={t`Email`}
				value={user.email}
				// Without email delivery neither link can arrive, so the row offers no change that could never finish.
				display={
					smtpEnabled ? undefined : (
						<Trans>
							{user.email} · This server can't send email, so the address can't be changed here. Ask the person who runs
							it.
						</Trans>
					)
				}
				action={smtpEnabled ? t`Change` : undefined}
				status={
					user.emailVerified ? (
						<Badge variant="accent">
							<Icon name="check" />
							<Trans>Verified</Trans>
						</Badge>
					) : (
						<>
							<Badge variant="neutral">
								<Trans>Not verified</Trans>
							</Badge>
							{smtpEnabled && (
								<TextAction onClick={() => void resendVerification()}>
									<Trans>Resend the link</Trans>
								</TextAction>
							)}
						</>
					)
				}
				autoComplete="email"
				validate={(value) => (emailSchema.safeParse(value).success ? null : t`Enter a valid email address.`)}
				save={changeEmail}
				hint={
					// A verified address approves the change first; an unverified one confirms the new address only.
					user.emailVerified ? (
						<Trans>Changing it asks your current address to approve, then confirms the new one.</Trans>
					) : (
						<Trans>Changing it sends a confirmation to the new address.</Trans>
					)
				}
				note={
					pendingEmail && (
						<Alert variant="info" className="block">
							{user.emailVerified ? (
								<Trans>
									Change to <b className="font-semibold">{pendingEmail}</b> is waiting for approval from {user.email}.
									The link works for an hour.
								</Trans>
							) : (
								<Trans>
									Change to <b className="font-semibold">{pendingEmail}</b> is waiting: open the link we sent there. The
									link works for an hour.
								</Trans>
							)}{" "}
							{/* With a verified address, asking again starts over from the approval link to it. */}
							<button type="button" className={noteLink} onClick={() => void resendEmailChange(pendingEmail)}>
								<Trans>Send it again</Trans>
							</button>
							{" · "}
							<button type="button" className={noteLink} onClick={() => setPendingEmail(null)}>
								<Trans>Cancel</Trans>
							</button>
						</Alert>
					)
				}
			/>
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
	const router = useRouter();
	const queryClient = useQueryClient();
	// The note goes when its link expires, even with the page left open.
	useEffect(() => {
		if (!pending) return;
		const timer = window.setTimeout(() => setPending(null), Math.max(0, pending.at + EMAIL_CHANGE_TTL_MS - Date.now()));
		return () => window.clearTimeout(timer);
	}, [pending]);
	// Finishing the change in another tab or the mail app: coming back reads the account again, so the note clears.
	useEffect(() => {
		if (!current) return;
		const refresh = () => {
			if (document.visibilityState !== "visible") return;
			void queryClient.invalidateQueries({ queryKey: sessionQueryKey }).then(() => router.invalidate());
		};
		window.addEventListener("focus", refresh);
		document.addEventListener("visibilitychange", refresh);
		return () => {
			window.removeEventListener("focus", refresh);
			document.removeEventListener("visibilitychange", refresh);
		};
	}, [current, queryClient, router]);
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
		<SettingsRow
			leading={
				<Avatar size="lg">
					<AvatarImage src={image ?? undefined} alt="" />
					<AvatarFallback>{getInitials(name)}</AvatarFallback>
				</Avatar>
			}
			title={<Trans>Photo</Trans>}
			description={<Trans>Shown in the app only. Each resume keeps its own picture.</Trans>}
		>
			<input
				ref={input}
				type="file"
				accept="image/*"
				className="sr-only"
				tabIndex={-1}
				aria-hidden
				onChange={(event) => choose(event.target.files?.[0])}
			/>
			{image && (
				<TextAction onClick={() => void onChange(null)}>
					<Trans>Remove photo</Trans>
				</TextAction>
			)}
			<TextAction loading={upload.isPending} onClick={() => input.current?.click()}>
				<Trans>Change photo</Trans>
			</TextAction>
		</SettingsRow>
	);
}
