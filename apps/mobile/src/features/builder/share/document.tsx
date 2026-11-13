import { t } from "@lingui/core/macro";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useContext, useEffect, useState } from "react";
import { View } from "react-native";
import { fnv1a } from "@reactive-resume/utils/string";
import { DockDocumentId } from "../shared/document";
import { useResume, useResumeStore, useLetter, useLetterStore, useDataBackend } from "@/data";
import { pageRenderer, type PageRenderRequest } from "@/render/page-renderer";
import { Button, IconButton, Skeleton, Text } from "@/ui";

export function useDocumentId() {
	const { id } = useLocalSearchParams<{ id: string }>();
	const dock = useContext(DockDocumentId);
	return id ?? dock;
}
export function BuilderActions({ id }: { id: string }) {
	const router = useRouter();
	return (
		<>
			<IconButton icon="sparkle" label={t`Assistant`} onPress={() => router.push(`/builder/${id}/assistant`)} />
			<IconButton icon="dots-three" label={t`More`} onPress={() => router.push(`/builder/${id}/menu`)} />
		</>
	);
}
export function useBuilderDocument(id: string) {
	const query = useResume(id);
	const draft = useResumeStore((s) => (s.document?.id === id ? s.document : null));
	return { ...query, data: draft ?? query.data };
}
export function useLetterDocument(id: string) {
	const query = useLetter(id);
	const draft = useLetterStore((s) => (s.document?.id === id ? s.document : null));
	return { ...query, data: draft ?? query.data };
}
/** The server renders every page: wait for a pause in typing (the letter autosave delay) before asking for one. */
export const RENDER_SETTLE_MS = 800;
export function useSettled<T>(value: T, ms = RENDER_SETTLE_MS): T {
	const [settled, setSettled] = useState(value);
	useEffect(() => {
		const timer = setTimeout(() => setSettled(value), ms);
		return () => clearTimeout(timer);
	}, [value, ms]);
	return settled;
}
export function useRenderedPage(live: PageRenderRequest | undefined) {
	const { scope } = useDataBackend();
	const request = useSettled(live);
	const draft = request?.data ?? request?.letter;
	const snapshot =
		request && draft ? { ...request, revision: `${request.revision}:${fnv1a(JSON.stringify(draft))}` } : request;
	return useQuery({
		queryKey: [scope, "document-page", snapshot],
		queryFn: () => {
			if (!snapshot) throw new Error("No document to render.");
			return pageRenderer.render(snapshot);
		},
		enabled: !!snapshot && !!scope,
		placeholderData: (previous, query) =>
			query?.queryKey[0] === scope && (query?.queryKey[2] as PageRenderRequest | undefined)?.id === snapshot?.id
				? previous
				: undefined,
	});
}
export function DocumentState({
	loading,
	error,
	retry,
	height = 156,
}: {
	loading: boolean;
	error: boolean;
	retry: () => void;
	height?: number;
}) {
	if (loading)
		return (
			<View style={{ margin: 24 }}>
				<Skeleton height={height} />
			</View>
		);
	if (error)
		return (
			<View accessibilityRole="alert" style={{ margin: 24, gap: 12 }}>
				<Text color="dangerText">{t`Couldn't load this document. Try again.`}</Text>
				<Button label={t`Try again`} onPress={retry} />
			</View>
		);
	return null;
}
