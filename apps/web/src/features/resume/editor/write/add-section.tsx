import type { CustomSectionType, SectionType } from "@reactive-resume/schema/resume/data";
import type { IconName } from "@reactive-resume/ui/components/icon";
import { t } from "@lingui/core/macro";
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
import { cn } from "@reactive-resume/utils/style";
import { useEditorStore } from "../store";
import { openEntry } from "./actions";
import {
	addBuiltinSection,
	addCustomSection,
	BUILTIN_SECTION_TYPES,
	CUSTOM_SECTION_TYPES,
	getOutlineRows,
	getSectionKind,
	getSectionObject,
	isSectionInUse,
	resolveSection,
} from "./model";
import { openSection } from "./view";
import { useCurrentBuilderResumeSelector, useResumeStore } from "@/features/resume/builder/draft";
import { getSectionTitle } from "@/libs/resume/section";

// The icon each kind prints with by default, so the chooser shows the section as the page will.
const SECTION_ICONS: Record<CustomSectionType, IconName> = {
	summary: "article",
	experience: "briefcase",
	education: "graduation-cap",
	projects: "code-simple",
	skills: "compass-tool",
	languages: "translate",
	interests: "football",
	awards: "trophy",
	certifications: "certificate",
	publications: "books",
	volunteer: "hand-heart",
	references: "phone",
	profiles: "identification-card",
	"cover-letter": "envelope-simple",
};

