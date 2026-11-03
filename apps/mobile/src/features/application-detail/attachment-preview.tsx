import type { PageImage } from "../../../modules/pdf-pages";
import type { Session } from "@/auth/session";
import type { ReactNode } from "react";
import { useLingui } from "@lingui/react/macro";
import { File } from "expo-file-system";
import { Image } from "expo-image";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { formatFileSize } from "@reactive-resume/utils/file";
import { readResponseBytes } from "@reactive-resume/utils/http";
import { pdfPages } from "../../../modules/pdf-pages";
import { MAX_ATTACHMENT_BYTES } from "./attachment";
import { privateUpload } from "@/api/client";
import { getAccountScope, getSession, subscribeIdentity, useSession } from "@/auth/session";
import { exportDirectory, shareExport } from "@/features/share/files";
import { safeFileName } from "@/features/share/model";
import { Button, ListRow, showToast, Text, useTheme } from "@/ui";

type AttachmentPreviewProps = { url: string; name: string; trailing: ReactNode };
type ScopedPreviewProps = AttachmentPreviewProps & { scope: string; session: Session };
type PreviewState = {
	session: Session;
	attempt: number;
	bytes: Uint8Array | null;
	page: PageImage | null;
	failed: boolean;
};

export function AttachmentPreview(props: AttachmentPreviewProps) {
	const session = useSession();
	const scope = getAccountScope();
	return scope ? (
		<ScopedAttachmentPreview key={`${scope}:${props.url}`} {...props} scope={scope} session={session} />
	) : null;
}

function ScopedAttachmentPreview({ url, name, trailing, scope, session }: ScopedPreviewProps) {
	const { t, i18n } = useLingui();
	const { colors, space } = useTheme();
	const [preview, setPreview] = useState<PreviewState | null>(null);
	const [sharing, setSharing] = useState(false);
	const [attempt, setAttempt] = useState(0);
	const shown = preview?.session === session && preview.attempt === attempt ? preview : null;
	const bytes = shown?.bytes;
	const page = shown?.page;
	const failed = shown?.failed;
	useEffect(() => {
		let active = true;
		let id: string | undefined;
		const abort = new AbortController();
		const current = () => active && getAccountScope() === scope && getSession() === session;
		const clear = () => {
			active = false;
			abort.abort();
			if (id) {
				void pdfPages.close(id).catch(() => {});
				id = undefined;
			}
		};
		const unsubscribe = subscribeIdentity(() => {
			clear();
			setPreview(null);
		});
		let data: Uint8Array | null = null;
		void (async () => {
			const response = await privateUpload(url, abort.signal, scope);
			data = await readResponseBytes(response, MAX_ATTACHMENT_BYTES, abort.signal);
			if (!current()) return;
			setPreview({ session, attempt, bytes: data, page: null, failed: false });
			const document = await pdfPages.open(data);
			if (!current()) {
				await pdfPages.close(document.id);
				return;
			}
			id = document.id;
			const first = document.pages[0];
			if (
				!first ||
				!Number.isFinite(first.width) ||
				!Number.isFinite(first.height) ||
				first.width <= 0 ||
				first.height <= 0
			)
				throw new Error("Invalid PDF page.");
			const images = await pdfPages.rasterize(id, [0], Math.min(2, 320 / first.width, 400 / first.height));
			if (!images[0]) throw new Error("PDF preview unavailable.");
			if (current()) setPreview({ session, attempt, bytes: data, page: images[0], failed: false });
		})().catch(() => {
			if (current()) setPreview({ session, attempt, bytes: data, page: null, failed: true });
		});
		return () => {
			unsubscribe();
			clear();
		};
	}, [url, scope, session, attempt]);
	const share = async () => {
		if (!bytes || sharing || getAccountScope() !== scope) return;
		setSharing(true);
		let file: File | undefined;
		try {
			file = new File(exportDirectory(), `${safeFileName(name.replace(/\.pdf$/i, "")) || "document"}.pdf`);
			await file.write(bytes);
			if (getAccountScope() !== scope) {
				if (file.exists) file.delete();
				return;
			}
			await shareExport(file, "pdf", scope);
		} catch {
			if (getAccountScope() === scope) showToast({ message: t`Couldn't share the file. Try again.` });
		} finally {
			if (getAccountScope() === scope) setSharing(false);
		}
	};
	return (
		<View style={{ gap: space.s2, paddingBottom: space.s3 }}>
			<ListRow
				leading="file-pdf"
				title={name}
				subtitle={bytes ? formatFileSize(bytes.byteLength, i18n.locale) : "PDF"}
				trailing={trailing}
			/>
			<View style={{ gap: space.s2, paddingHorizontal: space.s3 }}>
				{page ? (
					<Image
						source={{ uri: page.uri }}
						cachePolicy="none"
						accessibilityLabel={`${t`Page ${1}`} · ${name}`}
						style={{
							width: Math.min(128, (160 * page.width) / page.height),
							maxWidth: "100%",
							aspectRatio: page.width / page.height,
						}}
					/>
				) : !failed ? (
					<ActivityIndicator color={colors.accent} accessibilityLabel={t`Loading…`} />
				) : null}
				{failed ? <Text color="ink3" variant="callout">{t`Couldn't read that file. Try again.`}</Text> : null}
				{failed ? (
					<Button size="sm" variant="secondary" label={t`Try again`} onPress={() => setAttempt((value) => value + 1)} />
				) : null}
				{bytes ? (
					<Button
						size="sm"
						variant="secondary"
						icon="download-simple"
						label={t`Save or share file`}
						loading={sharing}
						onPress={() => void share()}
					/>
				) : null}
			</View>
		</View>
	);
}
