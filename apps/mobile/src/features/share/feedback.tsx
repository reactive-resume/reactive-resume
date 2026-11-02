import type { RouterOutput } from "@/api/client";
import { useLingui } from "@lingui/react/macro";
import { ORPCError } from "@orpc/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { Share, View } from "react-native";
import { formatTimeSince } from "@reactive-resume/resume/sharing";
import { orpc } from "@/api/client";
import { getAccountScope, getServer } from "@/auth/session";
import { applicationsListQueryOptions } from "@/features/applications/queries";
import {
	Banner,
	Button,
	ConfirmDialog,
	ListRow,
	Segmented,
	Sheet,
	Skeleton,
	Switch,
	Text,
	TextField,
	showToast,
	useTheme,
} from "@/ui";

type FeedbackLink = RouterOutput["feedback"]["list"][number];

/** The server explains refusals it can name (the open-link limit, a past expiry); anything else gets `fallback`. */
const feedbackError = (error: unknown, fallback: string) =>
	error instanceof ORPCError && error.code === "BAD_REQUEST" && error.message ? error.message : fallback;

/** Most applications one link shares; the server holds the same limit. */
const MAX_APPLICATIONS = 20;
type Expiry = "7" | "30" | "90" | "never";

/** Feedback links for this resume, kept per server like the rest of the account's queries. */
const linksQueryOptions = (resumeId: string) => {
	const options = orpc.feedback.list.queryOptions({
		input: { resumeId },
		context: { scope: getAccountScope() ?? undefined },
	});
	return { ...options, queryKey: [...options.queryKey, getServer()] };
};

type FeedbackLinksProps = { resumeId: string; offline: boolean };

/**
 * Feedback links, as on the web: a private link to this version of the resume for one reviewer. The owner sees who
 * each is for, whether it was opened and its comments, and can turn it off.
 */
export function FeedbackLinks({ resumeId, offline }: FeedbackLinksProps) {
	const { t, i18n } = useLingui();
	const { space, colors, size } = useTheme();
	const [creating, setCreating] = useState(false);
	const [openId, setOpenId] = useState<string | null>(null);
	const links = useQuery({ ...linksQueryOptions(resumeId), enabled: !offline });

	return (
		<View style={{ gap: space.s3, paddingTop: space.s4, borderTopWidth: 1, borderColor: colors.line }}>
			<Text variant="heading">{t`Feedback links`}</Text>
			<Text color="ink2">
				{t`Send a coach or friend a private link to this version. They can comment, but can't change it or see anything else.`}
			</Text>
			{links.isError ? (
				<Banner
					tone="danger"
					message={t`Couldn't load your feedback links.`}
					action={{ label: t`Retry`, onPress: () => void links.refetch() }}
				/>
			) : links.isPending && !offline ? (
				<Skeleton height={size.hit} />
			) : (
				(links.data ?? []).map((link) => (
					<ListRow
						key={link.id}
						title={link.label}
						subtitle={`${statusText(t, link.status)} · ${
							link.lastViewedAt ? t`Opened ${formatTimeSince(link.lastViewedAt, i18n.locale)} ago` : t`Not opened yet`
						} · ${
							link.openCommentCount === 1 ? t`1 new comment` : t`${i18n.number(link.openCommentCount)} new comments`
						}`}
						leading="link-simple-horizontal"
						chevron
						onPress={() => setOpenId(link.id)}
					/>
				))
			)}
			<Button
				variant="secondary"
				label={t`New feedback link`}
				icon="link-simple-horizontal"
				disabled={offline}
				onPress={() => setCreating(true)}
			/>
			<NewFeedbackLinkSheet
				resumeId={resumeId}
				open={creating}
				onClose={() => setCreating(false)}
				onCreated={(link) => {
					setCreating(false);
					setOpenId(link.id);
				}}
			/>
			{openId && <FeedbackLinkSheet id={openId} onClose={() => setOpenId(null)} />}
		</View>
	);
}

const statusText = (t: ReturnType<typeof useLingui>["t"], status: FeedbackLink["status"]) =>
	status === "active" ? t`Active` : status === "expired" ? t`Expired` : t`Revoked`;

