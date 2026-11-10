import { t } from "@lingui/core/macro";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { CollectionState } from "./shared";
import { useDataBackend } from "@/data";
import { useApplications, useDocumentActions } from "@/data";
import { IconTile, ListRow, SheetScreen, SheetScrollView } from "@/ui";

export function NewDocumentScreen() {
	const { scope } = useDataBackend();
	return <ScopedNewDocumentScreen key={scope} />;
}

function ScopedNewDocumentScreen() {
	const router = useRouter();
	const params = useLocalSearchParams<{ kind?: string; resumeId?: string }>();
	const applications = useApplications();
	const actions = useDocumentActions();
	const [busy, setBusy] = useState(false);
	const create = async (applicationId?: string) => {
		if (busy) return;
		setBusy(true);
		try {
			if (applicationId) {
				const letter = await actions.createLetter({
					name: t`Untitled cover letter`,
					applicationId,
					...(params.resumeId ? { resumeId: params.resumeId } : {}),
				});
				router.replace(`/letter/${letter.id}`);
			} else {
				const id = await actions.createResume({ name: t`Untitled resume`, tags: [] });
				router.replace(`/builder/${id}/design/template`);
			}
		} catch {
			setError(t`Couldn't create the document. Try again.`);
		} finally {
			setBusy(false);
		}
	};
	const [error, setError] = useState<string>();
	const [chooseApplication, setChooseApplication] = useState(params.kind === "letter");
	const openApplications = applications.data?.filter((app) => app.status !== "closed") ?? [];
	return (
		<SheetScreen
			title={chooseApplication ? t`Which application?` : t`New`}
			height={470}
			step={chooseApplication ? "application" : "new"}
		>
			<SheetScrollView>
				{error ? <CollectionState message={error} /> : null}
				{chooseApplication ? (
					<>
						{openApplications.length ? (
							openApplications.map((app) => (
								<ListRow
									wrapTitle
									wrapSecondary
									key={app.id}
									title={app.company}
									secondary={app.role}
									trailing="caret"
									disabled={busy}
									onPress={() => void create(app.id)}
								/>
							))
						) : (
							<ListRow
								wrapTitle
								wrapSecondary
								title={t`Save a job first`}
								leading={<IconTile icon="briefcase" />}
								onPress={() => router.replace("/applications/new")}
							/>
						)}
					</>
				) : (
					<>
						<ListRow
							wrapTitle
							wrapSecondary
							title={t`Resume`}
							secondary={t`Start from a template`}
							leading={<IconTile icon="file-text" accent />}
							trailing="caret"
							disabled={busy}
							onPress={() => void create()}
						/>
						<ListRow
							wrapTitle
							wrapSecondary
							title={t`Import a resume`}
							secondary={t`PDF, Word, JSON or LinkedIn`}
							leading={<IconTile icon="download-simple" />}
							trailing="caret"
							onPress={() => router.replace("/import")}
						/>
						<ListRow
							wrapTitle
							wrapSecondary
							title={t`Cover letter`}
							secondary={t`For a saved application`}
							leading={<IconTile icon="envelope-simple" />}
							trailing="caret"
							onPress={() => setChooseApplication(true)}
						/>
						<ListRow
							wrapTitle
							wrapSecondary
							title={t`Save a job`}
							secondary={t`Paste a link or posting`}
							leading={<IconTile icon="briefcase" />}
							trailing="caret"
							onPress={() => router.replace("/applications/new")}
							last
						/>
					</>
				)}
			</SheetScrollView>
		</SheetScreen>
	);
}