/** Adds a built-in section (or the summary) and opens it: a new entry with its first field focused, or the text. */
function addSection(type: "summary" | SectionType) {
	let entryId: string | null = null;
	useResumeStore.getState().updateResumeData(
		(draft) => {
			entryId = addBuiltinSection(draft, type);
		},
		{ newStep: true },
	);

	useEditorStore.getState().markSectionAdded(type);
	if (entryId) openEntry(type, entryId, { focus: true });
	else {
		openSection(type);
		requestAnimationFrame(() => document.querySelector<HTMLElement>(`#sidebar-${type} [role="textbox"]`)?.focus());
	}
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
 * Add section: one chooser with every kind. The kinds not on the page yet add a section with one draft entry, open and
 * focused; the ones already in the resume open on click; Custom section makes a second section of any kind, named
 * "Projects 2" until it's renamed.
 */
export function AddSectionMenu() {
	const added = useEditorStore((state) => state.addedSections);
	const unusedKey = useCurrentBuilderResumeSelector((resume) =>
		(["summary", ...BUILTIN_SECTION_TYPES] as const)
			.filter((type) => !isSectionInUse(resume.data, type, new Set(added)))
			.join(","),
	);
	const unused = unusedKey ? (unusedKey.split(",") as ("summary" | SectionType)[]) : [];
	// The sections in use, in print order: id, type, title and whether each is hidden, joined to stay stable.
	const usedKey = useCurrentBuilderResumeSelector((resume) =>
		getOutlineRows(resume.data, new Set(added))
			.map((row) => {
				const section = resolveSection(resume.data, row.id);
				const title = section ? (getSectionObject(resume.data, section)?.title.trim() ?? "") : "";
				return [row.id, section?.type ?? "", title, row.hidden ? 1 : 0].join("\u0000");
			})
			.join("\u0001"),
	);
	const used = usedKey
		? usedKey.split("\u0001").map((part) => {
				const [id = "", type = "", title = "", hidden = "0"] = part.split("\u0000");
				return { id, type: type as CustomSectionType, title, hidden: hidden === "1" };
			})
		: [];

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<button
						type="button"
						className="flex shrink-0 items-center gap-1.5 rounded-xs text-sm/5 font-medium text-accent-text hover:underline aria-expanded:underline"
					>
						<Icon name="plus" size={16} />
						<Trans>Add section</Trans>
					</button>
				}
			/>
			<DropdownMenuContent
				align="start"
				side="right"
				sideOffset={33}
				alignOffset={-17}
				aria-label={t`Add section`}
				className="w-[236px] min-w-0"
			>
				<div aria-hidden="true" className="px-2.5 pt-2 pb-0.5 text-sm/5 font-semibold">
					<Trans>Add section</Trans>
				</div>
				{unused.length > 0 && (
					<DropdownMenuGroup>
						<DropdownMenuLabel className="pt-2">
							<Trans>Not on the page yet</Trans>
						</DropdownMenuLabel>
						{unused.map((type) => (
							<DropdownMenuItem key={type} onClick={() => addSection(type)}>
								<Icon name={SECTION_ICONS[type]} />
								{getSectionTitle(type)}
							</DropdownMenuItem>
						))}
					</DropdownMenuGroup>
				)}
				{unused.length > 0 && used.length > 0 && <DropdownMenuSeparator />}
				{used.length > 0 && (
					<DropdownMenuGroup>
						<DropdownMenuLabel className="pt-2">
							<Trans>Already in this resume</Trans>
						</DropdownMenuLabel>
						{used.map((section) => (
							<DropdownMenuItem key={section.id} className="text-ink-2" onClick={() => openSection(section.id)}>
								<Icon name={SECTION_ICONS[section.type]} />
								<bdi className="truncate">
									{section.title ||
										getSectionTitle(
											getSectionKind(section.id) === "custom" ? section.type : (section.id as SectionType | "summary"),
										)}
								</bdi>
								<span className="ms-auto shrink-0 text-xs/4 text-ink-3">
									{section.hidden ? <Trans>Hidden</Trans> : <Trans>On the page</Trans>}
								</span>
							</DropdownMenuItem>
						))}
					</DropdownMenuGroup>
				)}
				<DropdownMenuSeparator />
				<DropdownMenuSub>
					<DropdownMenuSubTrigger className="min-h-[52px]">
						<Icon name="plus" />
						<span className="flex flex-col">
							<Trans>Custom section</Trans>
							<span className="text-xs/4 text-ink-3">
								<Trans>Any kind, your own title</Trans>
							</span>
						</span>
					</DropdownMenuSubTrigger>
					<DropdownMenuSubContent className="w-56">
						<DropdownMenuGroup>
							<DropdownMenuLabel>
								<Trans>What goes in it?</Trans>
							</DropdownMenuLabel>
							{CUSTOM_SECTION_TYPES.map((type) => (
								<DropdownMenuItem key={type} onClick={() => addCustom(type)}>
									<Icon name={SECTION_ICONS[type]} />
									{getSectionTitle(type)}
								</DropdownMenuItem>
							))}
						</DropdownMenuGroup>
					</DropdownMenuSubContent>
				</DropdownMenuSub>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

// Projects are how someone without a job yet shows their work (Check suggests them when Experience is empty).
export const SUGGESTED_SECTIONS: readonly ("summary" | SectionType)[] = [
	"experience",
	"education",
	"projects",
	"skills",
	"summary",
];

export const isSuggestedSection = (id: string): id is "summary" | SectionType =>
	(SUGGESTED_SECTIONS as readonly string[]).includes(id);

type StartSuggestionsProps = {
	/** The suggested sections the resume doesn't have yet. */
	suggestions: readonly ("summary" | SectionType)[];
	/** On a blank resume: offer to import one instead. */
	onImport?: (() => void) | undefined;
};

/** The first sections to add, as + chips, until each is used; on a blank resume, an offer to import instead. */
export function StartSuggestions({ suggestions, onImport }: StartSuggestionsProps) {
	return (
		<div className={cn("grid gap-3 rounded-xl border border-dashed border-line p-4", !onImport && "mt-2 gap-2 p-3")}>
			<p className="text-sm text-ink-2">
				{onImport ? (
					<Trans>Start with the sections most resumes have.</Trans>
				) : (
					<Trans>Sections most resumes also have:</Trans>
				)}
			</p>
			<div className="flex flex-wrap gap-2">
				{suggestions.map((type) => (
					<button
						key={type}
						type="button"
						onClick={() => addSection(type)}
						className="flex h-8 items-center gap-1 rounded-sm border border-line-2 bg-raised px-3 text-sm hover:border-accent hover:text-accent-text"
					>
						<Icon name="plus" size={16} />
						{getSectionTitle(type)}
					</button>
				))}
			</div>
			{onImport && (
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
			)}
		</div>
	);
}
