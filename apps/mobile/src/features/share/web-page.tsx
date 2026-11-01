import type { ShareSettings } from "./link";
import type { RouterOutput } from "@/api/client";
import type { ResumeDocument } from "@/draft/types";
import type { useDocumentOperations } from "@/features/documents/queries";
import { useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { openBrowserAsync } from "expo-web-browser";
import { useState } from "react";
import { View } from "react-native";
import { publicResumeUrl } from "@reactive-resume/resume/sharing";
import { CustomDomain } from "./custom-domain";
import { flushResume } from "./document";
import { client, orpc } from "@/api/client";
import { useResumeStore } from "@/draft";
import { resume as draftResume } from "@/draft/runtime";
import { Banner, Button, ConfirmDialog, ListGroup, ListRow, Sheet, Switch, TextField, showToast, useTheme } from "@/ui";

type WebPageSettingsProps = {
	resume: ResumeDocument;
	offline: boolean;
	username: string | undefined;
	/** Where shared links point: the app's alias (`APP_ALIAS_URL`) when the server has one. */
	origin: string;
	flags: RouterOutput["flags"]["get"] | undefined;
	/** Share's one queue: actions run one at a time and report into its banner. */
	operations: ReturnType<typeof useDocumentOperations>;
	save: (settings: ShareSettings) => Promise<boolean>;
};

/**
 * Share's web page settings: preview, the short link and custom domain, the footer credit and privacy. Switches
 * that decide who sees what save straight to the server, never through the draft's undo.
 */
export function WebPageSettings({ resume, offline, username, origin, flags, operations, save }: WebPageSettingsProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const updateData = useResumeStore((state) => state.update);
	const list = useQuery({ ...orpc.resume.list.queryOptions(), enabled: !offline });
	const [dialog, setDialog] = useState<"primary" | "password" | "remove-password" | null>(null);
	const [password, setPassword] = useState("");
	const [confirmation, setConfirmation] = useState("");
	const disabled = resume.isLocked || offline || operations.busy;
	const otherPrimary = list.data?.find((item) => item.isPrimary && item.id !== resume.id);
	const listState = offline ? "offline" : list.isPending ? "pending" : list.isError ? "error" : "ready";
	const searchBlocked = !resume.isPublic || resume.hasPassword;
	const shortLink = username ? publicResumeUrl(origin, { username, slug: resume.slug, isPrimary: true }) : undefined;
	// The short link opens the primary resume only while it's published; at any other time it would copy a dead link.
	const shortLinkOpens = resume.isPrimary ? resume.isPublic : (otherPrimary?.isPublic ?? false);

	const preview = () =>
		operations.run(async () => {
			const url = await client.resume.previewUrl({ id: resume.id });
			await openBrowserAsync(url);
		});

	const closePassword = () => {
		setDialog(null);
		setPassword("");
		setConfirmation("");
	};
	// The password has endpoints of its own, but saves like the switches: after the draft's pending edits, then a reload.
	const savePassword = async (remove = false) => {
		if (!remove && (password.length < 6 || password.length > 64 || password !== confirmation)) return;
		const success = await operations.run(async () => {
			await flushResume(resume.id);
			if (remove) await client.resume.removePassword({ id: resume.id });
			else await client.resume.setPassword({ id: resume.id, password });
			await draftResume.refresh();
		});
		if (success) closePassword();
	};

	return (
		<View style={{ gap: space.s4 }}>
			<Button
				variant="secondary"
				icon="eye"
				label={t`Preview web page`}
				disabled={offline}
				onPress={() => void preview()}
			/>

			<ListGroup title={t`Short link and domain`}>
				<ListRow
					title={t`Primary resume`}
					subtitle={
						resume.isPrimary
							? resume.isPublic
								? t`Your short link and custom domain open this resume.`
								: t`Your short link and custom domain say this resume isn't shared until you publish it again.`
							: listState === "pending"
								? t`Checking which resume opens your short link…`
								: listState === "error"
									? t`Couldn't check which resume opens your short link. Reopen Share to try again.`
									: otherPrimary
										? otherPrimary.isPublic
											? t`Your short link and custom domain open “${otherPrimary.name}”.`
											: t`Your short link and custom domain point to “${otherPrimary.name}”, which isn't published.`
										: resume.isPublic
											? t`Turn this on to open this resume at your short link and custom domain.`
											: t`Publish this resume to open it at your short link and custom domain.`
					}
					trailing={
						<Switch
							label={t`Primary resume`}
							value={resume.isPrimary}
							disabled={disabled || (!resume.isPublic && !resume.isPrimary)}
							onValueChange={(value) =>
								value && otherPrimary ? setDialog("primary") : void save({ isPrimary: value })
							}
						/>
					}
				/>
				{shortLink && (
					<ListRow
						title={shortLink.replace(/^https?:\/\//, "")}
						leading="link-simple-horizontal"
						disabled={offline || !shortLinkOpens}
						onPress={() =>
							void operations.run(async () => {
								await Clipboard.setStringAsync(shortLink);
								showToast({ message: t`Link copied` });
							})
						}
					/>
				)}
			</ListGroup>
			{flags?.customDomains && <CustomDomain offline={offline} suggest={flags.olacvSuggestion ?? false} />}

			<ListGroup
				title={t`Web page`}
				footer={t`Uses your resume's template and Design, and fits any screen. Change them in Design.`}
			>
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
			</ListGroup>

			<ListGroup title={t`Privacy`}>
				<ListRow
					title={t`Require a password`}
					subtitle={
						resume.hasPassword
							? t`Visitors enter it before they see the resume. Share it only with people you trust.`
							: undefined
					}
					trailing={
						<Switch
							label={t`Require a password`}
							value={resume.hasPassword}
							disabled={disabled}
							onValueChange={(value) => {
								setPassword("");
								setConfirmation("");
								setDialog(value ? "password" : "remove-password");
							}}
						/>
					}
				/>
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
				<ListRow
					title={t`Visitors can download the PDF`}
					trailing={
						<Switch
							label={t`Visitors can download the PDF`}
							value={resume.showDownloadButtons}
							disabled={disabled}
							onValueChange={(value) => void save({ showDownloadButtons: value })}
						/>
					}
				/>
			</ListGroup>

			<ConfirmDialog
				open={dialog === "primary"}
				title={t`Make this your primary resume?`}
				message={otherPrimary ? t`“${otherPrimary.name}” stops being your primary resume.` : ""}
				confirmLabel={t`Make primary`}
				onCancel={() => setDialog(null)}
				onConfirm={() => {
					setDialog(null);
					void save({ isPrimary: true });
				}}
			/>
			<Sheet
				open={dialog === "password"}
				title={t`Require a password`}
				onClose={() => {
					if (!operations.busy) closePassword();
				}}
				detents={[0.5, 0.9]}
			>
				<View style={{ padding: space.s4, gap: space.s3 }}>
					<TextField
						label={t`Password`}
						value={password}
						onChangeText={setPassword}
						secureTextEntry
						autoComplete="off"
						autoCorrect={false}
						autoCapitalize="none"
						maxLength={64}
						helper={t`Use 6–64 characters.`}
						editable={!operations.busy}
					/>
					<TextField
						label={t`Confirm password`}
						value={confirmation}
						onChangeText={setConfirmation}
						secureTextEntry
						autoComplete="off"
						autoCorrect={false}
						autoCapitalize="none"
						maxLength={64}
						editable={!operations.busy}
						error={confirmation && confirmation !== password ? t`Passwords do not match.` : undefined}
					/>
					{operations.error && <Banner tone="danger" message={operations.error} />}
					<Button
						label={t`Set password`}
						loading={operations.busy}
						disabled={password.length < 6 || password !== confirmation || disabled}
						onPress={() => void savePassword()}
					/>
				</View>
			</Sheet>
			<ConfirmDialog
				open={dialog === "remove-password"}
				title={t`Remove the password?`}
				message={t`Anyone with the link will be able to view your resume.`}
				confirmLabel={t`Remove password`}
				onCancel={() => setDialog(null)}
				onConfirm={() => {
					setDialog(null);
					void savePassword(true);
				}}
			/>
		</View>
	);
}
