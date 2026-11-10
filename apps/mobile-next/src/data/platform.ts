import type { ResourceInput } from "./resources";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { computeOutcomes } from "@reactive-resume/schema/applications/outcomes";
import { selectOfferPair } from "@reactive-resume/schema/career-offer";
import { usePlatformActions } from "./actions";
import { moneyDifference } from "./offer-compare";
import { useResource, useResume, useAccount, useDataBackend, useDocuments, useApplications } from "./provider";
import { getServer } from "@/auth/session";
import { pageRenderer } from "@/render/page-renderer";

export const useDocumentPage = (input: ResourceInput<"documentPage"> = {}) => useResource("documentPage", input);
export const useConversations = () => useResource("conversations", {});
export const useConversation = (id: string) => useResource("conversation", { id }, !!id);
export const useForgottenFacts = () => useResource("forgottenFacts", {});
export const useCareerLibrary = (input: ResourceInput<"library"> = {}) => useResource("library", input);
export const useTranscripts = (applicationId: string | null = null) => useResource("transcripts", { applicationId });
export const useAPIKeys = () => useResource("apiKeys", {});
export const useConnectedApps = () => useResource("connectedApps", {});
export const useCustomDomain = () => useResource("customDomain", {});
export const useFeedbackLinks = (resumeId: string) => useResource("feedbackLinks", { resumeId }, !!resumeId);
export const useFeedbackLink = (id: string) => useResource("feedbackLink", { id }, !!id);
export const useVisitorStatistics = (id: string, days = 30) => ({
	totals: useResource("visitorStatistics", { id }, !!id),
	daily: useResource("dailyVisitors", { id, days }, !!id),
});
export const useResumeVersion = (resumeId: string, versionId: string) =>
	useResource("resumeVersion", { resumeId, versionId }, !!resumeId && !!versionId);
export const useLetterVersion = (id: string, versionId: string) =>
	useResource("letterVersion", { id, versionId }, !!id && !!versionId);
export function useVersionPreview(resumeId: string, versionId: string) {
	const version = useResumeVersion(resumeId, versionId);
	const { scope, generation } = useDataBackend();
	const preview = useQuery({
		queryKey: [scope, "version-preview", resumeId, versionId, generation],
		queryFn: () => {
			if (!version.data) throw new Error("Version unavailable.");
			return pageRenderer.render({
				kind: "resume",
				id: resumeId,
				revision: versionId,
				snapshot: true,
				data: version.data.data,
			});
		},
		enabled: !!version.data,
	});
	return { version, preview };
}
export function useSharing(id: string) {
	const resume = useResume(id);
	const account = useAccount();
	const domain = useCustomDomain();
	const actions = usePlatformActions();
	const address =
		resume.data && account.data
			? `${getServer()}/${encodeURIComponent(account.data.username)}/${encodeURIComponent(resume.data.slug)}`
			: undefined;
	return {
		resume,
		account,
		domain,
		address,
		qrTarget: resume.data?.isPublic ? address : undefined,
		publish: () => actions.run("resume.update", { id, isPublic: true, expectedUpdatedAt: resume.data?.updatedAt }),
		update: (
			input: Omit<ResourceInput<"resume">, "id"> &
				Partial<
					Pick<
						NonNullable<typeof resume.data>,
						| "slug"
						| "isPublic"
						| "isPrimary"
						| "showDownloadButtons"
						| "allowWordDownload"
						| "showInSearchEngines"
						| "hideContactDetails"
					>
				>,
		) => actions.run("resume.update", { ...input, id, expectedUpdatedAt: resume.data?.updatedAt }),
		setPassword: (password: string) => actions.run("resume.setPassword", { id, password }),
		removePassword: () => actions.run("resume.removePassword", { id }),
	};
}
export function useApplicationInsights() {
	const applications = useApplications();
	const stats = useResource("applicationStats", {});
	const model = useMemo(() => {
		const rows = applications.data ?? [];
		const outcome = computeOutcomes(rows, () => false);
		return {
			...outcome,
			total: rows.length,
			repliedPercent: outcome.sent ? Math.round((outcome.heardBack / outcome.sent) * 100) : 0,
		};
	}, [applications.data]);
	return { applications, stats, model };
}
export function useDocumentListModel(input: ResourceInput<"documents"> = {}) {
	const query = useDocuments(input);
	return {
		...query,
		data: query.data?.map((row) => ({
			...row,
			editedDate: row.editedAt,
			publicState: row.isPublic
				? row.hasPassword
					? ("password" as const)
					: ("public" as const)
				: ("private" as const),
			linkedJobLabel: row.application ? `${row.application.company} · ${row.application.role}` : null,
		})),
	};
}

export function useOfferComparison(requested: { a?: string; b?: string } = {}) {
	const offers = useResource("offers", { kind: "offer" });
	const preferences = useResource("preferences", {});
	const pair = useMemo(() => {
		const values = (offers.data ?? []).filter((item) => item.data.kind === "offer");
		const selected = selectOfferPair(values, requested);
		return { a: values.find((item) => item.id === selected.a), b: values.find((item) => item.id === selected.b) };
	}, [offers.data, requested]);
	const a = pair.a?.data;
	const b = pair.b?.data;
	return {
		offers,
		preferences,
		...pair,
		priorities: preferences.data?.priorities,
		baseDifference: a?.kind === "offer" && b?.kind === "offer" ? moneyDifference(a, b, "base") : null,
	};
}
