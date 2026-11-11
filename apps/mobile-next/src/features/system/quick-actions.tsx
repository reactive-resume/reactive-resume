// X1 · app-icon quick actions (iOS Home Screen actions, Android app shortcuts): Save a job, New resume, Search.
// Mounted in the signed-in layout, so an action opens its screen over the tabs and Back works. (The package's own
// `expo-quick-actions/router` hook imports expo-router's internals, which pnpm doesn't link to it.)
import * as QuickActions from "expo-quick-actions";
import { type Href, useRouter } from "expo-router";
import { useEffect } from "react";
import { quickActions } from "./content";

const symbols = {
	"save-job": "symbol:briefcase",
	"new-resume": "symbol:doc.badge.plus",
	search: "symbol:magnifyingglass",
};

export function QuickActionRouting() {
	const router = useRouter();
	useEffect(() => {
		const actions = quickActions();
		void QuickActions.setItems(
			actions.map((action) => ({
				id: action.id,
				title: action.title,
				icon: symbols[action.id as keyof typeof symbols],
				params: { href: action.href },
			})),
		);
		const open = (action: QuickActions.Action | null) => {
			const href = action?.params?.href;
			if (typeof href === "string" && actions.some((action) => action.href === href))
				setTimeout(() => router.push(href as Href));
		};
		open(QuickActions.initial ?? null);
		const subscription = QuickActions.addListener(open);
		return () => subscription.remove();
	}, [router]);
	return null;
}
