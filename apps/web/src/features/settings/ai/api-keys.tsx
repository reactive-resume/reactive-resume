import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useCopyToClipboard } from "usehooks-ts";
import { Button } from "@reactive-resume/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@reactive-resume/ui/components/dialog";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { Label } from "@reactive-resume/ui/components/label";
import { Skeleton } from "@reactive-resume/ui/components/skeleton";
import { Swap } from "@reactive-resume/ui/components/swap";
import { toast } from "@reactive-resume/ui/components/toast";
import { cn } from "@reactive-resume/utils/style";
import { SettingsSection } from "../section";
import { authClient } from "@/libs/auth/client";
import { getReadableErrorMessage } from "@/libs/error-message";
import { ENTER_CLASS } from "@/libs/motion";
import { client } from "@/libs/orpc/client";

const KEYS = ["auth", "api-keys"];
const DAY = 24 * 60 * 60;

type ApiKey = {
	id: string;
	name: string | null;
	start: string | null;
	createdAt: Date;
	lastRequest: Date | null;
	expiresAt: Date | null;
};

const shortDate = (date: Date) =>
	date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export function ApiKeysSection() {
	const queryClient = useQueryClient();
	const [creating, setCreating] = useState(false);
	const { data: keys = [], isLoading } = useQuery({
		queryKey: KEYS,
		queryFn: () => authClient.apiKey.list(),
		// A revoked key is turned off at once and deleted when its Undo toast goes; it's never listed.
		select: ({ data }) =>
			(data?.apiKeys ?? [])
				.filter((key) => key.enabled && (!key.expiresAt || key.expiresAt.getTime() > Date.now()))
				.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()) as ApiKey[],
	});
	const refresh = () => queryClient.invalidateQueries({ queryKey: KEYS });

	const revoke = async (key: ApiKey) => {
		const { error } = await authClient.apiKey.update({ keyId: key.id, enabled: false });
		if (error) {
			toast.add({ type: "error", description: getReadableErrorMessage(error, t`Couldn't revoke the key.`) });
			return;
		}
		await refresh();

		let undone = false;
		const name = key.name || key.start || t`the key`;
		toast.add({
			description: t`Revoked “${name}”. Apps using it stop working now.`,
			actionProps: {
				children: t`Undo`,
				onClick: async () => {
					undone = true;
					await authClient.apiKey.update({ keyId: key.id, enabled: true });
					await refresh();
				},
			},
			onClose: () => {
				if (!undone) void authClient.apiKey.delete({ keyId: key.id });
			},
		});
	};

	return (
		<SettingsSection
			title={<Trans>API keys</Trans>}
			description={
				<Trans>For scripts, extensions and MCP clients. Keys act as you and can read and edit your documents.</Trans>
			}
			action={
				<Button size="sm" variant="secondary" onClick={() => setCreating(true)}>
					<Icon name="add" size={18} />
					<Trans>New key</Trans>
				</Button>
			}
		>
			{isLoading ? (
				<Skeleton className="h-14 rounded-xl" />
			) : keys.length === 0 ? (
				<p className="rounded-xl border border-dashed border-line-2 p-4 text-sm text-ink-2 transition-opacity duration-standard ease-enter starting:opacity-0">
					<Trans>No keys yet.</Trans>
				</p>
			) : (
				<table className="w-full overflow-hidden rounded-xl text-[13px] outline outline-line transition-opacity duration-standard ease-enter max-sm:block starting:opacity-0">
					<caption className="sr-only">
						<Trans>API keys</Trans>
					</caption>
					<thead className="bg-bg text-xs text-ink-3 max-sm:hidden">
						<tr className="h-9 text-start">
							<th scope="col" className="ps-3.5 text-start font-medium">
								<Trans>Name</Trans>
							</th>
							<th scope="col" className="text-start font-medium">
								<Trans>Created</Trans>
							</th>
							<th scope="col" className="text-start font-medium">
								<Trans>Last used</Trans>
							</th>
							<th scope="col" className="text-start font-medium">
								<Trans>Expires</Trans>
							</th>
							<th scope="col" className="pe-3.5">
								<span className="sr-only">
									<Trans>Actions</Trans>
								</span>
							</th>
						</tr>
					</thead>
					<tbody className="max-sm:block">
						{keys.map((key) => (
							<tr
								key={key.id}
								className="h-12 border-t border-line max-sm:flex max-sm:h-auto max-sm:flex-wrap max-sm:items-center max-sm:gap-x-3 max-sm:gap-y-0.5 max-sm:p-3 max-sm:first:border-t-0"
							>
								<td className="ps-3.5 font-medium max-sm:w-full max-sm:ps-0">
									{key.name || <span className="font-mono text-ink-2">{key.start}…</span>}
								</td>
								<td className="text-ink-2 max-sm:text-xs">
									<span className="sm:hidden">
										<Trans>Created</Trans>{" "}
									</span>
									{shortDate(key.createdAt)}
								</td>
								<td className="text-ink-2 max-sm:text-xs">
									<span className="sm:hidden">
										<Trans>Last used</Trans>{" "}
									</span>
									{key.lastRequest ? shortDate(key.lastRequest) : <Trans>Never</Trans>}
								</td>
								<td className="text-ink-2 max-sm:text-xs">
									<span className="sm:hidden">
										<Trans>Expires</Trans>{" "}
									</span>
									{key.expiresAt ? shortDate(key.expiresAt) : <Trans>Never</Trans>}
								</td>
								<td className="pe-2 text-end max-sm:ms-auto max-sm:pe-0">
									<Button
										size="sm"
										variant="ghost"
										className="text-danger-text hover:bg-danger-soft"
										aria-label={t`Revoke ${key.name || key.start || ""}`}
										onClick={() => void revoke(key)}
									>
										<Trans>Revoke</Trans>
									</Button>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			)}

			<NewKeyDialog open={creating} onOpenChange={setCreating} onCreated={() => void refresh()} />
		</SettingsSection>
	);
}

type Expiry = { label: () => string; seconds: number | null };

const EXPIRIES: Expiry[] = [
	{ label: () => t`30 days`, seconds: 30 * DAY },
	{ label: () => t`90 days`, seconds: 90 * DAY },
	{ label: () => t`Never`, seconds: null },
];

type NewKeyDialogProps = { open: boolean; onOpenChange: (open: boolean) => void; onCreated: () => void };

/** Name and expiry, then the key, shown once with Copy. */
function NewKeyDialog({ open, onOpenChange, onCreated }: NewKeyDialogProps) {
	const id = useId();
	const [name, setName] = useState("");
	const [expiry, setExpiry] = useState(0);
	const [access, setAccess] = useState<"read" | "full">("full");
	const [key, setKey] = useState<string | null>(null);
	const [failure, setFailure] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);
	const [copied, setCopied] = useState(false);
	const [, copy] = useCopyToClipboard();

	// Everything clears once the dialog has faded out, so the key doesn't turn back into the form while it does.
	const reset = () => {
		setName("");
		setExpiry(0);
		setAccess("full");
		setKey(null);
		setFailure(null);
		setCopied(false);
	};

	const create = async () => {
		setCreating(true);
		setFailure(null);
		try {
			const data = await client.auth.createApiKey({
				name: name.trim(),
				expiresIn: EXPIRIES[expiry]?.seconds ?? null,
				access,
			});
			setKey(data.key);
			onCreated();
		} catch (error) {
			setFailure(getReadableErrorMessage(error, t`Couldn't create the key. Try again.`));
		} finally {
			setCreating(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange} onOpenChangeComplete={(next) => !next && reset()}>
			<DialogContent className="sm:max-w-[500px]">
				<DialogHeader>
					<DialogTitle>
						<Trans>New API key</Trans>
					</DialogTitle>
					<DialogDescription className={cn(key && "sr-only")}>
						<Trans>Keys act as you and can read and edit your documents.</Trans>
					</DialogDescription>
				</DialogHeader>

				{key ? (
					<div className={cn(ENTER_CLASS, "grid gap-3")}>
						<p
							role="status"
							className="flex gap-2.5 rounded-[10px] bg-warn-soft px-3 py-2.5 text-[13px] text-warn-text"
						>
							<Icon name="key" size={20} />
							<Trans>Copy it now. For your security, it won't be shown again.</Trans>
						</p>
						<div className="flex h-[42px] items-center gap-2 rounded-lg border border-line-2 bg-bg ps-3 pe-1.5 font-mono text-[13px]">
							<span className="min-w-0 flex-1 truncate">{key}</span>
							<Button
								size="sm"
								variant="secondary"
								onClick={async () => {
									await copy(key);
									setCopied(true);
									setTimeout(() => setCopied(false), 2000);
								}}
							>
								<Swap
									swapped={copied}
									from={
										<>
											<Icon name="content_copy" size={16} />
											<Trans>Copy</Trans>
										</>
									}
									to={
										<>
											<Icon name="check" size={16} />
											<Trans>Copied</Trans>
										</>
									}
								/>
							</Button>
						</div>
						<DialogFooter>
							<Button onClick={() => onOpenChange(false)}>
								<Trans>Done</Trans>
							</Button>
						</DialogFooter>
					</div>
				) : (
					<form
						className="grid gap-4"
						onSubmit={(event) => {
							event.preventDefault();
							if (name.trim()) void create();
						}}
					>
						<div className="grid gap-1.5">
							<Label htmlFor={`${id}-name`}>
								<Trans>What's it for?</Trans>
							</Label>
							<Input
								id={`${id}-name`}
								value={name}
								maxLength={64}
								placeholder={t`Claude Desktop`}
								onChange={(event) => setName(event.target.value)}
							/>
						</div>
						<div className="grid gap-1.5">
							<Label htmlFor={`${id}-access`}>
								<Trans>Access</Trans>
							</Label>
							<select
								id={`${id}-access`}
								value={access}
								onChange={(event) => setAccess(event.target.value === "read" ? "read" : "full")}
								className="h-9 rounded-lg border border-line-2 bg-bg px-3 text-sm"
							>
								<option value="read">{t`Read only`}</option>
								<option value="full">{t`Read, write and delete`}</option>
							</select>
						</div>
						<fieldset className="grid gap-1.5">
							<legend className="mb-1.5 text-sm font-medium">
								<Trans>Expires</Trans>
							</legend>
							<div className="grid grid-cols-3 gap-2">
								{EXPIRIES.map((option, index) => (
									<label
										key={option.label()}
										className={cn(
											"flex h-9 cursor-pointer items-center justify-center rounded-lg border border-line-2 text-sm font-medium transition-colors duration-quick hover:bg-hover has-focus-visible:outline-2 has-focus-visible:outline-accent",
											expiry === index && "border-accent bg-accent-soft text-accent-text",
										)}
									>
										<input
											type="radio"
											name={`${id}-expiry`}
											className="sr-only"
											checked={expiry === index}
											onChange={() => setExpiry(index)}
										/>
										{option.label()}
									</label>
								))}
							</div>
						</fieldset>
						{failure && (
							<p role="alert" className="text-sm text-danger-text">
								{failure}
							</p>
						)}
						<DialogFooter>
							<Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
								<Trans>Cancel</Trans>
							</Button>
							<Button type="submit" disabled={!name.trim() || creating} loading={creating}>
								<Trans>Create key</Trans>
							</Button>
						</DialogFooter>
					</form>
				)}
			</DialogContent>
		</Dialog>
	);
}
