import { t } from "@lingui/core/macro";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useEffect } from "react";
import { View } from "react-native";
import { documentHref, type Document } from "./model";
import { getAccountScope } from "@/auth/session";
import { moveToTrash, restore, useAccount, useDataBackend } from "@/data";
import { pageRenderer, type PageRenderResult } from "@/render/page-renderer";
import { AvatarButton, Button, HeroSource, DocThumb, Page, prepareHero, showToast, haptic, Skeleton, Text } from "@/ui";

export function AccountAvatar() {
	const account = useAccount();
	const router = useRouter();
	const initials = (account.data?.name ?? "")
		.split(/\s+/)
		.map((part) => part[0])
		.slice(0, 2)
		.join("");
	return <AvatarButton initials={initials} label={t`Settings`} onPress={() => router.push("/settings")} />;
}

type DocumentThumbnailProps = { document: Document };
export function DocumentThumbnail({ document }: DocumentThumbnailProps) {
	const cache = useQueryClient();
	const { scope } = useDataBackend();
	const revision = document.updatedAt.toISOString();
	useEffect(() => {
		if (document.type !== "resume") return;
		void cache.prefetchQuery({
			queryKey: [scope, "documentHero", document.id, revision],
			queryFn: () => pageRenderer.render({ kind: "resume", id: document.id, revision, fixture: "page-resume-B1" }),
		});
	}, [cache, scope, document.id, document.type, revision]);
	return (
		<HeroSource id={`page-${document.id}`}>
			<DocThumb letter={document.type === "letter"} />
		</HeroSource>
	);
}

export function useOpenDocument() {
	const router = useRouter();
	const cache = useQueryClient();
	const { scope } = useDataBackend();
	return async (document: Document) => {
		if (getAccountScope() !== scope) return;
		const render = cache.getQueryData<PageRenderResult>([
			scope,
			"documentHero",
			document.id,
			document.updatedAt.toISOString(),
		]);
		const page = render?.pages[0];
		if (document.type === "resume" && page && !render?.stale)
			await prepareHero(`page-${document.id}`, ({ width, height }) => (
				<Page source={{ uri: page.uri }} width={width} height={height} shadow={false} />
			));
		if (getAccountScope() !== scope) return;
		router.push(documentHref(document));
	};
}

export function useTrashDocument() {
	const cache = useQueryClient();
	const { scope } = useDataBackend();
	return async (document: Document, swipe = false): Promise<boolean> => {
		if (!scope || getAccountScope() !== scope) return false;
		const ref = { type: document.type, id: document.id };
		try {
			await moveToTrash(ref);
			if (getAccountScope() !== scope) return false;
			if (!swipe) haptic("light");
			await cache.invalidateQueries();
			showToast({
				message: t`“${document.name}” moved to Trash`,
				action: {
					label: t`Undo`,
					onPress: () => {
						if (getAccountScope() !== scope) return;
						void restore(ref)
							.then(() => cache.invalidateQueries())
							.catch(() => showToast({ message: t`Couldn't restore the document. Try again.` }));
					},
				},
			});
			return true;
		} catch {
			if (getAccountScope() !== scope) return false;
			haptic("error");
			showToast({ message: t`Couldn't move the document to Trash. Try again.` });
			return false;
		}
	};
}

type DocumentPlaceholdersProps = { count?: number };
export function DocumentPlaceholders({ count = 3 }: DocumentPlaceholdersProps) {
	return (
		<View style={{ paddingHorizontal: 24 }}>
			{Array.from({ length: count }, (_, index) => (
				<View key={index} style={{ height: 75, flexDirection: "row", gap: 16, alignItems: "center" }}>
					<Skeleton width={36} height={50} />
					<View style={{ flex: 1, gap: 2 }}>
						<Skeleton height={24} />
						<Skeleton height={20} />
					</View>
				</View>
			))}
		</View>
	);
}

type CollectionStateProps = {
	message: string;
	action?: string | undefined;
	onPress?: (() => void) | undefined;
};
export function CollectionState({ message, action, onPress }: CollectionStateProps) {
	return (
		<View style={{ margin: 24, gap: 20 }} accessibilityLiveRegion="polite">
			<Text variant="body" color="ink3">
				{message}
			</Text>
			{action ? <Button label={action} onPress={onPress} /> : null}
		</View>
	);
}
