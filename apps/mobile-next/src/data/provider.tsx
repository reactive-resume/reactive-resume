import { QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type PropsWithChildren } from "react";
import { generateId } from "@reactive-resume/utils/string";
import { fakeBackend, fixtureGeneration, isFake, subscribeFixture, seed, selectRealData } from "./fixtures";
import { guestBackend } from "./guest";
import { createAccountQueryClient } from "./query-client";
import { writeQueue, writableOperations, type QueueKind, type QueuedWrite } from "./queue";
import {
	realBackend,
	type Backend,
	type MutationInputs,
	type Resource,
	type ResourceInput,
	type ResourceOutput,
} from "./resources";
import { watchQueue, syncQueued } from "./sync";
import { assertStageGate } from "./write-policy";
import { getAccountScope, useSession } from "@/auth/session";

type DataContext = { backend: Backend; scope: string | null; generation: number };
const Context = createContext<DataContext | null>(null);
export type DataProviderProps = PropsWithChildren<{ backend?: "real" | "fake" }>;
export function DataProvider({ children, backend }: DataProviderProps) {
	const session = useSession();
	const generation = useSyncExternalStore(subscribeFixture, fixtureGeneration);
	const switching = (backend === "fake" && !isFake()) || (backend === "real" && isFake());
	useEffect(() => {
		if (backend === "fake" && !isFake()) seed("storyboard");
		else if (backend === "real" && isFake()) selectRealData();
	}, [backend]);
	const selected =
		session.status === "guest"
			? guestBackend
			: backend === "fake" || (!backend && isFake())
				? fakeBackend
				: realBackend;
	const scope = selected.kind === "fake" ? "storyboard" : getAccountScope();
	const owner = useMemo(() => createAccountQueryClient(scope ?? "signed-out"), [scope]);
	useEffect(() => () => owner.dispose(), [owner]);
	useEffect(
		() =>
			scope && selected.kind === "real" && session.status === "signed-in"
				? watchQueue(scope, selected, () => {
						void owner.queryClient.invalidateQueries();
					})
				: undefined,
		[scope, selected, owner, session.status],
	);
	const value = useMemo(() => ({ backend: selected, scope, generation }), [selected, scope, generation]);
	return switching ? null : (
		<Context.Provider value={value}>
			<QueryClientProvider client={owner.queryClient}>{children}</QueryClientProvider>
		</Context.Provider>
	);
}
export function useDataBackend() {
	const value = useContext(Context);
	if (!value) throw new Error("Mount DataProvider before resource hooks.");
	return value;
}
export function useResource<K extends Resource>(resource: K, input: ResourceInput<K>, enabled = true) {
	const { backend, scope, generation } = useDataBackend();
	return useQuery<ResourceOutput<K>>({
		queryKey: [scope, resource, input, backend.kind === "fake" ? generation : 0],
		queryFn: ({ signal }) => backend.read(resource, input, signal),
		enabled: enabled && (scope !== null || resource === "publicResume"),
		meta: { persist: scope !== null && backend.kind === "real" },
	});
}
export const useDocuments = (input: ResourceInput<"documents"> = {}) => useResource("documents", input);
export const useResume = (id: string) => useResource("resume", { id }, !!id);
export const useLetter = (id: string) => useResource("letter", { id }, !!id);
export const useApplications = (input: ResourceInput<"applications"> = {}) => useResource("applications", input);
export const useApplication = (id: string) => useResource("application", { id }, !!id);
export const useApplicationWorkspace = (applicationId: string) =>
	useResource("workspace", { applicationId }, !!applicationId);
export const useCareerFacts = (input: ResourceInput<"facts"> = {}) => useResource("facts", input);
export const useCareerStories = (input: ResourceInput<"stories"> = {}) => useResource("stories", input);
export const useCareerPreferences = () => useResource("preferences", {});
export const useCareerOffers = (input: ResourceInput<"offers"> = { kind: "offer" }) => useResource("offers", input);
export const useCareerSchedules = () => useResource("schedules", {});
export const useAccount = () => useResource("account", {});
export const useProfile = () => useResource("profile", {});
export const useAIProviders = () => useResource("aiProviders", {});
export const useNotifications = () => useResource("notifications", {});
export const usePublicResume = (input: ResourceInput<"publicResume">) => useResource("publicResume", input);
export const useResumeVersions = (id: string) => useResource("versions", { resumeId: id }, !!id);
export const useLetterVersions = (id: string) => useResource("letterVersions", { id }, !!id);
export function useQueuedWrites() {
	const { scope } = useDataBackend();
	const raw = useSyncExternalStore(writeQueue.subscribe, () =>
		scope
			? JSON.stringify({ rows: writeQueue.list(scope), saving: writeQueue.isSaving(scope) })
			: '{"rows":[],"saving":false}',
	);
	return useMemo(
		() =>
			scope
				? {
						...(JSON.parse(raw) as { rows: QueuedWrite[]; saving: boolean }),
						counts: writeQueue.count(scope),
						saving: writeQueue.isSaving(scope),
					}
				: { rows: [], counts: null, saving: false },
		[scope, raw],
	);
}
export function useDataActions() {
	const { backend, scope } = useDataBackend();
	const queryClient = useQueryClient();
	const flush = async () => {
		if (!scope) throw new Error("Sign in again.");
		await syncQueued(scope, backend);
		await queryClient.invalidateQueries();
	};
	return {
		async write<K extends keyof MutationInputs>(kind: QueueKind, operation: K, input: MutationInputs[K]) {
			if (!scope || (backend.kind !== "fake" && getAccountScope() !== scope)) throw new Error("Sign in again.");
			assertStageGate(operation, input);
			if (!(writableOperations as readonly string[]).includes(operation))
				throw new Error("This action requires an online request.");
			if (backend.kind !== "guest") writeQueue.enqueue(scope, { id: generateId(), kind, operation, input });
			if (backend.kind === "guest") {
				await backend.write(operation, input, scope);
				await queryClient.invalidateQueries();
				return;
			}
			await flush();
		},
		flush,
	};
}
