import type { RouterOutput } from "@/libs/orpc/client";
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { Checkbox } from "@reactive-resume/ui/components/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@reactive-resume/ui/components/dialog";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Label } from "@reactive-resume/ui/components/label";
import { NativeSelect } from "@reactive-resume/ui/components/native-select";
import { Textarea } from "@reactive-resume/ui/components/textarea";
import { useHasUsableAiProvider } from "@/features/settings/integrations/hooks/use-has-usable-ai-provider";
import { getOrpcErrorMessage } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";

type RoleSuggestionsProps = { onUse: (roles: string[]) => void };

/**
 * C10: optional AI beside Target roles. The link is left out when no AI connection can be used; roles are typed by
 * hand either way. Nothing is searched or scheduled, and the roles change only on "Use these roles".
 */
export function RoleSuggestions({ onUse }: RoleSuggestionsProps) {
	const ai = useHasUsableAiProvider();
	const [open, setOpen] = useState(false);
	if (!ai.hasUsableProvider && !ai.isUnavailable) return null;
	return (
		<>
			<button
				type="button"
				onClick={() => setOpen(true)}
				className="flex items-center gap-1 rounded-xs text-[13px]/[18px] font-medium text-accent-text hover:underline"
			>
				<Icon name="sparkle" size={16} />
				<Trans>Suggest roles</Trans>
			</button>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent closeLabel={t`Close`}>
					{open && (
						<SuggestRoles
							onClose={() => setOpen(false)}
							onUse={(roles) => {
								onUse(roles);
								setOpen(false);
							}}
						/>
					)}
				</DialogContent>
			</Dialog>
		</>
	);
}

type SuggestRolesProps = { onUse: (roles: string[]) => void; onClose: () => void };

