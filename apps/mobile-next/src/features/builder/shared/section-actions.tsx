import type { MenuAction } from "./anchored-menu";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
// Section options shared by B1 (long-press a section) and B2 (···): Move up, Move down, Hide or Show, Rename.
import { t } from "@lingui/core/macro";
import { useState } from "react";
import { editResume } from "./document";
import { type BuilderSection, getSectionObject, pageOf, sectionMeta, stepSection } from "./model";
import { Dialog, TextField } from "@/ui";

export function sectionActions(
	data: ResumeData,
	section: BuilderSection,
	rename: () => void,
): { up: MenuAction; down: MenuAction; hide: MenuAction; rename: MenuAction } {
	const page = data.metadata.layout.pages[pageOf(data, section.id)];
	const column = page?.main.includes(section.id) ? page.main : (page?.sidebar ?? []);
	const index = column.indexOf(section.id);
	const hidden = !!getSectionObject(data, section)?.hidden;
	return {
		up: { label: t`Move up`, disabled: index <= 0, onPress: () => editResume((d) => stepSection(d, section.id, -1)) },
		down: {
			label: t`Move down`,
			disabled: index === -1 || index >= column.length - 1,
			onPress: () => editResume((d) => stepSection(d, section.id, 1)),
		},
		hide: {
			label: hidden ? t`Show on page` : t`Hide from page`,
			onPress: () =>
				editResume((d) => {
					const object = getSectionObject(d, section);
					if (object) object.hidden = !hidden;
				}),
		},
		rename: { label: t`Rename section`, onPress: rename },
	};
}

/** "Rename section": leave it empty to use the original title (web parity). */
export function useRenameSection(data: ResumeData | null) {
	const [section, setSection] = useState<BuilderSection | null>(null);
	const [value, setValue] = useState("");
	const open = (next: BuilderSection) => {
		if (!data) return;
		setValue(getSectionObject(data, next)?.title ?? "");
		setSection(next);
	};
	const close = () => setSection(null);
	const dialog = (
		<Dialog
			open={!!section}
			onClose={close}
			title={t`Rename section`}
			message={t`Leave it empty to use the original title.`}
			actions={[
				{
					label: t`Rename`,
					tone: "primary",
					onPress: () => {
						if (section)
							editResume((d) => {
								const object = getSectionObject(d, section);
								if (object) object.title = value.trim();
							});
						close();
					},
				},
				{ label: t`Cancel`, tone: "secondary", onPress: close },
			]}
		>
			<TextField
				value={value}
				onChangeText={setValue}
				placeholder={section ? sectionMeta[section.type].title() : ""}
				autoFocus
				returnKeyType="done"
			/>
		</Dialog>
	);
	return { open, dialog };
}
