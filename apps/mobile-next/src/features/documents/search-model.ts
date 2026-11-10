export function searchGroup<T>(items: readonly T[], expanded: boolean) {
	return { visible: expanded ? items : items.slice(0, 3), remaining: expanded ? 0 : Math.max(0, items.length - 3) };
}
