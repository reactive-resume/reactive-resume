import { t } from "@lingui/core/macro";
import { openBrowserAsync } from "expo-web-browser";
import { useState } from "react";
import { View } from "react-native";
import { isValidSlug, publicResumeUrl } from "@reactive-resume/resume/sharing";
import { DocumentState, useDocumentId, useBuilderDocument } from "./document";
import { useSession } from "@/auth/session";
import { useAccount, useResumeStore } from "@/data";
import { STORYBOARD } from "@/dev/storyboard/harness";
import { PushScreen, IconButton, TextField, Form, ListRow, Switch, SectionHeading, useSwitchRow, Text } from "@/ui";

export function WebPageScreen() {
	const id = useDocumentId();
	const query = useBuilderDocument(id);
	const document = query.data;
	const { server } = useSession();
	const account = useAccount();
	const draft = useResumeStore();
	const [slug, setSlug] = useState<string>();
	const [error, setError] = useState("");
	const username = STORYBOARD ? "alex" : (account.data?.username ?? "");
	const primary = useSwitchRow(document?.isPrimary ?? false, () => setError(t`Couldn't update sharing. Try again.`));
	const hidden = useSwitchRow(document?.hideContactDetails ?? false, () =>
		setError(t`Couldn't update sharing. Try again.`),
	);
	const search = useSwitchRow(document?.showInSearchEngines ?? false, () =>
		setError(t`Couldn't update sharing. Try again.`),
	);
	const saveSlug = () => {
		if (slug === undefined || !isValidSlug(slug)) return;
		if (draft.document?.id !== id) {
			setError(t`Couldn't update sharing. Try again.`);
			return;
		}
		draft.updateDocument((d) => {
			d.slug = slug;
		});
		void draft.flush();
	};
	return (
		<PushScreen
			title={t`Web page`}
			barEnd={
				<IconButton
					icon="arrow-square-out"
					label={t`Open the web page`}
					onPress={() => void openBrowserAsync(publicResumeUrl(server, { username, slug: document?.slug ?? "" }))}
				/>
			}
		>
			<DocumentState loading={query.isPending} error={query.isError} retry={() => void query.refetch()} />
			{document && (
				<>
					<Form>
						<TextField
							label={t`Address`}
							value={slug ?? document.slug}
							prefix={`${server.replace(/^https?:\/\//, "")}/${username}/`}
							mono
							onChangeText={setSlug}
							onBlur={saveSlug}
							autoCapitalize="none"
							autoCorrect={false}
							error={
								slug !== undefined && !isValidSlug(slug)
									? t`Use Latin letters a–z, numbers and single dashes.`
									: undefined
							}
						/>
					</Form>
					<View style={{ marginTop: 12 }}>
						<ListRow
							title={t`Primary resume`}
							secondary={t`Your short link rx.cv/${username} opens this one.`}
							wrapSecondary
							{...primary}
							trailing={<Switch value={document.isPrimary} interactive={false} />}
							last
						/>
					</View>
					<SectionHeading title={t`Privacy`} />
					<ListRow
						title={t`Hide contact details`}
						{...hidden}
						trailing={<Switch value={document.hideContactDetails} interactive={false} />}
					/>
					<ListRow
						title={t`Show in search engines`}
						{...search}
						trailing={<Switch value={document.showInSearchEngines} interactive={false} />}
					/>
					<ListRow
						title={t`Visitors can download it`}
						secondary={document.showDownloadButtons ? t`PDF` : t`Off`}
						trailing="caret"
					/>
					<ListRow title={t`Password`} secondary={document.hasPassword ? t`On` : t`Off`} trailing="caret" last />
					{error ? (
						<Text accessibilityRole="alert" color="dangerText" style={{ margin: 24 }}>
							{error}
						</Text>
					) : null}
				</>
			)}
		</PushScreen>
	);
}
