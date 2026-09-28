import type {
	CustomSectionItem,
	CustomSectionType,
	SectionItem as SectionItemType,
	SectionType,
} from "@reactive-resume/schema/resume/data";
import type { ReactNode } from "react";
import { plural } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { AnimatePresence, Reorder } from "motion/react";
import { cn } from "@reactive-resume/utils/style";
import { useCurrentBuilderResumeSelector, useUpdateResumeData } from "@/features/resume/builder/draft";
import { SectionBase } from "./section-base";
import { SectionAddItemButton, SectionItem } from "./section-item";

type SectionItemListProps<T extends CustomSectionItem | SectionItemType> = {
	type: CustomSectionType;
	items: T[];
	onReorder: (items: T[]) => void;
	getTitle: (item: T) => string;
	getSubtitle?: (item: T) => string | undefined;
	customSectionId?: string;
};

export function SectionItemList<T extends CustomSectionItem | SectionItemType>({
	type,
	items,
	onReorder,
	getTitle,
	getSubtitle,
	customSectionId,
}: SectionItemListProps<T>) {
	return (
		// popLayout pops exiting rows out of flow, so the group must be the positioned ancestor.
		<Reorder.Group axis="y" values={items} onReorder={onReorder} className="relative">
			<AnimatePresence initial={false} mode="popLayout">
				{items.map((item) => (
					<SectionItem
						key={item.id}
						type={type}
						item={item}
						customSectionId={customSectionId}
						title={getTitle(item)}
						subtitle={getSubtitle?.(item)}
					/>
				))}
			</AnimatePresence>
		</Reorder.Group>
	);
}

type ItemsSectionConfig<T extends SectionType> = {
	title: (item: SectionItemType<T>) => string;
	subtitle?: (item: SectionItemType<T>) => string | undefined;
	addLabel: ReactNode;
};

export const SECTIONS: { [T in SectionType]: ItemsSectionConfig<T> } = {
	profiles: {
		title: (item) => item.network,
		subtitle: (item) => item.username,
		addLabel: <Trans>Add a new profile</Trans>,
	},
	experience: {
		title: (item) => item.company,
		subtitle: (item) => item.position || plural(item.roles.length, { one: "# role", other: "# roles" }),
		addLabel: <Trans>Add a new experience</Trans>,
	},
	education: {
		title: (item) => item.school,
		subtitle: (item) => item.degree,
		addLabel: <Trans>Add a new education</Trans>,
	},
	projects: {
		title: (item) => item.name,
		subtitle: (item) => [item.period, item.website.label].filter((part) => part?.trim()).join(" • ") || undefined,
		addLabel: <Trans>Add a new project</Trans>,
	},
	skills: {
		title: (item) => item.name,
		subtitle: (item) => item.proficiency,
		addLabel: <Trans>Add a new skill</Trans>,
	},
	languages: {
		title: (item) => item.language,
		subtitle: (item) => item.fluency,
		addLabel: <Trans>Add a new language</Trans>,
	},
	interests: {
		title: (item) => item.name,
		addLabel: <Trans>Add a new interest</Trans>,
	},
	awards: {
		title: (item) => item.title,
		subtitle: (item) => item.awarder,
		addLabel: <Trans>Add a new award</Trans>,
	},
	certifications: {
		title: (item) => item.title,
		subtitle: (item) => [item.issuer, item.date].filter(Boolean).join(" • ") || undefined,
		addLabel: <Trans>Add a new certification</Trans>,
	},
	publications: {
		title: (item) => item.title,
		subtitle: (item) => item.publisher,
		addLabel: <Trans>Add a new publication</Trans>,
	},
	volunteer: {
		title: (item) => item.organization,
		subtitle: (item) => item.location,
		addLabel: <Trans>Add a new volunteer experience</Trans>,
	},
	references: {
		title: (item) => item.name,
		addLabel: <Trans>Add a new reference</Trans>,
	},
};

type ItemsSectionProps<T extends SectionType> = {
	type: T;
};

export function ItemsSection<T extends SectionType>({ type }: ItemsSectionProps<T>) {
	const items = useCurrentBuilderResumeSelector((resume) => resume.data.sections[type].items) as SectionItemType<T>[];
	const updateResumeData = useUpdateResumeData();
	const config = SECTIONS[type];

	const handleReorder = (nextItems: SectionItemType<T>[]) => {
		updateResumeData((draft) => {
			(draft.sections[type] as { items: SectionItemType<T>[] }).items = nextItems;
		});
	};

	return (
		<SectionBase type={type} className={cn("rounded-md border", items.length === 0 && "border-dashed")}>
			<SectionItemList
				type={type}
				items={items}
				onReorder={handleReorder}
				getTitle={config.title}
				getSubtitle={config.subtitle}
			/>

			<SectionAddItemButton type={type}>{config.addLabel}</SectionAddItemButton>
		</SectionBase>
	);
}