type NewFeedbackLinkSheetProps = {
	resumeId: string;
	open: boolean;
	onClose: () => void;
	onCreated: (link: FeedbackLink) => void;
};

function NewFeedbackLinkSheet({ resumeId, open, onClose, onCreated }: NewFeedbackLinkSheetProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const queryClient = useQueryClient();
	const [label, setLabel] = useState("");
	const [allowComments, setAllowComments] = useState(true);
	const [expiry, setExpiry] = useState<Expiry>("30");
	const [applicationIds, setApplicationIds] = useState<string[]>([]);
	const applications = useQuery({ ...applicationsListQueryOptions(), enabled: open });
	const create = useMutation({
		...orpc.feedback.create.mutationOptions({ context: { scope: getAccountScope() ?? undefined } }),
		onSuccess: (link) => {
			void queryClient.invalidateQueries({ queryKey: orpc.feedback.key() });
			setLabel("");
			setApplicationIds([]);
			onCreated(link);
		},
		onError: (error) => showToast({ message: feedbackError(error, t`Couldn't make the link. Try again.`) }),
	});
	// Open applications first, then the ones that use this resume.
	const choices = (applications.data ?? [])
		.filter((application) => application.status !== "closed")
		.toSorted((a, b) => Number(b.resumeId === resumeId) - Number(a.resumeId === resumeId));

	return (
		<Sheet
			open={open}
			title={t`New feedback link`}
			onClose={() => !create.isPending && onClose()}
			footer={
				<Button
					label={t`Make link`}
					loading={create.isPending}
					disabled={create.isPending || !label.trim()}
					onPress={() =>
						create.mutate({
							resumeId,
							label: label.trim(),
							allowComments,
							applicationIds,
							expiresAt: expiry === "never" ? null : new Date(Date.now() + Number(expiry) * 24 * 60 * 60 * 1000),
						})
					}
				/>
			}
		>
			<View style={{ gap: space.s4, padding: space.s4 }}>
				<Text color="ink2">
					{t`The link opens the resume as it is now. Later edits aren't shared, so every comment is about this version.`}
				</Text>
				<TextField
					label={t`Who is it for?`}
					value={label}
					onChangeText={setLabel}
					maxLength={80}
					placeholder={t`For example, Careers office`}
					helper={t`Only you see this.`}
				/>
				<Switch label={t`Allow comments`} value={allowComments} onValueChange={setAllowComments} />
				<Segmented<Expiry>
					label={t`Link expires`}
					value={expiry}
					onChange={setExpiry}
					options={[
						{ value: "7", label: t`7 days` },
						{ value: "30", label: t`30 days` },
						{ value: "90", label: t`90 days` },
						{ value: "never", label: t`Never` },
					]}
				/>
				<View style={{ gap: space.s2 }}>
					<Text weight={600}>{t`Share application progress (optional)`}</Text>
					<Text variant="caption" color="ink3">
						{t`The reviewer sees each one's stage and dates. Notes, contacts and pay stay private.`}
					</Text>
					{choices.length === 0 && !applications.isPending ? (
						<Text color="ink3">{t`No open applications.`}</Text>
					) : (
						choices.map((application) => {
							const checked = applicationIds.includes(application.id);
							return (
								<ListRow
									key={application.id}
									title={`${application.role} · ${application.company}`}
									leading={checked ? "check-square" : "square"}
									selected={checked}
									disabled={!checked && applicationIds.length >= MAX_APPLICATIONS}
									onPress={() =>
										setApplicationIds((current) =>
											checked ? current.filter((id) => id !== application.id) : [...current, application.id],
										)
									}
								/>
							);
						})
					)}
				</View>
			</View>
		</Sheet>
	);
}

type FeedbackLinkSheetProps = { id: string; onClose: () => void };

