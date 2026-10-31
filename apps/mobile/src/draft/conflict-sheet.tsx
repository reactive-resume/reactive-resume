import type { ConflictChoice } from "./types";
import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { Modal, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLetterStore, useResumeStore } from "./runtime";
import { Button, ConfirmDialog, Text, useTheme } from "@/ui";

type DraftConflictSheetProps = {
	open: boolean;
	kind: "resume" | "letter";
	name: string;
	locked: boolean;
	reason?: "CURRENT_CLIENT_REQUIRED" | undefined;
	onResolve: (choice: ConflictChoice) => Promise<void>;
};

/** A required choice: native back, backdrop taps and swipe cannot discard an unsaved draft. */
export function DraftConflictSheet({ open, kind, name, locked, reason, onResolve }: DraftConflictSheetProps) {
	const { t } = useLingui();
	const { colors, radius, space } = useTheme();
	const insets = useSafeAreaInsets();
	const [confirm, setConfirm] = useState(false);
	const [busy, setBusy] = useState(false);
	const [failed, setFailed] = useState(false);
	const resolve = async (choice: ConflictChoice) => {
		setConfirm(false);
		setBusy(true);
		setFailed(false);
		try {
			await onResolve(choice);
		} catch {
			setFailed(true);
		} finally {
			setBusy(false);
		}
	};

	return (
		<Modal visible={open} transparent animationType="none" onRequestClose={() => {}}>
			<View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: colors.scrimSheet }}>
				<View
					accessibilityViewIsModal
					style={{
						maxHeight: "90%",
						backgroundColor: colors.raised,
						borderTopStartRadius: radius.rLg,
						borderTopEndRadius: radius.rLg,
					}}
				>
					<ScrollView
						contentContainerStyle={{ gap: space.s3, padding: space.s5, paddingBottom: insets.bottom + space.s5 }}
					>
						<Text
							variant="heading"
							accessibilityRole="header"
							accessibilityHint={t`Choose a version to continue. Back will not close this sheet.`}
						>
							{reason
								? t`This older draft needs review`
								: kind === "resume"
									? t`This resume changed elsewhere`
									: t`This letter changed elsewhere`}
						</Text>
						<Text color="ink2">
							{reason
								? t`An older app kept these edits. They can't safely replace “${name}”. Keep them as a separate document, or load the saved version and edit it here.`
								: t`Changes to “${name}” were saved on another device. Your edits are still on this device. Choose which version to keep.`}
						</Text>
						{locked && !reason ? (
							<Text color="warnText">{t`This document is locked. Unlock it before keeping your edits here, or keep both.`}</Text>
						) : null}
						{!reason && (
							<>
								<Button
									fullWidth
									label={t`Keep mine`}
									disabled={locked || busy}
									onPress={() => void resolve("keep-mine")}
								/>
								<Text variant="callout" color="ink2">{t`Save your version over theirs.`}</Text>
							</>
						)}
						<Button
							fullWidth
							variant="secondary"
							label={reason ? t`Use saved version` : t`Use theirs`}
							disabled={busy}
							onPress={() => setConfirm(true)}
						/>
						<Text variant="callout" color="ink2">{t`Discard your offline edits and load the saved version.`}</Text>
						<Button
							fullWidth
							variant="secondary"
							label={t`Keep both`}
							disabled={busy}
							onPress={() => void resolve("keep-both")}
						/>
						<Text variant="callout" color="ink2">{t`Save yours as a new document and keep theirs here.`}</Text>
						{failed ? (
							<Text
								accessibilityRole="alert"
								color="dangerText"
							>{t`Couldn't save your changes. Your edits are still on this device. Try again.`}</Text>
						) : null}
					</ScrollView>
				</View>
			</View>
			<ConfirmDialog
				open={open && confirm}
				title={t`Discard your offline edits?`}
				message={t`Your changes on this device will be replaced by the saved version.`}
				confirmLabel={reason ? t`Use saved version` : t`Use theirs`}
				destructive
				onConfirm={() => void resolve("use-theirs")}
				onCancel={() => setConfirm(false)}
			/>
		</Modal>
	);
}

export function ResumeConflictSheet() {
	const draft = useResumeStore();
	return (
		<DraftConflictSheet
			open={!!draft.conflict}
			kind="resume"
			name={draft.document?.name ?? ""}
			locked={draft.locked}
			reason={draft.conflict?.reason}
			onResolve={draft.resolveConflict}
		/>
	);
}

export function LetterConflictSheet() {
	const draft = useLetterStore();
	return (
		<DraftConflictSheet
			open={!!draft.conflict}
			kind="letter"
			name={draft.document?.name ?? ""}
			locked={draft.locked}
			reason={draft.conflict?.reason}
			onResolve={draft.resolveConflict}
		/>
	);
}
