import { t } from "@lingui/core/macro";
import { useRouter } from "expo-router";
import { useState } from "react";
import { CollectionState } from "./shared";
import { useApplications } from "@/data";
import { IconTile, ListRow, SheetScreen, SheetScrollView } from "@/ui";

export function NewDocumentScreen() {
	const router = useRouter();
	const applications = useApplications();
	const [error, setError] = useState<string>();
	const [chooseApplication, setChooseApplication] = useState(false);
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
									onPress={() => setError(t`Cover letter creation is not available yet.`)}
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
							onPress={() => setError(t`Resume creation is not available yet.`)}
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
