import { useLingui } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { buildAccountZip } from "@reactive-resume/utils/account-zip";
import { clearAccountExportCache } from "./export-cache";
import { client } from "@/api/client";
import { getAccountScope } from "@/auth/session";
import { ListRow, showToast } from "@/ui";

export function ExportDataRow() {
	const { t } = useLingui();
	const exportData = useMutation({
		mutationKey: ["settings", "export"],
		mutationFn: async () => {
			const scope = getAccountScope();
			if (!scope) return;
			clearAccountExportCache();
			if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing unavailable");
			const data = await client.auth.exportData(undefined, { context: { scope } });
			if (getAccountScope() !== scope) return;
			// The same zip as web (one file per resume and letter, ready to import), so the guide's steps work here too.
			const file = new File(Paths.cache, `reactive-resume-${Date.now()}.zip`);
			await file.write(buildAccountZip(data));
			if (getAccountScope() !== scope) {
				file.delete();
				return;
			}
			// Android recipients may still read this file after shareAsync resolves; sweep it on the next export.
			await Sharing.shareAsync(file.uri, {
				mimeType: "application/zip",
				UTI: "public.zip-archive",
				dialogTitle: t`Export everything`,
			});
		},
		onError: () => showToast({ message: t`Couldn't export. Try again.` }),
	});
	return (
		<ListRow
			title={exportData.isPending ? t`Preparing export…` : t`Export everything`}
			subtitle={t`Your profile, documents, applications and Career data as JSON. Images and attachments remain references.`}
			leading="download-simple"
			disabled={exportData.isPending}
			onPress={() => exportData.mutate()}
		/>
	);
}
