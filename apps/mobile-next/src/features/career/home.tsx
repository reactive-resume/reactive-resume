import { t } from "@lingui/core/macro";
import { useRouter } from "expo-router";
import {
	screenTexts,
	useAIProviders,
	useCareerFacts,
	useCareerStories,
	useCareerOffers,
	useCareerPreferences,
	useCareerSchedules,
	useDataBackend,
} from "@/data";
import { AvatarButton, Button, HeroCard, ListRow, SectionHeading, TabScreen } from "@/ui";

export function CareerScreen() {
	const router = useRouter();
	const providers = useAIProviders();
	const facts = useCareerFacts({ all: true });
	const stories = useCareerStories();
	const offers = useCareerOffers();
	const profile = useCareerPreferences();
	const schedules = useCareerSchedules();
	const { backend } = useDataBackend();
	const fake = backend.kind === "fake";
	const copy = screenTexts("C1-Career");
	const connected = providers.data?.some((p) => p.enabled);
	const go = (href: string) => router.push(href);
	return (
		<TabScreen
			title={t`Career`}
			subtitle={t`Your coach, and what it knows about you.`}
			avatar={<AvatarButton initials={fake ? "AM" : ""} onPress={() => go("/settings")} />}
			onRefresh={() => {
				void Promise.all([
					facts.refetch(),
					stories.refetch(),
					offers.refetch(),
					profile.refetch(),
					schedules.refetch(),
					providers.refetch(),
				]);
			}}
		>
			<HeroCard
				keyLine={t`Coach`}
				keyIcon="sparkle"
				title={connected ? t`What should we work on?` : t`Connect an AI provider to use the coach`}
				body={t`Ask about offers, interviews or where to look next. It only uses what you've shared below.`}
			>
				<Button
					label={connected ? t`Start a conversation` : t`Connect`}
					tone="primary"
					size="lg"
					block
					onPress={() => go(connected ? "/career/coach" : "/settings/ai")}
				/>
			</HeroCard>
			<SectionHeading title={t`What it knows`} />
			<ListRow
				title={t`Facts`}
				secondary={fake ? copy[9] : t`${facts.data?.length ?? 0} facts about your work`}
				trailing="caret"
				onPress={() => go("/career/knowledge/facts")}
			/>
			<ListRow
				title={t`Stories`}
				secondary={fake ? copy[11] : t`${stories.data?.length ?? 0} stories for interviews`}
				trailing="caret"
				onPress={() => go("/career/knowledge/stories")}
			/>
			<ListRow
				title={t`Job search`}
				secondary={
					fake
						? copy[13]
						: [profile.data?.targetRoles.join(", "), profile.data?.locations.join(" · ")].filter(Boolean).join(" · ")
				}
				trailing="caret"
				last
				onPress={() => go("/career/knowledge/preferences")}
			/>
			<SectionHeading title={t`Decide`} />
			<ListRow
				title={t`Compare offers`}
				secondary={fake ? copy[16] : t`${offers.data?.length ?? 0} offers`}
				last
				trailing="caret"
				onPress={() => go("/career/offers")}
			/>
			<SectionHeading title={t`Routines`} />
			<ListRow
				title={t`Discovery`}
				secondary={fake ? copy[19] : t`${schedules.data?.length ?? 0} schedules`}
				last
				trailing="caret"
				onPress={() => go(`/career/schedules/${schedules.data?.find((s) => s.kind === "discovery")?.id ?? "new"}`)}
			/>
		</TabScreen>
	);
}
