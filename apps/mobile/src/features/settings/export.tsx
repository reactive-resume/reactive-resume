import { useLingui } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useEffect, useRef } from "react";
import { AccountExportLimitError, buildAccountZip } from "@reactive-resume/utils/account-zip";
import { clearAccountExportCache } from "./export-cache";
import { client } from "@/api/client";
import { getAccountScope } from "@/auth/session";
import { Button, ListRow, showToast } from "@/ui";

export function ExportDataRow() {
	const { t } = useLingui();
	const exportRequest = useRef<AbortController | null>(null);
	useEffect(() => () => exportRequest.current?.abort(), []);
	const exportData = useMutation({
		mutationKey: ["settings", "export"],
		mutationFn: async () => {
			const scope = getAccountScope();
			if (!scope) return;
			const request = new AbortController();
			exportRequest.current = request;
			try {
				clearAccountExportCache();
				if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing unavailable");
				const data = await client.auth.exportData(
					{ includeUploads: true },
					{ context: { scope }, signal: request.signal },
				);
				if (request.signal.aborted || getAccountScope() !== scope) return;
				// The same zip as web (one file per resume and letter, ready to import), so the guide's steps work here too.
				const file = new File(Paths.cache, `reactive-resume-${Date.now()}.zip`);
				await file.write(buildAccountZip(data));
				if (request.signal.aborted || getAccountScope() !== scope) {
					if (file.exists) file.delete();
					return;
				}
				// Android recipients may still read this file after shareAsync resolves; sweep it on the next export.
				await Sharing.shareAsync(file.uri, {
					mimeType: "application/zip",
					UTI: "public.zip-archive",
					dialogTitle: t`Export everything`,
				});
				if (getAccountScope() !== scope) return;
				if (!data.uploads)
					showToast({ message: t`This server exports file references only. Update it to include uploaded files.` });
				else if (data.uploads.skipped.length)
					showToast({ message: t`Some uploaded files were skipped. Check upload-manifest.json in the archive.` });
			} catch (error) {
				if (!request.signal.aborted) throw error;
			} finally {
				if (exportRequest.current === request) exportRequest.current = null;
			}
		},
		onError: (error) =>
			showToast({
				message:
					error instanceof AccountExportLimitError
						? t`This account is too large for one archive. Export individual documents instead.`
						: t`Couldn't export. Try again.`,
			}),
	});
	return (
		<ListRow
			title={exportData.isPending ? t`Preparing export…` : t`Export everything`}
			subtitle={t`Documents, version history and uploaded files in one zip. Check the file manifest for omissions.`}
			leading="download-simple"
			trailing={
				exportData.isPending ? (
					<Button label={t`Cancel`} variant="ghost" onPress={() => exportRequest.current?.abort()} />
				) : undefined
			}
			onPress={exportData.isPending ? undefined : () => exportData.mutate()}
		/>
	);
}
