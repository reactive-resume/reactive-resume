// W1 · Fit: a count in words, never a score; each requirement pairs its evidence word with an icon and colour and
// the cited line. Gaps link to Knowledge: missing evidence, not missing ability. Tailor is the one footer action.
import type { IconName } from "@/ui";
import { t } from "@lingui/core/macro";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { STEPS, useAIRun, useWorkspace, Working } from "./shared";
import { queueJobCopy, useDocuments } from "@/data";
import { clockTime, isoDay } from "@/features/applications/model";
import { FadeIn, QuietLine, useBarMenu } from "@/features/applications/parts";
import {
	BottomSheet,
	Button,
	Card,
	FooterBar,
	Icon,
	IconButton,
	layout,
	ListRow,
	MenuItem,
	PageSubtitle,
	PushScreen,
	RowLink,
	SectionHeading,
	Text,
} from "@/ui";

type Requirement = {
	text: string;
	origin: "posting" | "inferred";
	status: "supported" | "partial" | "missing";
	evidence: string;
};

const evidence: Record<
	Requirement["status"],
	{ icon: IconName; color: "accentText" | "warnText" | "ink3"; word: () => string }
> = {
	supported: { icon: "check-circle", color: "accentText", word: () => t`Supported` },
	partial: { icon: "circle-half", color: "warnText", word: () => t`Partly supported` },
	missing: { icon: "question", color: "ink3", word: () => t`No evidence yet` },
};

export function FitScreen() {
	const { id = "" } = useLocalSearchParams<{ id: string }>();
	const router = useRouter();
	const ws = useWorkspace(id);
	const ai = useAIRun(ws.connection);
	const more = useBarMenu();
	const [open, setOpen] = useState<Requirement | null>(null);
	const app = ws.app;
	const fit = ws.latest("fit")[0];
	const check = () => void ai.run("resume-and-facts", () => ws.actions.generate({ task: "fit" }));

	const requirements: Requirement[] = fit
		? fit.data.requirements
		: (app?.requirements ?? []).map((text) => ({ text, origin: "posting", status: "missing", evidence: "" }));
	const withEvidence = requirements.filter((r) => r.status !== "missing").length;
	const groups = [
		// ponytail: the posting's requirements are its must-haves and inferred ones the nice-to-haves; the fit schema
		// has no priority of its own yet.
		{ title: t`Must have`, rows: requirements.filter((r) => r.origin === "posting") },
		{ title: t`Nice to have`, rows: requirements.filter((r) => r.origin === "inferred") },
	].filter((g) => g.rows.length > 0);
	const documents = useDocuments({ type: "resume" });
	// Tailor opens the assistant on the linked resume; without one, it makes a copy of your resume for this job first.
	const tailor = async () => {
		if (!app) return;
		const prompt = encodeURIComponent(t`Tailor to the ${app.company} posting`);
		const base = documents.data?.find((doc) => doc.type === "resume");
		const resumeId = app.resumeId ?? (base ? await queueJobCopy({ resumeId: base.id, applicationId: app.id }) : null);
		router.push(resumeId ? `/builder/${resumeId}/assistant?prompt=${prompt}` : "/new");
	};
	const checkedAt = fit ? new Date(fit.createdAt) : null;
	const checkedLine =
		checkedAt && isoDay(checkedAt, ws.zone) === isoDay(ws.at, ws.zone)
			? t`checked today ${clockTime(checkedAt, ws.zone)}`
			: checkedAt
				? t`checked ${isoDay(checkedAt, ws.zone)}`
				: "";

	return (
		<PushScreen
			clipDump
			title={t`Fit`}
			subtitle={app ? <PageSubtitle status>{t`${app.role} at ${app.company}`}</PageSubtitle> : undefined}
			barEnd={more.wrap(<IconButton icon="dots-three" label={t`More`} onPress={more.open} />)}
			overlay={more.menu(
				<MenuItem
					label={t`Check again`}
					icon="arrows-clockwise"
					onPress={() => {
						more.close();
						check();
					}}
				/>,
			)}
			footer={
				<FooterBar>
					<Button
						label={t`Tailor the resume to this job`}
						icon="sparkle"
						tone="primary"
						size="lg"
						grow
						onPress={() => void tailor()}
					/>
				</FooterBar>
			}
		>
			{app && !app.jobDescription && requirements.length === 0 ? (
				<View style={{ paddingTop: 20 }}>
					<QuietLine>{t`This application has no posting saved yet. Paste it to check fit.`}</QuietLine>
				</View>
			) : null}
			{ai.running ? <Working steps={STEPS.fit()} onStop={ai.stop} /> : null}
			{!fit && !ai.running ? (
				<View style={{ paddingTop: 20, paddingHorizontal: layout.screenMargin }}>
					<Card>
						<Text variant="label">{t`Check this role against your evidence`}</Text>
						<Text variant="ui" color="ink2">
							{ws.connection
								? t`Each requirement is matched to your resume and Knowledge. Missing evidence, not missing ability.`
								: t`Set up AI to match each requirement to your resume and Knowledge.`}
						</Text>
						{ai.failed ? (
							<Text variant="ui" color="dangerText">
								{t`Couldn't check your evidence. Try again.`}
							</Text>
						) : null}
						<Button
							label={ws.connection ? t`Check fit` : t`Set up AI`}
							tone="secondary"
							size="md"
							onPress={ws.connection ? check : () => router.push("/settings/ai")}
						/>
					</Card>
				</View>
			) : null}
			{fit ? (
				<FadeIn px={6}>
					<View style={{ paddingTop: 24, paddingHorizontal: layout.screenMargin }}>
						<Text variant="bigNumber">{t`${withEvidence} of ${requirements.length}`}</Text>
						<View style={{ paddingTop: 4 }}>
							<Text variant="body" color="ink2">
								{t`requirements have evidence`}
							</Text>
						</View>
						<View style={{ paddingTop: 8 }}>
							<Text variant="ui" color="ink3">
								{t`From “${app?.company ?? ""} · ${app?.role ?? ""}” and ${fit.evidence.factIds.length} Knowledge facts · ${checkedLine}`}
							</Text>
						</View>
					</View>
				</FadeIn>
			) : null}
			{groups.map((group) => (
				<View key={group.title}>
					<SectionHeading title={group.title} />
					{group.rows.map((r, i) => {
						const e = evidence[r.status];
						return (
							<ListRow
								key={r.text}
								title={r.text}
								secondary={fit ? (r.evidence ? `${e.word()} · ${r.evidence}` : e.word()) : undefined}
								leading={
									fit ? (
										<View style={{ width: 24, alignItems: "center" }}>
											<Icon name={e.icon} size={22} color={e.color} />
										</View>
									) : undefined
								}
								trailing={
									fit && r.status === "missing" ? (
										<RowLink label={t`Add a fact`} onPress={() => router.push("/career/knowledge/facts")} />
									) : undefined
								}
								last={i === group.rows.length - 1}
								onPress={fit ? () => setOpen(r) : undefined}
							/>
						);
					})}
				</View>
			))}
			{open ? (
				<BottomSheet title={open.text} height={360} onClose={() => setOpen(null)}>
					<View style={{ paddingHorizontal: layout.screenMargin, gap: 8 }}>
						<Text variant="label">{evidence[open.status].word()}</Text>
						<Text variant="body" color="ink2">
							{open.evidence || t`Nothing in your resume or Knowledge says this yet.`}
						</Text>
						<Text variant="ui" color="ink3">
							{t`Check the sources say this before you rely on it.`}
						</Text>
					</View>
				</BottomSheet>
			) : null}
		</PushScreen>
	);
}
