import type { RouterOutput } from "@/api/client";
import { useLingui } from "@lingui/react/macro";
import { ORPCError } from "@orpc/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { withUndo } from "./undo";
import { client, orpc } from "@/api/client";
import { getServer, useSession } from "@/auth/session";
import { useProfile } from "@/features/settings/queries";
import { showToast } from "@/ui";

export type Career = RouterOutput["career"];
export type Fact = Career["facts"][number];
export type Story = Career["stories"][number];
export type Schedule = Career["schedules"][number];
export type SavedItem = Career["savedItems"][number];

export function useCareerQueries() {
	const session = useSession();
	const options = { enabled: session.status === "signed-in", retry: false };
	const facts = useQuery({
		...orpc.career.facts.queryOptions({ input: { applicationId: null, all: true } }),
		...options,
		queryKey: [...orpc.career.facts.key(), session.server, "all"],
	});
	const stories = useQuery({
		...orpc.career.stories.queryOptions({ input: { applicationId: null } }),
		...options,
		queryKey: [...orpc.career.stories.key(), session.server, "shared"],
	});
	const profile = useQuery({
		...orpc.career.profile.queryOptions(),
		...options,
		queryKey: [...orpc.career.profile.key(), session.server],
	});
	return { facts, stories, profile };
}

export function useTodayQueries() {
	const session = useSession();
	const options = { enabled: session.status === "signed-in", retry: false };
	const notifications = useQuery({
		...orpc.career.notifications.queryOptions({ input: {} }),
		...options,
		queryKey: [...orpc.career.notifications.key(), session.server],
	});
	const opportunities = useQuery({
		...orpc.career.opportunities.queryOptions({ input: {} }),
		...options,
		queryKey: [...orpc.career.opportunities.key(), session.server],
	});
	const schedules = useQuery({
		...orpc.career.schedules.queryOptions({ input: {} }),
		...options,
		queryKey: [...orpc.career.schedules.key(), session.server],
	});
	const briefings = useQuery({
		...orpc.career.savedItems.queryOptions({ input: { kind: "briefing" } }),
		...options,
		queryKey: [...orpc.career.savedItems.key(), session.server, "briefing"],
	});
	return { notifications, opportunities, schedules, briefings };
}

export function useOffers() {
	const session = useSession();
	return useQuery({
		...orpc.career.savedItems.queryOptions({ input: { kind: "offer" } }),
		enabled: session.status === "signed-in",
		retry: false,
		queryKey: [...orpc.career.savedItems.key(), session.server, "offer"],
	});
}

export function useCareerTime() {
	const profile = useProfile();
	const { i18n } = useLingui();
	const timeZone = profile.data?.timezone ?? "UTC";
	return {
		profile,
		timeZone,
		locale: i18n.locale,
		when: (value: Date | string) =>
			new Intl.DateTimeFormat(i18n.locale, { timeZone, dateStyle: "medium", timeStyle: "short" }).format(
				new Date(value),
			),
	};
}

export function useNow() {
	const [now, setNow] = useState(() => new Date());
	useEffect(() => {
		const timer = setInterval(() => setNow(new Date()), 60_000);
		const subscription = AppState.addEventListener("change", (state) => {
			if (state === "active") setNow(new Date());
		});
		return () => {
			clearInterval(timer);
			subscription.remove();
		};
	}, []);
	return now;
}

export function useCareerAction() {
	const { t } = useLingui();
	const queryClient = useQueryClient();
	const session = useSession();
	const [pending, setPending] = useState(false);
	const busy = useRef(false);
	const [error, setError] = useState<string>();
	const refresh = () =>
		Promise.all([
			queryClient.invalidateQueries({ queryKey: orpc.career.key() }),
			queryClient.invalidateQueries({ queryKey: orpc.applications.key() }),
			queryClient.invalidateQueries({ queryKey: orpc.documents.key() }),
		]);
	const run = async <T>(operation: () => Promise<T>, success?: (result: T) => void) => {
		if (busy.current || session.status !== "signed-in" || getServer() !== session.server) return;
		busy.current = true;
		setPending(true);
		setError(undefined);
		const server = session.server;
		try {
			const result = await operation();
			if (getServer() === server) success?.(result);
		} catch (error) {
			// This server's own reason (a change made elsewhere, a limit) says more than a generic retry.
			if (getServer() === server)
				setError(
					error instanceof ORPCError && error.message
						? error.message
						: t`Couldn't save that change. Check your connection and try again.`,
				);
		} finally {
			busy.current = false;
			setPending(false);
			void refresh();
		}
	};
	return { run, pending, error, refresh };
}

export function useUndoRows() {
	const { t } = useLingui();
	const session = useSession();
	const [hidden, setHidden] = useState<string[]>([]);
	const pending = useRef(new Map<string, ReturnType<typeof withUndo>>());
	const active = useRef(session);
	useLayoutEffect(() => {
		active.current = session;
	});
	const action = useCareerAction();
	useEffect(() => {
		const operations = pending.current;
		return () => {
			for (const operation of operations.values()) {
				if (active.current.status === "signed-in") operation.flush();
				else operation.cancel();
			}
			operations.clear();
		};
	}, [session.server]);
	const remove = (id: string, message: string, commit: () => Promise<unknown>) => {
		if (pending.current.has(id)) return;
		const server = session.server;
		setHidden((rows) => [...rows, id]);
		const restore = () => {
			setHidden((rows) => rows.filter((value) => value !== id));
			pending.current.delete(id);
		};
		const operation = withUndo({
			message,
			restore,
			failed: () => showToast({ message: t`Couldn't save that change. The item is restored; try again.` }),
			commit: async () => {
				try {
					if (getServer() === server && active.current.status === "signed-in") await commit();
					else restore();
				} finally {
					void action.refresh();
					pending.current.delete(id);
				}
			},
		});
		pending.current.set(id, operation);
	};
	return { hidden, remove };
}

export { client };
