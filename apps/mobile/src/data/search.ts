import { t } from "@lingui/core/macro";
import { useQuery } from "@tanstack/react-query";
import { useDataBackend } from "./provider";
import Storage from "./storage";
export type SearchCommand = { id: string; label: string; href: string };
export function matching<T>(query: string, values: readonly T[], text: (value: T) => string): T[] {
	const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
	if (!words.length) return [];
	return values.filter((value) => words.every((word) => text(value).toLocaleLowerCase().includes(word)));
}
export function updateRecentSearches(previous: readonly string[], query: string) {
	const value = query.trim().slice(0, 500);
	return value
		? [value, ...previous.filter((item) => item.toLocaleLowerCase() !== value.toLocaleLowerCase())].slice(0, 20)
		: [...previous];
}
export function useRecentSearches() {
	const { scope } = useDataBackend();
	const key = `searches:${scope}`;
	const query = useQuery<string[]>({
		queryKey: [scope, "recent-searches"],
		queryFn: () => JSON.parse(Storage.getItemSync(key) ?? "[]") as string[],
		enabled: !!scope,
	});
	const save = async (values: string[]) => {
		if (!scope) throw new Error(t`Sign in again.`);
		Storage.setItemSync(key, JSON.stringify(values));
		await query.refetch();
	};
	return {
		...query,
		add: (value: string) => save(updateRecentSearches(query.data ?? [], value)),
		remove: (value: string) => save((query.data ?? []).filter((item) => item !== value)),
		clear: () => save([]),
	};
}
