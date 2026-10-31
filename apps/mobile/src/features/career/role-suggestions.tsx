import type { RouterOutput } from "@/api/client";
import { useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { View } from "react-native";
import { useCareerAction } from "./hooks";
import { SwitchRow } from "./shared";
import { client, orpc } from "@/api/client";
import { getAccountScope, useSession } from "@/auth/session";
import { useHasAIProvider } from "@/features/ai/providers";
import { workspaceError } from "@/features/workspace/hooks";
import { Banner, Button, SelectSheet, Text, TextArea, useTheme } from "@/ui";

type RoleSuggestionsProps = { onUse: (roles: string[]) => void; locale: string };
export function RoleSuggestions({ onUse, locale }: RoleSuggestionsProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const session = useSession();
	const ai = useHasAIProvider();
	const action = useCareerAction();
	const [open, setOpen] = useState(false);
	const [providerId, setProviderId] = useState("");
	const [resumeId, setResumeId] = useState("");
	const [includeKnowledge, setIncludeKnowledge] = useState(false);
	const [suggestions, setSuggestions] = useState<RouterOutput["career"]["suggestTargetRoles"] | null>(null);
	const [draft, setDraft] = useState("");
	const [error, setError] = useState<string>();
	const options = orpc.documents.list.queryOptions({ input: { trashed: false } });
	const documents = useQuery({
		...options,
		queryKey: [...options.queryKey, session.server],
		enabled: open && session.status === "signed-in",
	});
	const clear = () => {
		setSuggestions(null);
		setDraft("");
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
		<View style={{ gap: space.s3 }}>
			<Button variant="ghost" label={t`Suggest target roles (optional AI)`} onPress={() => setOpen(!open)} />
			<Text color="ink3">{t`Manual roles and preferences work without AI. Suggestions never search or schedule anything.`}</Text>
			{open ? (
				<>
					{ai.isUnavailable || error ? (
						<Button
							variant="secondary"
							label={t`Retry AI connections`}
							onPress={() => {
								setProviderId("");
								setError(undefined);
								clear();
								ai.retry();
							}}
						/>
					) : !ai.hasAIProvider ? (
						<Text>{t`Connect and test an AI provider in Settings, or keep entering roles manually.`}</Text>
					) : (
						<>
							<SelectSheet
								label={t`AI connection receiving your context`}
								value={providerId}
								disabled={action.pending}
								onChange={(value) => {
									setProviderId(value);
									clear();
								}}
								options={[
									{ value: "", label: t`Choose a connection` },
									...ai.usableProviders.map((row) => ({
										value: row.id,
										label: `${row.label} · ${row.provider} · ${row.model}${row.baseURL ? ` · ${new URL(row.baseURL).origin}` : ""}`,
									})),
								]}
							/>
							<SelectSheet
								label={t`Resume to share for suggestions`}
								value={resumeId}
								disabled={action.pending || !documents.isSuccess}
								onChange={(value) => {
									setResumeId(value);
									clear();
								}}
								options={[
									{ value: "", label: t`Do not share a resume` },
									...(documents.data ?? [])
										.filter((row) => row.type === "resume")
										.map((row) => ({ value: row.id, label: row.name })),
								]}
							/>
							{documents.isError ? (
								<Button variant="secondary" label={t`Retry documents`} onPress={() => void documents.refetch()} />
							) : null}
							<SwitchRow
								label={t`Share enabled shared Knowledge`}
								value={includeKnowledge}
								disabled={action.pending}
								onValueChange={(value) => {
									setIncludeKnowledge(value);
									clear();
								}}
							/>
							<Text color="ink3">{t`Sends only your selected resume and up to 20 active shared facts to this connection. No application profile, saved answers or private application facts. Your provider may charge.`}</Text>
							<Button
								variant="secondary"
								label={t`Generate role suggestions`}
								disabled={!provider?.recipientVersion || (!resumeId && !includeKnowledge) || action.pending}
								onPress={() => {
									if (!provider?.recipientVersion) return;
									clear();
									setError(undefined);
									const scope = getAccountScope();
									void action.run(async () => {
										try {
											const result = await client.career.suggestTargetRoles({
												providerId,
												recipientVersion: provider.recipientVersion,
												resumeId: resumeId || null,
												includeKnowledge,
												locale,
											});
											if (getAccountScope() !== scope) return;
											setSuggestions(result);
											setDraft(result.suggestions.map((item) => item.role).join("\n"));
										} catch (cause) {
											if (getAccountScope() !== scope) return;
											setError(workspaceError(cause, t`Couldn't suggest roles. Try again or enter roles manually.`));
										}
									});
								}}
							/>
						</>
					)}
					{error ? <Banner tone="danger" message={error} /> : null}
					{suggestions ? (
						<>
							<Text color="ink3">{t`AI suggestions, not verified qualifications or hiring predictions. Sources below are your statements.`}</Text>
							{suggestions.suggestions.map((item) => (
								<View key={item.role} style={{ gap: space.s2 }}>
									<Text variant="title">{item.role}</Text>
									{item.facts.map((fact) => (
										<Text key={fact.id}>
											{t`Knowledge:`} {fact.text}
										</Text>
									))}
									{item.resumeQuote ? (
										<Text>
											{t`Selected resume:`} {item.resumeQuote}
										</Text>
									) : null}
								</View>
							))}
							{suggestions.suggestions.length === 0 ? (
								<Text>{t`No supported suggestions returned. Enter roles manually or choose different context.`}</Text>
							) : null}
							<TextArea
								label={t`Review target roles, one per line`}
								value={draft}
								maxLength={4000}
								onChangeText={setDraft}
							/>
							<Button
								label={t`Use reviewed roles in preferences`}
								disabled={!valid}
								onPress={() => {
									onUse(roles);
									clear();
								}}
							/>
							<Text color="ink3">{t`Replaces target roles only after you choose Use. Wait for Saved before opening a new search schedule; existing schedules keep their saved query.`}</Text>
						</>
					) : null}
				</>
			) : null}
		</View>
	);
}
