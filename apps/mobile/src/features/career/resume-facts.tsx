import type { RouterOutput } from "@/api/client";
import { t } from "@lingui/core/macro";
import { ORPCError } from "@orpc/client";
import { useEffect, useRef, useState } from "react";
import { useWindowDimensions, View } from "react-native";
import { MAX_RESUME_FACT_CHARACTERS } from "@reactive-resume/schema/career";
import { ResourceState } from "./shared";
import { useCareerActions, useDocuments } from "@/data";
import { BottomSheet, Button, Checkbox, FooterBar, ListRow, SheetScrollView, Text, TextField, showToast } from "@/ui";

type Review = RouterOutput["career"]["proposeResumeFacts"];
type Draft = Review["proposals"][number] & { selected: boolean };

export function ResumeFactsSheet({ onClose }: { onClose: () => void }) {
	const { height } = useWindowDimensions();
	const actions = useCareerActions();
	const documents = useDocuments({ type: "resume" });
	const [review, setReview] = useState<Review | null>(null);
	const [drafts, setDrafts] = useState<Draft[]>([]);
	const [busy, setBusy] = useState(false);
	const [failure, setFailure] = useState("");
	const mounted = useRef(false);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	const close = () => {
		mounted.current = false;
		onClose();
	};
	const selected = drafts.filter((item) => item.selected);
	const change = (quote: string, patch: Partial<Draft>) =>
		setDrafts((items) => items.map((item) => (item.quote === quote ? { ...item, ...patch } : item)));

	const preview = async (resumeId: string) => {
		setBusy(true);
		setFailure("");
		try {
			const result = await actions.proposeResumeFacts({ resumeId });
			if (!mounted.current) return;
			setReview(result);
			setDrafts(result.proposals.map((item) => ({ ...item, selected: !item.forgottenFactId })));
		} catch {
			if (mounted.current) setFailure(t`Couldn't load or save resume facts. Try again.`);
		} finally {
			if (mounted.current) setBusy(false);
		}
	};

	const save = async () => {
		if (!review || busy || selected.length === 0) return;
		setBusy(true);
		setFailure("");
		try {
			const { saved, skipped } = await actions.saveResumeFacts({
				resumeId: review.id,
				updatedAt: review.updatedAt,
				proposals: selected.map(({ text, quote, category }) => ({ text, quote, category })),
				restoreForgottenFactIds: selected.flatMap(({ forgottenFactId }) => (forgottenFactId ? [forgottenFactId] : [])),
			});
			if (!mounted.current) return;
			showToast({
				message: t`Saved: ${saved}. Skipped: ${skipped}. Existing, corrected or switched-off facts stay unchanged.`,
			});
			close();
		} catch (error) {
			if (!mounted.current) return;
			if (error instanceof ORPCError && (error.code === "CONFLICT" || error.code === "NOT_FOUND")) {
				setReview(null);
				setFailure(t`This resume is no longer current. Choose a resume and review it again.`);
			} else setFailure(t`Couldn't load or save resume facts. Try again.`);
		} finally {
			if (mounted.current) setBusy(false);
		}
	};

	return (
		<BottomSheet
			title={review ? t`Review resume facts` : t`Pull facts from my resume`}
			height={Math.min(640, height * 0.86)}
			keyboard
			onClose={close}
			back={
				review && !busy
					? {
							label: t`Choose another resume`,
							onPress: () => {
								setReview(null);
								setFailure("");
							},
						}
					: undefined
			}
			footer={
				review && drafts.length > 0 ? (
					<FooterBar bg="raised">
						<Button
							label={t`Save selected facts`}
							disabled={busy || !selected.length || selected.some((item) => !item.text.trim())}
							tone="primary"
							block
							onPress={() => void save()}
						/>
					</FooterBar>
				) : null
			}
		>
			<SheetScrollView contentContainerStyle={{ padding: 24, gap: 16 }}>
				{failure && <Text color="dangerText">{failure}</Text>}
				{!review ? (
					<ResourceState
						pending={documents.isPending || busy}
						error={documents.isError}
						retry={() => void documents.refetch()}
					>
						{!documents.data?.length && <Text>{t`Create or import a resume in Documents first.`}</Text>}
						{documents.data
							?.filter((row) => row.type === "resume")
							.map((resume) => (
								<ListRow key={resume.id} title={resume.name} trailing="caret" onPress={() => void preview(resume.id)} />
							))}
					</ResourceState>
				) : (
					<>
						{drafts.length === 0 && (
							<Text>{t`No supported excerpts found. Add a fact manually or choose another resume.`}</Text>
						)}
						{drafts.map(({ quote, text, selected, forgottenFactId }) => (
							<View key={quote} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
								<Checkbox
									value={selected}
									saves={false}
									disabled={busy}
									accessibilityLabel={
										forgottenFactId ? t`Re-add this forgotten fact: ${text}` : t`Save this fact: ${text}`
									}
									onValueChange={(checked) => change(quote, { selected: checked })}
								/>
								<View style={{ flex: 1, gap: 4 }}>
									{forgottenFactId && <Text color="ink2">{t`Previously forgotten`}</Text>}
									<TextField
										label={t`Fact`}
										value={text}
										onChangeText={(value) => change(quote, { text: value })}
										maxLength={MAX_RESUME_FACT_CHARACTERS}
										editable={!busy}
										multiline
									/>
									<Text color="ink3">{t`from “${quote}”`}</Text>
								</View>
							</View>
						))}
						{review.omitted > 0 && (
							<Text color="ink3">{t`Some resume text was left out; add other facts yourself.`}</Text>
						)}
					</>
				)}
			</SheetScrollView>
		</BottomSheet>
	);
}
