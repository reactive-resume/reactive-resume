import type { Basics, CustomField } from "@reactive-resume/schema/resume/data";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { Button } from "@reactive-resume/ui/components/button";
import { Collapsible, CollapsibleContent } from "@reactive-resume/ui/components/collapsible";
import { Icon } from "@reactive-resume/ui/components/icon";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { Input } from "@reactive-resume/ui/components/input";
import { Popover, PopoverContent, PopoverTrigger } from "@reactive-resume/ui/components/popover";
import { generateId, getInitials } from "@reactive-resume/utils/string";
import { cn } from "@reactive-resume/utils/style";
import { useEditorStore } from "../store";
import { TextField, validateEmail, WebsiteField } from "./fields";
import { PictureSettings } from "./picture-settings";
import { IconPicker } from "@/components/input/icon-picker";
import { useCurrentBuilderResumeSelector, useUpdateResumeData } from "@/features/resume/builder/draft";

type TextKey = "name" | "headline" | "email" | "phone" | "location";

function useBasicsWriter() {
	const updateResumeData = useUpdateResumeData();
	return (key: string, mutate: (basics: Basics) => void) =>
		updateResumeData((draft) => mutate(draft.basics), { coalesceKey: `basics.${key}` });
}

/**
 * The Basics card: name and "headline · location" with an initials avatar, opening to the photo, contact
 * fields and custom fields. The page header selects it.
 */
export function BasicsCard({ locked }: { locked: boolean }) {
	const basics = useCurrentBuilderResumeSelector((resume) => resume.data.basics);
	const open = useEditorStore((state) => state.basicsOpen);
	const setOpen = useEditorStore((state) => state.setBasicsOpen);
	const selected = useEditorStore((state) => state.selection?.kind === "header");
	const write = useBasicsWriter();

	const text = (key: TextKey) => ({
		value: basics[key],
		onChange: (value: string) =>
			write(key, (target) => {
				target[key] = value;
			}),
	});

	return (
		<section
			id="sidebar-basics"
			aria-label={t`Basics`}
			className={cn(
				"scroll-mt-[60px] rounded-xl border border-line bg-surface transition-[border-color] duration-quick",
				selected && "border-accent",
			)}
		>
			<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen(!open)}
				className="flex w-full items-center gap-3 rounded-xl p-3 text-start"
			>
				<span
					aria-hidden="true"
					className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-soft text-sm font-semibold text-accent-text"
				>
					{getInitials(basics.name || "?")}
				</span>
				<span className="min-w-0 flex-1">
					<span className={cn("block truncate text-sm font-semibold", !basics.name && "text-ink-3")}>
						{basics.name || <Trans>Your name</Trans>}
					</span>
					<span className="block truncate text-xs text-ink-3">
						{[basics.headline, basics.location].filter((part) => part.trim()).join(" · ")}
					</span>
				</span>
				<Icon
					name="expand_more"
					className={cn("text-ink-2 transition-transform duration-standard ease-enter", open && "rotate-180")}
				/>
			</button>

			<Collapsible open={open}>
				<CollapsibleContent>
					<fieldset
						disabled={locked}
						className="m-0 grid min-w-0 grid-cols-2 gap-x-3 gap-y-2.5 border-0 border-t border-line px-3 pt-3 pb-3.5"
					>
						<PhotoRow locked={locked} />
						<TextField
							label={<Trans>Full name</Trans>}
							wide
							autoComplete="name"
							// A blank resume opens straight into the name field.
							autoFocus={!locked && !basics.name}
							{...text("name")}
						/>
						<TextField label={<Trans>Headline</Trans>} wide {...text("headline")} />
						<TextField
							label={<Trans>Email</Trans>}
							type="email"
							autoComplete="email"
							validate={validateEmail}
							{...text("email")}
						/>
						<TextField label={<Trans>Phone</Trans>} type="tel" autoComplete="tel" {...text("phone")} />
						<TextField label={<Trans>Location</Trans>} wide {...text("location")} />
						<WebsiteField
							label={<Trans>Website</Trans>}
							value={basics.website}
							allowInlineLink={false}
							onChange={(website) =>
								write("website", (target) => {
									target.website = { url: website.url, label: website.label };
								})
							}
						/>
						<CustomFields fields={basics.customFields} locked={locked} />
					</fieldset>
				</CollapsibleContent>
			</Collapsible>
		</section>
	);
}