function SuggestRoles({ onUse, onClose }: SuggestRolesProps) {
	const id = useId();
	const ai = useHasUsableAiProvider();
	const [chosenProvider, setProviderId] = useState("");
	const [resumeId, setResumeId] = useState("");
	const [includeKnowledge, setIncludeKnowledge] = useState(false);
	const [suggestions, setSuggestions] = useState<RouterOutput["career"]["suggestTargetRoles"] | null>(null);
	const [draft, setDraft] = useState("");
	const documents = useQuery(orpc.documents.list.queryOptions({ input: { trashed: false } }));
	const facts = useQuery(orpc.career.facts.queryOptions({ input: { applicationId: null, all: true } }));
	const stories = useQuery(orpc.career.stories.queryOptions({ input: { applicationId: null } }));
	const generate = useMutation(orpc.career.suggestTargetRoles.mutationOptions());
	const clear = () => {
		setSuggestions(null);
		setDraft("");
		generate.reset();
	};
	const roles = [
		...new Set(
			draft
				.split("\n")
				.map((role) => role.trim())
				.filter(Boolean),
		),
	];
	const valid = roles.length > 0 && roles.length <= 20 && roles.every((role) => role.length <= 200);
	// The default connection (listed first) unless another is chosen; it is named before anything is sent.
	const providerId = chosenProvider || ai.usableProviders[0]?.id || "";
	const provider = ai.usableProviders.find((row) => row.id === providerId);
	const factCount = facts.data?.filter((fact) => fact.status === "active" && fact.applicationId === null).length;
	const storyCount = stories.data?.length;

	const suggest = () => {
		if (!provider?.recipientVersion) return;
		clear();
		generate.mutate(
			{
				providerId,
				recipientVersion: provider.recipientVersion,
				resumeId: resumeId || null,
				includeKnowledge,
				locale: document.documentElement.lang || "en-US",
			},
			{
				onSuccess: (result) => {
					setSuggestions(result);
					setDraft(result.suggestions.map((item) => item.role).join("\n"));
				},
			},
		);
	};
	const canSuggest = Boolean(provider?.recipientVersion) && (Boolean(resumeId) || includeKnowledge);

	return (
		<>
			<DialogHeader>
				<DialogTitle>
					<Trans>Suggest target roles</Trans>
				</DialogTitle>
				<DialogDescription>
					<Trans>You choose what it reads, then edit the list. Nothing is searched or scheduled.</Trans>
				</DialogDescription>
			</DialogHeader>

			{ai.isUnavailable ? (
				<Button
					variant="secondary"
					className="justify-self-start"
					onClick={() => {
						setProviderId("");
						clear();
						ai.retry();
					}}
				>
					<Trans>Retry AI connections</Trans>
				</Button>
			) : (
				<>
					<div className="grid gap-1.5">
						<Label htmlFor={`${id}-provider`}>
							<Trans>Connection</Trans>
						</Label>
						<NativeSelect
							id={`${id}-provider`}
							value={providerId}
							disabled={generate.isPending}
							onChange={(event) => {
								setProviderId(event.target.value);
								clear();
							}}
						>
							{ai.usableProviders.map((row) => (
								<option key={row.id} value={row.id}>
									{row.label} · {row.model}
									{row.baseURL ? ` · ${new URL(row.baseURL).origin}` : ""}
								</option>
							))}
						</NativeSelect>
					</div>

					<fieldset className="grid gap-2.5" disabled={generate.isPending}>
						<legend className="mb-2 text-[13px]/[18px] font-medium text-ink-2">
							<Trans>What it may read</Trans>
						</legend>
						<NativeSelect
							aria-label={t`Resume to share for suggestions`}
							value={resumeId}
							disabled={!documents.isSuccess}
							onChange={(event) => {
								setResumeId(event.target.value);
								clear();
							}}
						>
							<option value="">{t`No resume`}</option>
							{documents.data
								?.filter((row) => row.type === "resume")
								.map((row) => (
									<option key={row.id} value={row.id}>
										{t`The resume “${row.name}”`}
									</option>
								))}
						</NativeSelect>
						{documents.isError && (
							<Button variant="secondary" className="justify-self-start" onClick={() => void documents.refetch()}>
								<Trans>Retry documents</Trans>
							</Button>
						)}
						<label className="flex cursor-pointer items-start gap-2.5">
							<Checkbox
								checked={includeKnowledge}
								onCheckedChange={(value) => {
									setIncludeKnowledge(value);
									clear();
								}}
								className="mt-px"
							/>
							<span className="grid gap-px">
								<span className="text-ink t-ui">
									<Trans>Knowledge that's switched on</Trans>
								</span>
								{factCount !== undefined && storyCount !== undefined && (
									<span className="text-xs/4 text-ink-3">
										{plural(factCount, { one: "# fact", other: "# facts" })} ·{" "}
										{plural(storyCount, { one: "# story", other: "# stories" })} · <Trans>preferences</Trans>
									</span>
								)}
							</span>
						</label>
					</fieldset>
				</>
			)}

			{generate.error && (
				<p role="alert" className="text-sm text-danger-text">
					{getOrpcErrorMessage(generate.error, {
						fallback: t`Couldn't suggest roles. Try again or enter roles manually.`,
						allowServerMessage: true,
					})}
				</p>
			)}

			{suggestions && (
				<div className="grid gap-1.5">
					<Label htmlFor={`${id}-draft`} className="justify-between">
						<Trans>Suggested roles</Trans>
						<span className="text-xs/4 font-normal text-ink-3">
							<Trans>one per line · edit freely</Trans>
						</span>
					</Label>
					{suggestions.suggestions.length === 0 && (
						<p role="status" className="text-ink-2">
							<Trans>No supported suggestions returned. Enter roles manually or choose different context.</Trans>
						</p>
					)}
					<Textarea
						id={`${id}-draft`}
						value={draft}
						maxLength={4000}
						onChange={(event) => setDraft(event.target.value)}
					/>
					{suggestions.suggestions.map((item) => (
						<p key={item.role} className="text-xs/4 text-ink-3">
							<b className="font-medium text-ink-2">{item.role}</b>
							{item.facts.map((fact) => (
								<span key={fact.id}>
									{" · "}
									{t`Knowledge:`} {fact.text}
								</span>
							))}
							{item.resumeQuote && (
								<span>
									{" · "}
									{t`Selected resume:`} {item.resumeQuote}
								</span>
							)}
						</p>
					))}
					<p className="text-xs/4 text-ink-3">
						<Trans>
							Replaces target roles only after you choose Use. Wait for Saved before opening a new search schedule;
							existing schedules keep their saved query.
						</Trans>
					</p>
				</div>
			)}

			<DialogFooter className="sm:items-center">
				{suggestions && (
					<Button
						variant="ghost"
						className="sm:-ms-3.5 sm:me-auto"
						disabled={!canSuggest}
						loading={generate.isPending}
						onClick={suggest}
					>
						<Icon name="arrow-clockwise" />
						<Trans>Suggest again</Trans>
					</Button>
				)}
				<Button variant="ghost" onClick={onClose}>
					<Trans>Cancel</Trans>
				</Button>
				{suggestions ? (
					<Button disabled={!valid} onClick={() => onUse(roles)}>
						<Trans>Use these roles</Trans>
					</Button>
				) : (
					<Button disabled={!canSuggest} loading={generate.isPending} onClick={suggest}>
						<Icon name="sparkle" />
						<Trans>Suggest roles</Trans>
					</Button>
				)}
			</DialogFooter>
		</>
	);
}
