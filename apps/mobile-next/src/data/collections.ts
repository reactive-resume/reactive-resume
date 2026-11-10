import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { lintResumeForAts } from "@reactive-resume/resume/ats";
import { isStepComplete } from "./application-tools";
import { now, timeZone } from "./clock";
import { useConnectivity } from "./connectivity";
import { useLocalValue } from "./local-state";
import { useConversations, useCareerLibrary } from "./platform";
import { useApplications, useCareerOffers, useDataBackend, useDocuments, useNotifications } from "./provider";
import { assertDataScope } from "./scope";
import { matching, useRecentSearches, type SearchCommand } from "./search";
import { useFirstRun, rankToday, useNotificationCompletion } from "./today";
import { allApplicationTrash, loadTrashSnapshot } from "./trash";
import Storage from "@/data/storage";

export function useTrash() {
	const documents = useDocuments({ trashed: true });
	const { backend, scope, generation } = useDataBackend();
	const applications = useQuery({
		queryKey: [scope, "applicationTrash", generation],
		queryFn: async ({ signal }) => {
			const items = await allApplicationTrash((input) => backend.read("applicationTrash", input, signal));
			return { items, total: items.length };
		},
		enabled: !!scope,
	});
	const snapshot = useQuery({
		queryKey: [scope, "trash-snapshot", generation],
		queryFn: ({ signal }) => loadTrashSnapshot(backend, signal),
		enabled: !!scope,
	});
	return { documents, applications, snapshot };
}
export function useSearch(query: string, commands: readonly SearchCommand[] = []) {
	const documents = useDocuments({ q: query.slice(0, 500) });
	const applications = useApplications();
	const conversations = useConversations();
	const notes = useCareerLibrary();
	const recent = useRecentSearches();
	return {
		conversations: {
			...conversations,
			data: matching(query, conversations.data ?? [], (row) => `${row.title} ${row.firstMessage ?? ""}`),
		},
		notes: {
			...notes,
			data: matching(
				query,
				notes.data ?? [],
				(row) => `${row.title} ${row.application?.company ?? ""} ${row.application?.role ?? ""}`,
			),
		},
		applicationNotes: matching(
			query,
			applications.data ?? [],
			(row) =>
				`${row.notes ?? ""} ${row.activity
					.filter((entry) => entry.type === "note")
					.map((entry) => entry.text)
					.join(" ")}`,
		),
		commands: matching(query, commands, (command) => command.label),
		recent,
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
	const connectivity = useConnectivity();
	const firstRun = useFirstRun();
	const completion = useNotificationCompletion();
	useLocalValue("step-revision", 0);
	const model = {
		...rankToday(
			applications.data ?? [],
			offers.data ?? [],
			now(),
			timeZone(),
			(applicationId, kind) => !!scope && isStepComplete({ applicationId, kind }, scope),
		),
		newRoles: opportunities.data ?? [],
		notifications: (notifications.data ?? []).filter(
			(notice) => completion.data?.[notice.id] === "undone" || (!notice.readAt && !completion.data?.[notice.id]),
		),
	};
	return {
		applications,
		notifications,
		offers,
		opportunities,
		now: now(),
		timeZone: timeZone(),
		model,
		connectivity,
		firstRun: {
			...firstRun,
			data:
				firstRun.data === undefined || !applications.data || !notifications.data
					? undefined
					: firstRun.data && applications.data.length === 0 && notifications.data.length === 0,
		},
		completion,
	};
}
export function useATSCheck(data: ResumeData | undefined) {
	return useMemo(() => (data ? lintResumeForAts(data, { now: now() }) : undefined), [data]);
}
export type Settings = {
	theme: "system" | "light" | "dark";
	haptics: boolean;
	notificationCategories: Record<string, boolean>;
	lastTimeZone: string;
	automaticTimeZone: boolean;
	homeTimeZone: string;
	lastNotifiedTimeZone: string | null;
	applicationView: "list" | "board" | "calendar";
};
const defaults = (): Settings => ({
	theme: "system",
	haptics: true,
	notificationCategories: {},
	lastTimeZone: timeZone(),
	automaticTimeZone: true,
	homeTimeZone: timeZone(),
	lastNotifiedTimeZone: null,
	applicationView: "list",
});
export function useSettings() {
	const { scope } = useDataBackend();
	const query = useQuery({
		queryKey: [scope, "settings"],
		enabled: !!scope,
		queryFn: () => {
			const saved = JSON.parse(Storage.getItemSync(`settings:${scope}`) ?? "{}") as Partial<Settings>;
			const value = { ...defaults(), ...saved, homeTimeZone: saved.homeTimeZone ?? saved.lastTimeZone ?? timeZone() };
			Storage.setItemSync(`settings:${scope}`, JSON.stringify(value));
			return value;
		},
	});
	return {
		...query,
		async save(changes: Partial<Settings>) {
			if (!scope) throw new Error("Sign in again.");
			assertDataScope(scope);
			const next = {
				...defaults(),
				...query.data,
				...JSON.parse(Storage.getItemSync(`settings:${scope}`) ?? "{}"),
				...changes,
			};
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