function PhotoRow({ locked }: { locked: boolean }) {
	const picture = useCurrentBuilderResumeSelector((resume) => resume.data.picture);
	const hasPhoto = Boolean(picture.url);

	return (
		<div id="sidebar-picture" className="col-span-full flex items-center gap-3 rounded-lg bg-bg p-2.5">
			{hasPhoto ? (
				<img src={picture.url} alt="" className="size-10 shrink-0 rounded-md object-cover" />
			) : (
				<span className="grid size-10 shrink-0 place-items-center rounded-md bg-sunken text-ink-3">
					<Icon name="add_a_photo" />
				</span>
			)}
			<p className="min-w-0 flex-1 text-xs leading-4 text-ink-2">
				{!hasPhoto ? (
					<Trans>No photo. Most ATS ignore photos; some regions expect one.</Trans>
				) : picture.hidden ? (
					<Trans>Photo hidden from the page.</Trans>
				) : (
					<Trans>Photo on the page.</Trans>
				)}
			</p>
			<Popover>
				<PopoverTrigger
					render={
						<Button variant="secondary" size="sm" disabled={locked}>
							{hasPhoto ? <Trans>Edit</Trans> : <Trans>Add</Trans>}
						</Button>
					}
				/>
				<PopoverContent align="end" className="max-h-[70svh] w-[360px] overflow-y-auto p-4">
					<PictureSettings />
				</PopoverContent>
			</Popover>
		</div>
	);
}

/** Extra contact details (icon, text and an optional link), as "Add field" under Website. */
type CustomFieldsProps = { fields: CustomField[]; locked: boolean };
function CustomFields({ fields, locked }: CustomFieldsProps) {
	const updateResumeData = useUpdateResumeData();

	const edit = (key: string, mutate: (list: CustomField[]) => void) =>
		updateResumeData((draft) => mutate(draft.basics.customFields), { coalesceKey: `basics.customFields.${key}` });

	return (
		<div className="col-span-full grid gap-2">
			{fields.map((field, index) => (
				<div key={field.id} className="flex items-center gap-1.5">
					<IconPicker
						disabled={locked}
						value={field.icon}
						popoverProps={{ modal: true }}
						onChange={(icon) =>
							edit(`${field.id}.icon`, (list) => {
								const target = list[index];
								if (target) target.icon = icon;
							})
						}
					/>
					<Input
						disabled={locked}
						aria-label={t`Field ${index + 1}`}
						value={field.text}
						onChange={(event) =>
							edit(`${field.id}.text`, (list) => {
								const target = list[index];
								if (target) target.text = event.target.value;
							})
						}
					/>
					<Popover>
						<PopoverTrigger
							render={
								<IconButton
									disabled={locked}
									icon={field.link ? "link" : "link_off"}
									label={field.link ? t`Edit link` : t`Add a link`}
									className={field.link ? "text-accent-text" : "text-ink-3"}
								/>
							}
						/>
						<PopoverContent align="end" className="w-72">
							<Input
								disabled={locked}
								type="url"
								aria-label={t`Link address`}
								placeholder="https://"
								value={field.link}
								onChange={(event) =>
									edit(`${field.id}.link`, (list) => {
										const target = list[index];
										if (target) target.link = event.target.value;
									})
								}
							/>
						</PopoverContent>
					</Popover>
					<IconButton
						icon="arrow_upward"
						label={t`Move field up`}
						size="icon-sm"
						disabled={locked || index === 0}
						onClick={() => edit(`${field.id}.move`, (list) => list.splice(index - 1, 0, ...list.splice(index, 1)))}
					/>
					<IconButton
						icon="close"
						label={t`Remove field`}
						disabled={locked}
						size="icon-sm"
						onClick={() => edit(`${field.id}.remove`, (list) => list.splice(index, 1))}
					/>
				</div>
			))}
			<button
				type="button"
				disabled={locked}
				className="flex h-9 w-fit items-center gap-1.5 rounded-lg px-2 text-sm text-accent-text hover:bg-hover disabled:pointer-events-none disabled:opacity-50"
				onClick={() => edit("add", (list) => list.push({ id: generateId(), icon: "acorn", text: "", link: "" }))}
			>
				<Icon name="add" size={18} />
				<Trans>Add field</Trans>
			</button>
		</div>
	);
}
