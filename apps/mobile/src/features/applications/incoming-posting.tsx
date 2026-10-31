import type { PostingCapture } from "@reactive-resume/schema/applications/capture";
import { useLingui } from "@lingui/react/macro";
import { requireOptionalNativeModule } from "expo";
import { clearSharedPayloads, getSharedPayloads } from "expo-sharing";
import { useEffect, useState } from "react";
import { AppState, Linking, Platform } from "react-native";
import { captureSharedPosting } from "@reactive-resume/schema/applications/capture";
import { AddApplicationSheet } from "./add-sheet";
import { getAccountScope, getSession, subscribeIdentity, subscribeSession, useSession } from "@/auth/session";
import { showToast } from "@/ui";

const sharing = requireOptionalNativeModule<{
	setIncomingShareScope?: (scope: string | null, server: string | null) => void;
}>("ExpoSharing");

/** Raw share data only: Expo's resolving hook would fetch shared URLs before the user's review. */
export function IncomingPosting() {
	const session = useSession();
	const { t } = useLingui();
	const [capture, setCapture] = useState<{ scope: string | null; posting: PostingCapture } | null>(null);
	useEffect(
		() =>
			subscribeIdentity(() => {
				setCapture(null);
				try {
					sharing?.setIncomingShareScope?.(null, null);
					clearSharedPayloads();
				} catch {
					/* Older binaries have no receiving app group. */
				}
			}),
		[],
	);
	useEffect(() => {
		const syncScope = () => {
			const current = getSession();
			// Keep pending iOS text through cold-start token hydration; native scope comparison follows it.
			if (current.status !== "loading") sharing?.setIncomingShareScope?.(getAccountScope(), current.server);
		};
		const receive = (requested = false) => {
			try {
				syncScope();
				if (capture || getSession().status !== "signed-in") return;
				const payloads = getSharedPayloads();
				if (!payloads.length) return;
				let posting: PostingCapture | null;
				try {
					posting = captureSharedPosting(payloads);
				} finally {
					if (Platform.OS !== "ios" || !sharing?.setIncomingShareScope) clearSharedPayloads();
				}
				if (posting) setCapture({ scope: getAccountScope(), posting });
				else
					showToast({
						message: t`Share one posting URL or selected text. Files, multiple postings and unsupported URL parameters need explicit URL or pasted-text import in Applications.`,
					});
			} catch {
				if (requested)
					showToast({ message: t`Sharing could not be read. Update the app or paste the posting in Applications.` });
			}
		};
		receive();
		const unsubscribe = subscribeSession(receive);
		const active = AppState.addEventListener("change", (state) => {
			if (state === "active") receive();
		});
		const links = Linking.addEventListener("url", ({ url }) => {
			if (url.includes("expo-sharing")) receive(true);
		});
		return () => {
			unsubscribe();
			active.remove();
			links.remove();
		};
	}, [capture, session.status, session.server, t]);
	return capture && session.status === "signed-in" && capture.scope === getAccountScope() ? (
		<AddApplicationSheet initialCapture={capture.posting} onClose={() => setCapture(null)} />
	) : null;
}
