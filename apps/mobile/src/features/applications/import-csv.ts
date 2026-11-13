// J1 · Import (CSV): pick a file, map its columns the way the web does, and create the applications. Stages from the
// file keep their category; custom stages from another tracker are not created here.
import { t } from "@lingui/core/macro";
import * as DocumentPicker from "expo-document-picker";
import { applyLaneMapping, mapCsvToApplications, parseCsv } from "@reactive-resume/schema/applications/csv";
import { useApplicationActions } from "@/data";
import { haptic, showToast } from "@/ui";

export function useCsvImport() {
	const actions = useApplicationActions();
	return async () => {
		const picked = await DocumentPicker.getDocumentAsync({
			copyToCacheDirectory: true,
			multiple: false,
			type: ["text/csv", "text/comma-separated-values", "public.comma-separated-values-text"],
		});
		const asset = picked.canceled ? null : picked.assets[0];
		if (!asset) return;
		try {
			const text = await (await fetch(asset.uri)).text();
			const result = mapCsvToApplications(parseCsv(text));
			if (result.rows.length === 0) {
				showToast({ message: t`No applications found. Each row needs a company and a role.` });
				return;
			}
			// ponytail: custom stages aren't created on the phone; rows keep their stage's category.
			const { imported } = await actions.importMany({ items: applyLaneMapping(result.rows, new Map()) });
			haptic("success");
			showToast({
				message:
					result.skipped > 0
						? t`Imported ${imported} applications. ${result.skipped} rows had no company or role.`
						: t`Imported ${imported} applications.`,
			});
		} catch {
			haptic("error");
			showToast({ message: t`Couldn't import the file. Check it's a CSV and try again.` });
		}
	};
}
