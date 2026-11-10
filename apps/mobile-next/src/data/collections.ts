import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { lintResumeForAts } from "@reactive-resume/resume/ats";
import { now, timeZone } from "./clock";
import { useApplications, useCareerOffers, useDataBackend, useDocuments, useNotifications } from "./provider";
import Storage from "@/data/storage";

export function useTrash() {
	const documents = useDocuments({ trashed: true });
	const { backend, scope, generation } = useDataBackend();
	const applications = useQuery({
		queryKey: [scope, "applicationTrash", generation],
		queryFn: ({ signal }) => backend.read("applicationTrash", {}, signal),
		enabled: !!scope,
	});
	return { documents, applications };
}
export function useSearch(query: string) {
	const documents = useDocuments({ q: query.slice(0, 500) });
	const applications = useApplications();
	return {
		documents,
		applications: {
			...applications,
			data: applications.data?.filter((row) =>
				`${row.company} ${row.role}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
			),
		},
	};
}
export function useToday() {
	const applications = useApplications();
	const notifications = useNotifications();
	const offers = useCareerOffers();
	const { backend, scope, generation } = useDataBackend();
	const opportunities = useQuery({
		queryKey: [scope, "opportunities", generation],
		queryFn: ({ signal }) => backend.read("opportunities", {}, signal),
		enabled: !!scope,
	});
	return { applications, notifications, offers, opportunities, now: now(), timeZone: timeZone() };
}
export function useATSCheck(data: ResumeData | undefined) {
	return useMemo(() => (data ? lintResumeForAts(data, { now: now() }) : undefined), [data]);
}
export type Settings = {
	theme: "system" | "light" | "dark";
	haptics: boolean;
	notificationCategories: Record<string, boolean>;
	lastTimeZone: string;
};
const defaults = (): Settings => ({
	theme: "system",
	haptics: true,
	notificationCategories: {},
	lastTimeZone: timeZone(),
});
export function useSettings() {
	const { scope } = useDataBackend();
	const query = useQuery({
		queryKey: [scope, "settings"],
		queryFn: () => ({ ...defaults(), ...JSON.parse(Storage.getItemSync(`settings:${scope}`) ?? "{}") }) as Settings,
	});
	return {
		...query,
		async save(changes: Partial<Settings>) {
			const next = { ...defaults(), ...query.data, ...changes };
			Storage.setItemSync(`settings:${scope}`, JSON.stringify(next));
			await query.refetch();
		},
	};
}

/** File checker is separate from builder lint; the server reads the PDF without storing it. */
export function usePDFATSCheck() {
	return useMutation({
		mutationFn: async ({
			uri,
			name,
			posting = "",
			signal,
		}: {
			uri: string;
			name: string;
			posting?: string;
			signal: AbortSignal;
		}) => {
			const { isFake } = await import("./fixtures");
			if (isFake()) {
				const { storyboardPdfCheck } = await import("./ats-fixture");
				return storyboardPdfCheck(name, posting);
			}
			const { runAtsCheck } = await import("./ats-check");
			return runAtsCheck(uri, name, posting, signal);
		},
	});
}
