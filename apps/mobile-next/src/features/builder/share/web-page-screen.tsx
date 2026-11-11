import { t } from "@lingui/core/macro";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { isValidSlug } from "@reactive-resume/resume/sharing";
import { DocumentState, useDocumentId, useBuilderDocument } from "./document";
import { useSession } from "@/auth/session";
import { useAccount, useDocuments, useResumeStore, useSharing } from "@/data";
import { STORYBOARD } from "@/dev/storyboard/harness";
import {
	PushScreen,
	IconButton,
	TextField,
	Form,
	ListRow,
	Switch,
	SectionHeading,
	useSwitchRow,
	Text,
	Dialog,
	haptic,
} from "@/ui";

export function WebPageScreen() {
	const id = useDocumentId();
	const router = useRouter();
	const query = useBuilderDocument(id);
	const document = query.data;
	const { server } = useSession();
	const account = useAccount();
	const draft = useResumeStore();
	const sharing = useSharing(id);
	const documents = useDocuments();
	// Storyboard flows reach "Couldn't update sharing. Try again." with `preset=write-fail`.
	const { preset } = useLocalSearchParams<{ preset?: string }>();
	const failing = STORYBOARD && preset === "write-fail";
	const [slug, setSlug] = useState<string>();
	const [error, setError] = useState("");
	const [askPrimary, setAskPrimary] = useState(false);
	const username = STORYBOARD ? "alex" : (account.data?.username ?? "");
	const others = (documents.data ?? []).filter((row) => row.type === "resume" && row.id !== id);
	const currentPrimary = others.find((row) => "isPrimary" in row && row.isPrimary);
	const taken = (value: string) => others.some((row) => "slug" in row && row.slug === value);
	const makePrimary = (next: boolean) => {
		setAskPrimary(false);
		if (failing) {
			setError(t`Couldn't update sharing. Try again.`);
			return;
		}
		setError("");
		void draft
			.flush()
			.then(() => sharing.update({ isPrimary: next }))
			.catch(() => setError(t`Couldn't update sharing. Try again.`));
	};
	const primary = useSwitchRow(document?.isPrimary ?? false, (next) =>
		next && currentPrimary ? setAskPrimary(true) : makePrimary(next),
	);
	// A privacy switch saves through the open draft; without one it says so and stays as saved.
	const setting = (field: "hideContactDetails" | "showInSearchEngines") => (next: boolean) => {
		if (failing) {
			setError(t`Couldn't update sharing. Try again.`);
			return;
		}
		setError("");
		// Through the open draft when it is this resume's, else straight to the server.
		if (draft.document?.id === id)
			draft.updateDocument((d) => {
				d[field] = next;
			});
		else void sharing.update({ [field]: next }).catch(() => setError(t`Couldn't update sharing. Try again.`));
	};
	const hidden = useSwitchRow(document?.hideContactDetails ?? false, setting("hideContactDetails"));
	const search = useSwitchRow(document?.showInSearchEngines ?? false, setting("showInSearchEngines"));
	const saveSlug = () => {
		if (slug === undefined || !isValidSlug(slug) || taken(slug)) return;
		if (draft.document?.id !== id) {
			void sharing.update({ slug }).catch(() => setError(t`Couldn't update sharing. Try again.`));
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
			backLabel={t`Back to Share`}
			overlay={
				<Dialog
					open={askPrimary}
					onClose={() => setAskPrimary(false)}
					title={t`Make this your primary resume?`}
					message={t`“${currentPrimary?.name ?? ""}” stops being your primary resume.`}
					actions={[
						{
							label: t`Make primary`,
							tone: "primary",
							onPress: () => {
								haptic("toggleOn");
								makePrimary(true);
							},
						},
						{ label: t`Cancel`, tone: "secondary", onPress: () => setAskPrimary(false) },
					]}
				/>
			}
			barEnd={
				<IconButton
					icon="arrow-square-out"
					label={t`Open the web page`}
					onPress={() => router.push(`/r/${encodeURIComponent(username)}/${encodeURIComponent(document?.slug ?? "")}`)}
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
									: slug !== undefined && taken(slug)
										? t`Another of your resumes uses this address.`
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
							boxHidden
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
					<ListRow
						title={t`Password`}
						secondary={document.hasPassword ? t`On` : t`Off`}
						trailing="caret"
						last
						boxHidden
						onPress={() => router.push(`/builder/${id}/share/password`)}
					/>
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
