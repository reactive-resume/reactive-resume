import type { CustomSectionType, SectionType } from "@reactive-resume/schema/resume/data";
import type { IconName } from "@reactive-resume/ui/components/icon";
import { Trans } from "@lingui/react/macro";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@reactive-resume/ui/components/dropdown-menu";
import { Icon } from "@reactive-resume/ui/components/icon";
import { useEditorStore } from "../store";
import { openEntry } from "./actions";
import {
	addBuiltinSection,
	addCustomSection,
	BUILTIN_SECTION_TYPES,
	CUSTOM_SECTION_TYPES,
	isSectionInUse,
} from "./model";
import { useCurrentBuilderResumeSelector, useResumeStore } from "@/features/resume/builder/draft";
import { getSectionTitle } from "@/libs/resume/section";

const SECTION_ICONS: Record<CustomSectionType, IconName> = {
	summary: "short_text",
	experience: "work",
	education: "school",
	projects: "hub",
	skills: "bolt",
	languages: "translate",
	interests: "bookmark",
	awards: "check_circle",
	certifications: "fact_check",
	publications: "description",
	volunteer: "account_circle",
	references: "call",
	profiles: "link",
	"cover-letter": "mail",
};

/** Adds a built-in section (or the summary), opens it and focuses its first field. */
function addSection(type: "summary" | SectionType) {
	let entryId: string | null = null;
	useResumeStore.getState().updateResumeData(
		(draft) => {
			entryId = addBuiltinSection(draft, type);
		},
		{ newStep: true },
	);

	const editor = useEditorStore.getState();
	editor.markSectionAdded(type);
	editor.setSectionOpen(type, true);
	if (entryId) openEntry(type, entryId, { focus: true });
	else requestAnimationFrame(() => document.querySelector<HTMLElement>(`#sidebar-${type} [role="textbox"]`)?.focus());
}

function addCustom(type: CustomSectionType) {
	let ids = { sectionId: "", entryId: "" };
	useResumeStore.getState().updateResumeData(
		(draft) => {
			ids = addCustomSection(draft, type, getSectionTitle(type));
		},
		{ newStep: true },
	);
	openEntry(ids.sectionId, ids.entryId, { focus: true });
}

/**
 * Add section: every section not in use, in two columns, plus Custom section, which asks for a type. Once every
 * section is in use, the custom types are listed directly. The new section starts with one draft entry, open and
 * focused.
 */
export function AddSectionMenu() {
	const added = useEditorStore((state) => state.addedSections);
	const unusedKey = useCurrentBuilderResumeSelector((resume) =>
		(["summary", ...BUILTIN_SECTION_TYPES] as const)
			.filter((type) => !isSectionInUse(resume.data, type, new Set(added)))
			.join(","),
	);
	const unused = unusedKey ? (unusedKey.split(",") as ("summary" | SectionType)[]) : [];
	const customItems = CUSTOM_SECTION_TYPES.map((type) => (
		<DropdownMenuItem key={type} onClick={() => addCustom(type)}>
			<Icon name={SECTION_ICONS[type]} />
			{getSectionTitle(type)}
		</DropdownMenuItem>
	));

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<button
						type="button"
						className="mt-2 flex h-10 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line-2 text-sm text-ink-2 transition-colors duration-quick hover:border-accent hover:text-accent-text"
					>
						<Icon name="add" size={18} />
						<Trans>Add section</Trans>
					</button>
				}
			/>
			<DropdownMenuContent align="start" className="w-[var(--anchor-width)] min-w-[320px]">
				{unused.length > 0 && (
					<DropdownMenuGroup className="grid grid-cols-2">
						{unused.map((type) => (
							<DropdownMenuItem key={type} onClick={() => addSection(type)}>
								<Icon name={SECTION_ICONS[type]} />
								{getSectionTitle(type)}
							</DropdownMenuItem>
						))}
					</DropdownMenuGroup>
				)}
				{unused.length > 0 && <DropdownMenuSeparator />}
				{unused.length > 0 ? (
					<DropdownMenuSub>
						<DropdownMenuSubTrigger>
							<Icon name="add" />
							<Trans>Custom section</Trans>
						</DropdownMenuSubTrigger>
						<DropdownMenuSubContent className="w-56">
							<DropdownMenuGroup>
								<DropdownMenuLabel>
									<Trans>What goes in it?</Trans>
								</DropdownMenuLabel>
								{customItems}
							</DropdownMenuGroup>
						</DropdownMenuSubContent>
					</DropdownMenuSub>
				) : (
					// Every built-in section is in use, so the custom types are the only choice: list them here.
					<DropdownMenuGroup className="grid grid-cols-2">
						<DropdownMenuLabel className="col-span-2">
							<Trans>Custom section</Trans>
						</DropdownMenuLabel>
						{customItems}
					</DropdownMenuGroup>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

const SUGGESTED: ("summary" | SectionType)[] = ["experience", "education", "skills", "summary"];

/** A blank resume: the first sections to add, as + chips, and an offer to import instead. */
export function StartSuggestions({ onImport }: { onImport: () => void }) {
	return (
		<div className="grid gap-3 rounded-xl border border-dashed border-line p-4">
			<p className="text-sm text-ink-2">
				<Trans>Start with the sections most resumes have.</Trans>
			</p>
			<div className="flex flex-wrap gap-2">
				{SUGGESTED.map((type) => (
					<button
						key={type}
						type="button"
						onClick={() => addSection(type)}
						className="flex h-8 items-center gap-1 rounded-full border border-line-2 bg-raised px-3 text-sm hover:border-accent hover:text-accent-text"
					>
						<Icon name="add" size={16} />
						{getSectionTitle(type)}
					</button>
				))}
			</div>
			<p className="text-xs text-ink-3">
				<Trans>
					Have a resume already?{" "}
					<button
						type="button"
						onClick={onImport}
						className="font-medium text-accent-text underline underline-offset-2"
					>
						Import it
					</button>
				</Trans>
			</p>
		</div>
	);
}
