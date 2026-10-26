import type { ResumeDocument } from "@/draft/types";
import { useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { openBrowserAsync } from "expo-web-browser";
import { useState } from "react";
import { Linking, View } from "react-native";
import { client, orpc } from "@/api/client";
import { useResumeStore } from "@/draft";
import { resume as draftResume } from "@/draft/runtime";
import { useDocumentOperations } from "@/features/documents/queries";
import { Banner, Button, ConfirmDialog, ListRow, Switch, Text, TextField, showToast, useTheme } from "@/ui";

type WebPageSettingsProps = { resume: ResumeDocument; offline: boolean; username: string | undefined };

type Settings = Partial<
	Pick<ResumeDocument, "showInSearchEngines" | "hideContactDetails" | "showContactButton" | "isPrimary">
>;

// A DNS label: what a username must look like to be a domain of its own.
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Share's web page settings: preview, the short link and custom domain, the footer credit and privacy. Switches
 * that decide who sees what save straight to the server, never through the draft's undo.
 */
export function WebPageSettings({ resume, offline, username }: WebPageSettingsProps) {
	const { t } = useLingui();
	const { space, colors } = useTheme();
	const operations = useDocumentOperations();
	const updateData = useResumeStore((state) => state.update);
	const flags = useQuery({ ...orpc.flags.get.queryOptions(), enabled: !offline });
	const list = useQuery({ ...orpc.resume.list.queryOptions(), enabled: !offline });
	const [confirmPrimary, setConfirmPrimary] = useState(false);
	const disabled = resume.isLocked || offline || operations.busy;
	const otherPrimary = list.data?.find((item) => item.isPrimary && item.id !== resume.id);
	const searchBlocked = !resume.isPublic || resume.hasPassword;

	const save = (settings: Settings) =>
		operations.run(async () => {
			await client.resume.update({ id: resume.id, ...settings });
			await draftResume.refresh();
		});

	const preview = () =>
		operations.run(async () => {
			const url = await client.resume.previewUrl({ id: resume.id });
			await openBrowserAsync(url);
		});

	const shortLink = flags.data?.shortLinkUrl && username ? `${flags.data.shortLinkUrl}/${username}` : undefined;
	const addresses = Boolean(flags.data?.shortLinkUrl || flags.data?.customDomains);

	return (
		<View style={{ gap: space.s4 }}>
			<Button
				variant="secondary"
				icon="eye"
				label={t`Preview web page`}
				disabled={offline}
				onPress={() => void preview()}
			/>

			{addresses && (
				<View style={{ gap: space.s3, paddingTop: space.s4, borderTopWidth: 1, borderColor: colors.line }}>
					<Text variant="heading">{t`Short link and domain`}</Text>
					<ListRow
						title={t`Primary resume`}
						subtitle={
							resume.isPrimary
								? resume.isPublic
									? t`Your short link and custom domain open this resume.`
									: t`Your short link and custom domain say this resume isn't shared until you publish it again.`
								: otherPrimary
									? t`Your short link and custom domain open “${otherPrimary.name}”.`
									: t`Publish this resume to open it at your short link and custom domain.`
						}
						trailing={
							<Switch
								label={t`Primary resume`}
								value={resume.isPrimary}
								disabled={disabled || (!resume.isPublic && !resume.isPrimary)}
								onValueChange={(value) =>
									value && otherPrimary ? setConfirmPrimary(true) : void save({ isPrimary: value })
								}
							/>
						}
					/>
					{shortLink && (
						<ListRow
							title={shortLink.replace(/^https?:\/\//, "")}
							leading="link"
							disabled={offline}
							onPress={() =>
								void operations.run(async () => {
									await Clipboard.setStringAsync(shortLink);
									showToast({ message: t`Link copied` });
								})
							}
						/>
					)}
					{flags.data?.customDomains && (
						<CustomDomain
							offline={offline}
							suggestion={
								flags.data.olacvSuggestion && username && DNS_LABEL.test(username) ? `${username}.cv` : undefined
							}
						/>
					)}
				</View>
			)}

			<View style={{ gap: space.s3, paddingTop: space.s4, borderTopWidth: 1, borderColor: colors.line }}>
				<Text variant="heading">{t`Web page`}</Text>
				<Text variant="caption" color="ink3">
					{t`Uses your resume's template and Design, and fits any screen. Change them in Design.`}
				</Text>
				<ListRow
					title={t`Show “Made with Reactive Resume”`}
					trailing={
						<Switch
							label={t`Show “Made with Reactive Resume”`}
							value={resume.data.metadata.web?.showCredit !== false}
							disabled={resume.isLocked}
							onValueChange={(value) =>
								updateData((draft) => {
									draft.metadata.web = { ...draft.metadata.web, showCredit: value };
								})
							}
						/>
					}
				/>
			</View>

			<View style={{ gap: space.s3, paddingTop: space.s4, borderTopWidth: 1, borderColor: colors.line }}>
				<Text variant="heading">{t`Privacy`}</Text>
				<ListRow
					title={t`Hide contact details`}
					subtitle={t`Your email, phone, location and other header details, and references' phone numbers, are left out of the web page, its PDF and search results.`}
					trailing={
						<Switch
							label={t`Hide contact details`}
							value={resume.hideContactDetails}
							disabled={disabled}
							onValueChange={(value) => void save({ hideContactDetails: value })}
						/>
					}
				/>
				{resume.hideContactDetails && (
					<ListRow
						title={t`Let visitors ask to see them`}
						subtitle={t`A “Show contact details” button reveals them to people, not to search engines.`}
						trailing={
							<Switch
								label={t`Let visitors ask to see them`}
								value={resume.showContactButton}
								disabled={disabled}
								onValueChange={(value) => void save({ showContactButton: value })}
							/>
						}
					/>
				)}
				<ListRow
					title={t`Show in search engines`}
					subtitle={
						searchBlocked
							? resume.hasPassword
								? t`Not available while the resume needs a password.`
								: t`Publish the web page first.`
							: resume.showInSearchEngines
								? t`Search engines such as Google may list your web page. It can take weeks to appear, or to disappear after you turn this off.`
								: t`Off. Let recruiters find you on Google by turning this on.`
					}
					trailing={
						<Switch
							label={t`Show in search engines`}
							value={resume.showInSearchEngines && !searchBlocked}
							disabled={disabled || searchBlocked}
							onValueChange={(value) => void save({ showInSearchEngines: value })}
						/>
					}
				/>
			</View>

			<ConfirmDialog
				open={confirmPrimary}
				title={t`Make this your primary resume?`}
				message={otherPrimary ? t`“${otherPrimary.name}” stops being your primary resume.` : ""}
				confirmLabel={t`Make primary`}
				onCancel={() => setConfirmPrimary(false)}
				onConfirm={() => {
					setConfirmPrimary(false);
					void save({ isPrimary: true });
				}}
			/>
		</View>
	);
}

/** Connects the account's own domain: the DNS records to add, a check, and the result. */
function CustomDomain({ offline, suggestion }: { offline: boolean; suggestion: string | undefined }) {
	const { t } = useLingui();
	const { space } = useTheme();
	const queryClient = useQueryClient();
	const domain = useQuery({ ...orpc.customDomain.get.queryOptions(), enabled: !offline });
	const [hostname, setHostname] = useState("");
	const [error, setError] = useState<string>();
	const store = (next: unknown) =>
		queryClient.setQueryData(orpc.customDomain.get.queryKey(), next as typeof domain.data);
	const onError = (failure: Error) => setError(failure.message);
	const set = useMutation({ ...orpc.customDomain.set.mutationOptions(), onSuccess: store, onError });
	const verify = useMutation({
		...orpc.customDomain.verify.mutationOptions(),
		onSuccess: (next) => {
			store(next);
			showToast({
				message: next.verified ? t`Domain connected` : t`The records aren't visible yet. Check again later.`,
			});
		},
		onError,
	});
	const remove = useMutation({ ...orpc.customDomain.remove.mutationOptions(), onSuccess: () => store(null), onError });

	if (domain.isPending) return null;
	const current = domain.data;

	return (
		<View style={{ gap: space.s3 }}>
			{error && <Banner tone="danger" message={error} />}
			{!current ? (
				<>
					<TextField
						label={t`Your domain`}
						value={hostname}
						onChangeText={setHostname}
						placeholder="resume.example.com"
						autoCapitalize="none"
						autoCorrect={false}
						keyboardType="url"
					/>
					<Button
						variant="secondary"
						label={t`Connect`}
						loading={set.isPending}
						disabled={offline || !hostname.trim()}
						onPress={() => set.mutate({ hostname })}
					/>
					{suggestion && (
						<Button
							variant="link"
							label={t`${suggestion} may be available. Get yours here →`}
							onPress={() => void Linking.openURL(`https://ola.cv/?domain=${encodeURIComponent(suggestion)}`)}
						/>
					)}
				</>
			) : (
				<>
					<ListRow
						title={current.hostname}
						subtitle={current.verified ? t`Connected. Your domain opens your primary resume.` : undefined}
						leading={current.verified ? "check-circle" : "warning-circle"}
					/>
					{!current.verified && (
						<>
							<Text color="ink2">
								{t`Add these records where you manage the domain, then check. Changes can take a few hours to reach everyone.`}
							</Text>
							<Text selectable variant="mono">{`CNAME ${current.hostname} → ${current.target}`}</Text>
							<Text selectable variant="mono">{`TXT ${current.txtName} = ${current.txtValue}`}</Text>
							<Text variant="caption" color="ink3">
								{t`For a root domain such as example.com, use A and AAAA records with ${current.target}'s addresses instead of the CNAME.`}
							</Text>
							<Button
								variant="secondary"
								label={t`Check DNS`}
								loading={verify.isPending}
								disabled={offline}
								onPress={() => verify.mutate({})}
							/>
						</>
					)}
					<Button
						variant="ghost"
						label={t`Remove`}
						loading={remove.isPending}
						disabled={offline}
						onPress={() => remove.mutate({})}
					/>
				</>
			)}
		</View>
	);
}
