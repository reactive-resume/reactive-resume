import { useLingui } from "@lingui/react/macro";
import { useLocalSearchParams, useRouter } from "expo-router";
import { applicationOrigin } from "@/features/applications/origin";
import { useApplication } from "@/features/applications/queries";
import { routes } from "@/routes";

/**
 * Where Back goes when an editor was opened from an application. The id is only trusted after loading that application
 * and confirming it owns this document; a stale or foreign id falls back to Documents.
 */
export function useEditorApplicationOrigin(kind: "resume" | "letter", documentId: string) {
	const { t } = useLingui();
	const router = useRouter();
	const { applicationId } = useLocalSearchParams<{ applicationId?: string }>();
	const detail = useApplication(applicationId ?? "");
	const application = detail.data;
	const origin = applicationOrigin(kind, documentId, application);
	if (!application || !origin) return undefined;
	return {
		label: t`Back to ${application.company}`,
		onBack: () => router.replace(routes.applicationDetails(origin.id)),
	};
}
