import { useLingui } from "@lingui/react/macro";
import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useApplications } from "@/features/applications/queries";
import { useDocuments } from "@/features/documents/queries";
import { routes } from "@/routes";
import { Button, Card, ListRow, Sheet, Text, useTheme } from "@/ui";

type NextStepsProps = { onDismiss: () => void };
type Choice = "improve" | "writing" | "fit";

export function NextSteps({ onDismiss }: NextStepsProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const router = useRouter();
	const [picker, setPicker] = useState<{ choice: Choice; open: boolean }>({ choice: "improve", open: false });
	const { choice } = picker;
	const close = () => setPicker((current) => ({ ...current, open: false }));
	const documents = useDocuments(false, picker.open && choice !== "fit");
	const resumes = documents.data?.filter((document) => document.type === "resume");
	const applications = useApplications(picker.open && choice === "fit");
	const query = choice === "fit" ? applications : documents;
	const title = choice === "fit" ? t`Check fit` : choice === "writing" ? t`Review writing` : t`Improve selected line`;
	return (
		<Card style={{ gap: space.s3 }}>
			<Text variant="title">{t`AI is ready`}</Text>
			<Button
				label={t`Improve selected line`}
				variant="secondary"
				onPress={() => setPicker({ choice: "improve", open: true })}
			/>
			<Button
				label={t`Review writing`}
				variant="secondary"
				onPress={() => setPicker({ choice: "writing", open: true })}
			/>
			<Button label={t`Check fit`} variant="secondary" onPress={() => setPicker({ choice: "fit", open: true })} />
			<Button label={t`New cover letter`} variant="secondary" onPress={() => router.push(routes.new("letters"))} />
			<Button label={t`Ask the coach`} variant="secondary" onPress={() => router.push(routes.career("coach"))} />
			<Button label={t`Dismiss`} variant="ghost" onPress={onDismiss} />
			<Sheet open={picker.open} onClose={close} title={title}>
				<View style={{ padding: space.s4, gap: space.s3 }}>
					<Text color="ink2">{choice === "fit" ? t`Choose an application` : t`Choose a resume`}</Text>
					{query.isPending ? (
						<Text>{t`Loading…`}</Text>
					) : query.error ? (
						<>
							<Text accessibilityRole="alert" color="dangerText">
								{choice === "fit" ? t`Couldn't load applications. Try again.` : t`Couldn't load documents. Try again.`}
							</Text>
							<Button label={t`Try again`} onPress={() => void query.refetch()} />
						</>
					) : choice === "fit" ? (
						applications.data?.length ? (
							applications.data.map((application) => (
								<ListRow
									key={application.id}
									title={application.role}
									subtitle={application.company}
									chevron
									onPress={() => {
										close();
										router.push(routes.application(application.id, "fit"));
									}}
								/>
							))
						) : (
							<>
								<Text>{t`No applications yet.`}</Text>
								<Button
									label={t`Save a job`}
									onPress={() => {
										close();
										router.push(routes.newJob());
									}}
								/>
							</>
						)
					) : resumes?.length ? (
						resumes.map((resume) => (
							<ListRow
								key={resume.id}
								title={resume.name}
								chevron
								onPress={() => {
									close();
									if (choice === "writing")
										router.push({ pathname: "/builder/[id]/check", params: { id: resume.id, tab: "writing" } });
									else router.push(routes.builder(resume.id, "write"));
								}}
							/>
						))
					) : (
						<>
							<Text>{t`No resumes yet`}</Text>
							<Button
								label={t`Import or create a resume`}
								onPress={() => {
									close();
									router.push(routes.new());
								}}
							/>
						</>
					)}
				</View>
			</Sheet>
		</Card>
	);
}