/** One link: copy or share it, tick off its comments, see its activity, or turn it off. */
function FeedbackLinkSheet({ id, onClose }: FeedbackLinkSheetProps) {
	const { t, i18n } = useLingui();
	const { space, colors, radius } = useTheme();
	const queryClient = useQueryClient();
	const [confirmRevoke, setConfirmRevoke] = useState(false);
	const context = { scope: getAccountScope() ?? undefined };
	const query = useQuery(orpc.feedback.get.queryOptions({ input: { id }, context }));
	const refresh = () => void queryClient.invalidateQueries({ queryKey: orpc.feedback.key() });
	const revoke = useMutation({
		...orpc.feedback.revoke.mutationOptions({ context }),
		onSuccess: () => {
			refresh();
			showToast({ message: t`Link turned off` });
		},
		onError: (error) => showToast({ message: feedbackError(error, t`Couldn't turn off the link. Try again.`) }),
	});
	const resolve = useMutation({
		...orpc.feedback.resolveComment.mutationOptions({ context }),
		onSuccess: refresh,
		onError: (error) => showToast({ message: feedbackError(error, t`Couldn't update the comment. Try again.`) }),
	});
	const link = query.data;
	const date = (value: Date) => i18n.date(value, { dateStyle: "medium", timeStyle: "short" });

	return (
		<Sheet open title={link?.label ?? t`Feedback link`} onClose={onClose}>
			<View style={{ gap: space.s4, padding: space.s4 }}>
				{query.isError ? (
					<Banner
						tone="danger"
						message={t`Couldn't load this link.`}
						action={{ label: t`Retry`, onPress: () => void query.refetch() }}
					/>
				) : !link ? (
					<Skeleton height={space.s8 * 2} />
				) : (
					<>
						<Text color="ink2">
							{t`“${link.resumeName}” as saved ${date(link.createdAt)}.`} {statusText(t, link.status)}
							{link.expiresAt && link.status === "active" ? ` · ${t`expires ${date(link.expiresAt)}`}` : ""}
						</Text>
						{link.status === "active" && (
							<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s2 }}>
								<Button
									variant="secondary"
									label={t`Copy`}
									icon="copy"
									onPress={() =>
										void Clipboard.setStringAsync(link.url).then(() => showToast({ message: t`Link copied` }))
									}
								/>
								<Button
									variant="secondary"
									label={t`Share via…`}
									icon="export"
									onPress={() => void Share.share({ message: link.url, url: link.url })}
								/>
							</View>
						)}
						<Text variant="heading">{t`Comments`}</Text>
						{link.comments.length === 0 ? (
							<Text color="ink3">{t`No comments yet.`}</Text>
						) : (
							link.comments.map((comment) => (
								<View
									key={comment.id}
									style={{ gap: space.s1, padding: space.s3, borderRadius: radius.rMd, backgroundColor: colors.sunken }}
								>
									<Text variant="caption" color="ink3">
										{`${comment.authorName} · ${date(comment.createdAt)}`}
									</Text>
									<Text selectable>{comment.body}</Text>
									<Switch
										label={t`Done`}
										value={Boolean(comment.resolvedAt)}
										disabled={resolve.isPending}
										onValueChange={(resolved) => resolve.mutate({ id: link.id, commentId: comment.id, resolved })}
									/>
								</View>
							))
						)}
						<Text variant="heading">{t`Activity`}</Text>
						{link.events.map((event) => (
							<Text key={event.id} variant="caption" color="ink2">
								{`${
									event.type === "created"
										? t`Link made`
										: event.type === "viewed"
											? t`Opened`
											: event.type === "commented"
												? t`Comment left`
												: t`Link turned off`
								} · ${date(event.createdAt)}`}
							</Text>
						))}
						{link.status === "active" && (
							<Button
								variant="dangerOutline"
								label={t`Turn off link…`}
								disabled={revoke.isPending}
								onPress={() => setConfirmRevoke(true)}
							/>
						)}
					</>
				)}
			</View>
			<ConfirmDialog
				open={confirmRevoke}
				title={t`Turn off this link?`}
				message={t`It stops opening at once. Comments already left are kept. You can make a new link anytime.`}
				confirmLabel={t`Turn off`}
				destructive
				onCancel={() => setConfirmRevoke(false)}
				onConfirm={() => {
					setConfirmRevoke(false);
					if (link) revoke.mutate({ id: link.id });
				}}
			/>
		</Sheet>
	);
}
