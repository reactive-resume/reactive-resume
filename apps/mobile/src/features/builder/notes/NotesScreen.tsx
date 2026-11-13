// Notes (from B19): private plain-text notes about the resume, never shown on it.
import { t } from "@lingui/core/macro";
import { useRef } from "react";
import { View } from "react-native";
import { BuilderScreen, editResume, useLocked, useResumeData, useSaveWord } from "../shared/document";
import { notesToText, textToNotes } from "./notes-text";
import { resumeFieldFocus, useResumeStore } from "@/data";
import { Form, Text, TextField, Touch, showToast } from "@/ui";

/** B19: typing into a locked resume says how to unlock it. */
export function lockedNotice() {
	showToast({ message: t`This resume is locked. Unlock it to make changes.` });
}

export function NotesScreen() {
	const data = useResumeData();
	const locked = useLocked();
	const word = useSaveWord();
	// Locked while an edit was still unsaved: the edit stays on this device until unlocked.
	const unsaved = useResumeStore((s) => s.locked && (s.status === "saving" || s.status === "error"));
	const visit = useRef(0);
	if (!data) return <BuilderScreen title={t`Notes`}>{null}</BuilderScreen>;
	return (
		<BuilderScreen title={t`Notes`} status={word}>
			<Form>
				<Touch
					feedback="none"
					disabled={!locked}
					accessible={locked}
					onPress={lockedNotice}
					accessibilityLabel={locked ? t`Notes, locked` : undefined}
				>
					<View pointerEvents={locked ? "none" : "auto"}>
						<TextField
							label={t`Notes`}
							multiline
							minHeight={240}
							value={notesToText(data.metadata.notes)}
							placeholder={t`Keep private notes about this resume here. Nobody else can see them.`}
							editable={!locked}
							onFocus={() => {
								visit.current++;
								resumeFieldFocus.onFocus();
							}}
							onBlur={() => resumeFieldFocus.onBlur()}
							onChangeText={(text) =>
								editResume(
									(d) => {
										d.metadata.notes = textToNotes(text);
									},
									{ coalesceKey: `notes:${visit.current}`, sameStep: true },
								)
							}
						/>
					</View>
				</Touch>
				{unsaved ? (
					<Text color="dangerText" accessibilityRole="alert">
						{t`This resume was locked before your latest changes were saved. They're kept on this device: unlock it to save them.`}
					</Text>
				) : null}
			</Form>
		</BuilderScreen>
	);
}
