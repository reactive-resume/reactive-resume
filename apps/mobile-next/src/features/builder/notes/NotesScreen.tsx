// Notes (from B19): private plain-text notes about the resume, never shown on it.
import { t } from "@lingui/core/macro";
import { useRef } from "react";
import { BuilderScreen, editResume, useLocked, useResumeData, useSaveWord } from "../shared/document";
import { notesToText, textToNotes } from "./notes-text";
import { resumeFieldFocus } from "@/data";
import { Form, TextField } from "@/ui";

export function NotesScreen() {
	const data = useResumeData();
	const locked = useLocked();
	const word = useSaveWord();
	const visit = useRef(0);
	if (!data) return <BuilderScreen title={t`Notes`}>{null}</BuilderScreen>;
	return (
		<BuilderScreen title={t`Notes`} status={word}>
			<Form>
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
			</Form>
		</BuilderScreen>
	);
}
