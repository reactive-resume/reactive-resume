import type { RouterOutput } from "@/libs/orpc/client";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { NativeSelect } from "@reactive-resume/ui/components/native-select";
import { SwitchRow } from "@reactive-resume/ui/components/switch";
import { Textarea } from "@reactive-resume/ui/components/textarea";
import { useHasUsableAiProvider } from "@/features/settings/integrations/hooks/use-has-usable-ai-provider";
import { getOrpcErrorMessage } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";

type RoleSuggestionsProps = { onUse: (roles: string[]) => void };
export function RoleSuggestions({ onUse }: RoleSuggestionsProps) {
	const id = useId();
	const ai = useHasUsableAiProvider();
	const [open, setOpen] = useState(false);
	const [providerId, setProviderId] = useState("");
	const [resumeId, setResumeId] = useState("");
	const [includeKnowledge, setIncludeKnowledge] = useState(false);
	const [suggestions, setSuggestions] = useState<RouterOutput["career"]["suggestTargetRoles"] | null>(null);
	const [draft, setDraft] = useState("");
	const documents = useQuery({ ...orpc.documents.list.queryOptions({ input: { trashed: false } }), enabled: open });
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
	const provider = ai.usableProviders.find((row) => row.id === providerId);
	return (
		<section className="grid gap-3 rounded-lg border border-line p-3">
			<Button variant="ghost" onClick={() => setOpen(!open)} aria-expanded={open}>
				<Trans>Suggest target roles (optional AI)</Trans>
			</Button>
			<p className="text-xs text-ink-3">
				<Trans>Manual roles and preferences work without AI. Suggestions never search or schedule anything.</Trans>
			</p>
			{open && (
				<>
					{ai.isUnavailable || generate.isError ? (
						<Button
							variant="secondary"
							onClick={() => {
								setProviderId("");
								clear();
								ai.retry();
							}}
						>
							<Trans>Retry AI connections</Trans>
						</Button>
					) : !ai.hasUsableProvider ? (
						<p className="text-sm">
							<Trans>Connect and test an AI provider in Settings, or keep entering roles manually.</Trans>
						</p>
					) : (
						<>
							<label htmlFor={`${id}-provider`}>
								<Trans>AI connection receiving your context</Trans>
							</label>
							<NativeSelect
								id={`${id}-provider`}
								value={providerId}
								disabled={generate.isPending}
								onChange={(event) => {
									setProviderId(event.target.value);
									clear();
								}}
							>
								<option value="">{t`Choose a connection`}</option>
								{ai.usableProviders.map((row) => (
									<option key={row.id} value={row.id}>
										{row.label} · {row.provider} · {row.model}
										{row.baseURL ? ` · ${new URL(row.baseURL).origin}` : ""}
									</option>
								))}
							</NativeSelect>
							<label htmlFor={`${id}-resume`}>
								<Trans>Resume to share for suggestions</Trans>
							</label>
							<NativeSelect
								id={`${id}-resume`}
								value={resumeId}
								disabled={generate.isPending || !documents.isSuccess}
								onChange={(event) => {
									setResumeId(event.target.value);
									clear();
								}}
							>
								<option value="">{t`Do not share a resume`}</option>
								{documents.data
									?.filter((row) => row.type === "resume")
									.map((row) => (
										<option key={row.id} value={row.id}>
											{row.name}
										</option>
									))}
							</NativeSelect>
							{documents.isError && (
								<Button variant="secondary" onClick={() => void documents.refetch()}>
									<Trans>Retry documents</Trans>
								</Button>
							)}
							<SwitchRow
								label={t`Share enabled shared Knowledge`}
								checked={includeKnowledge}
								disabled={generate.isPending}
								onCheckedChange={(value) => {
									setIncludeKnowledge(value);
									clear();
								}}
							/>
							<p className="text-xs text-ink-3">
								<Trans>
									Sends only your selected resume and up to 20 active shared facts to this connection. No application
									profile, saved answers or private application facts. Your provider may charge.
								</Trans>
							</p>
							<Button
								variant="secondary"
								disabled={!provider?.recipientVersion || (!resumeId && !includeKnowledge)}
								loading={generate.isPending}
								onClick={() => {
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
								}}
							>
								<Trans>Generate role suggestions</Trans>
							</Button>
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
						<>
							<p className="text-xs text-ink-3">
								<Trans>
									AI suggestions, not verified qualifications or hiring predictions. Sources below are your statements.
								</Trans>
							</p>
							{suggestions.suggestions.map((item) => (
								<div key={item.role} className="text-xs">
									<strong>{item.role}</strong>
									{item.facts.map((fact) => (
										<p key={fact.id}>
											{t`Knowledge:`} {fact.text}
										</p>
									))}
									{item.resumeQuote && (
										<p>
											{t`Selected resume:`} {item.resumeQuote}
										</p>
									)}
								</div>
							))}
							{suggestions.suggestions.length === 0 && (
								<p role="status">
									<Trans>No supported suggestions returned. Enter roles manually or choose different context.</Trans>
								</p>
							)}
							<label htmlFor={`${id}-draft`}>
								<Trans>Review target roles, one per line</Trans>
							</label>
							<Textarea
								id={`${id}-draft`}
								value={draft}
								maxLength={4000}
								onChange={(event) => setDraft(event.target.value)}
							/>
							<Button
								disabled={!valid}
								onClick={() => {
									onUse(roles);
									clear();
								}}
							>
								<Trans>Use reviewed roles in preferences</Trans>
							</Button>
							<p className="text-xs text-ink-3">
								<Trans>
									Replaces target roles only after you choose Use. Wait for Saved before opening a new search schedule;
									existing schedules keep their saved query.
								</Trans>
							</p>
						</>
					)}
				</>
			)}
		</section>
	);
}
