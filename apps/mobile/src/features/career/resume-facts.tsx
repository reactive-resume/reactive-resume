import type { RouterOutput } from "@/api/client";
import { useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { factCategories } from "./fact-categories";
import { EditorSheet, LoadState, SwitchRow } from "./shared";
import { client, orpc } from "@/api/client";
import { getAccountScope, useSession } from "@/auth/session";
import { workspaceError } from "@/features/workspace/hooks";
import { Banner, Button, Card, SelectSheet, Text, TextArea, useTheme } from "@/ui";

type Review = RouterOutput["career"]["proposeResumeFacts"];
type Draft = Review["proposals"][number] & { selected: boolean };

export function ResumeFacts() {
	const { t } = useLingui();
	const session = useSession();
	const scope = session.status === "signed-in" ? getAccountScope() : null;
	const [open, setOpen] = useState(false);
	return (
		<>
			<Button variant="secondary" label={t`Pull facts from my resume`} onPress={() => setOpen(true)} />
			{open && scope ? <ReviewResumeFacts key={scope} onClose={() => setOpen(false)} /> : null}
		</>
	);
}

type ReviewResumeFactsProps = { onClose: () => void };
function ReviewResumeFacts({ onClose }: ReviewResumeFactsProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const session = useSession();
	const queryClient = useQueryClient();
	const [scope] = useState(getAccountScope);
	const alive = useRef(true);
	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
		};
	}, []);
	const current = () => alive.current && scope !== null && scope === getAccountScope();
	const options = orpc.documents.list.queryOptions({ input: { trashed: false } });
	const documents = useQuery({
		...options,
		queryKey: [...options.queryKey, session.server],
		enabled: session.status === "signed-in",
	});
	const [resumeId, setResumeId] = useState("");
	const [review, setReview] = useState<Review | null>(null);
	const [drafts, setDrafts] = useState<Draft[]>([]);
	const [receipt, setReceipt] = useState<string | null>(null);
	const preview = useMutation({
		mutationFn: () => {
			if (!current() || !scope) throw new Error("Account changed");
			return client.career.proposeResumeFacts({ resumeId }, { context: { scope } });
		},
		onSuccess: (result) => {
			if (current()) {
				setReview(result);
				setDrafts(result.proposals.map((item) => ({ ...item, selected: true })));
			}
		},
	});
	const save = useMutation({
		mutationFn: () => {
			if (!current() || !scope || !review) throw new Error("Account changed");
			return client.career.saveResumeFacts(
				{
					resumeId: review.id,
					updatedAt: review.updatedAt,
					proposals: drafts.filter((item) => item.selected).map(({ selected: _selected, ...item }) => item),
				},
				{ context: { scope } },
			);
		},
		onSuccess: (result) => {
			if (current()) {
				setReview(null);
				setDrafts([]);
				setReceipt(
					t`Saved: ${result.saved}. Skipped: ${result.skipped}. Existing, corrected or switched-off facts stay unchanged.`,
				);
				void queryClient.invalidateQueries({ queryKey: orpc.career.facts.key() });
			}
		},
	});
	const busy = preview.isPending || save.isPending;
	const selected = drafts.filter((item) => item.selected);
	const error = preview.error ?? save.error;
	const change = (index: number, patch: Partial<Draft>) =>
		setDrafts((items) => items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
	return (
		<EditorSheet
			title={t`Pull facts from my resume`}
			dirty={!!drafts.length}
			pending={save.isPending}
			onClose={onClose}
		>
			<View style={{ padding: space.s4, gap: space.s3 }}>
				<Text color="ink3">{t`Choose a resume, then review its excerpts. Nothing goes to an AI provider. Only selected facts are saved to Knowledge for all applications.`}</Text>
				<LoadState query={documents} />
				<SelectSheet
					label={t`Resume`}
					value={resumeId}
					disabled={busy || !documents.isSuccess}
					options={[
						{ value: "", label: t`Choose a resume` },
						...(documents.data
							?.filter((row) => row.type === "resume")
							.map((row) => ({ value: row.id, label: row.name })) ?? []),
					]}
					onChange={(value) => {
						setResumeId(value);
						setReview(null);
						setDrafts([]);
						setReceipt(null);
						preview.reset();
						save.reset();
					}}
				/>
				{documents.isSuccess && !documents.data.some((row) => row.type === "resume") ? (
					<Text>{t`Create or import a resume in Documents first.`}</Text>
				) : null}
				<Button
					variant="secondary"
					label={t`Review resume facts`}
					disabled={!resumeId || busy}
					loading={preview.isPending}
					onPress={() => {
						setReview(null);
						setDrafts([]);
						setReceipt(null);
						save.reset();
						preview.mutate();
					}}
				/>
				{error ? (
					<Banner tone="danger" message={workspaceError(error, t`Couldn't load or save resume facts. Try again.`)} />
				) : null}
				{receipt ? <Text accessibilityLiveRegion="polite">{receipt}</Text> : null}
				{review ? (
					<>
						<Text variant="title">{review.name}</Text>
						{!drafts.length ? (
							<Text>{t`No supported excerpts found. Add a fact manually or choose another resume.`}</Text>
						) : null}
						{review.omitted > 0 ? <Text>{t`Some resume text was left out. Add other facts manually.`}</Text> : null}
						{drafts.map((item, index) => (
							<Card key={item.quote}>
								<SwitchRow
									label={t`Save this fact`}
									value={item.selected}
									disabled={save.isPending}
									onValueChange={(selected) => change(index, { selected })}
								/>
								<TextArea
									label={t`Fact`}
									value={item.text}
									maxLength={2000}
									editable={!save.isPending}
									onChangeText={(text) => change(index, { text })}
								/>
								<SelectSheet
									label={t`Type`}
									value={item.category}
									disabled={save.isPending}
									options={factCategories()}
									onChange={(category) => change(index, { category })}
								/>
								<Text variant="label">{t`Source quotation`}</Text>
								<Text selectable color="ink3">
									{item.quote}
								</Text>
							</Card>
						))}
						{drafts.length ? (
							<Button
								label={t`Save selected facts`}
								loading={save.isPending}
								disabled={!selected.length || selected.some((item) => !item.text.trim()) || busy}
								onPress={() => save.mutate()}
							/>
						) : null}
					</>
				) : null}
			</View>
		</EditorSheet>
	);
}
