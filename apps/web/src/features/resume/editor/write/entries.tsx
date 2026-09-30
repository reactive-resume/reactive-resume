import type { CustomSectionType, RoleItem, Website } from "@reactive-resume/schema/resume/data";
import type { DateFormat, ResumeDates } from "@reactive-resume/schema/resume/dates";
import type { ReactNode } from "react";
import type { EntryWriter } from "./fields";
import type { Entry } from "./model";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { EMPTY_RESUME_DATES } from "@reactive-resume/schema/resume/dates";
import { Button } from "@reactive-resume/ui/components/button";
import { FormControl, FormDescription, FormItem, FormLabel } from "@reactive-resume/ui/components/form";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { PopoverTrigger } from "@reactive-resume/ui/components/popover";
import { Slider } from "@reactive-resume/ui/components/slider";
import { generateId } from "@reactive-resume/utils/string";
import { ChipInput } from "@/components/input/chip-input";
import { ColorPicker } from "@/components/input/color-picker";
import { IconPicker } from "@/components/input/icon-picker";
import { DatesField } from "./dates-field";
import { MoreOptions, TextField, WebsiteField } from "./fields";
import { RichTextEditor } from "./rich-text-editor";

export type PageSettings = { locale: string; dateFormat?: DateFormat | undefined };

type FieldSetProps = { entry: Entry; write: EntryWriter; page: PageSettings };

type Values = Record<string, unknown> & {
	website?: Website & { inlineLink?: boolean };
	dates?: ResumeDates;
	keywords?: string[];
	roles?: RoleItem[];
	level?: number;
};

const valuesOf = (entry: Entry) => entry as unknown as Values;
const str = (value: unknown) => (typeof value === "string" ? value : "");

/** A text field bound to one entry field. */
function Text({
	entry,
	write,
	field,
	label,
	wide,
	autoFocus,
}: FieldSetProps & { field: string; label: ReactNode; wide?: boolean; autoFocus?: boolean | undefined }) {
	return (
		<TextField
			label={label}
			value={str(valuesOf(entry)[field])}
			wide={wide}
			autoFocus={autoFocus}
			data-entry-field={field}
			onChange={(value) =>
				write(field, (target) => {
					target[field] = value;
				})
			}
		/>
	);
}

function Dates({ entry, write, page, single }: FieldSetProps & { single?: boolean }) {
	return (
		<DatesField
			className="col-span-full"
			dates={valuesOf(entry).dates ?? EMPTY_RESUME_DATES}
			single={single}
			locale={page.locale}
			format={page.dateFormat}
			onChange={(dates) =>
				write("dates", (target) => {
					target.dates = dates;
				})
			}
		/>
	);
}

function Link({ entry, write }: FieldSetProps) {
	const website = valuesOf(entry).website ?? { url: "", label: "", inlineLink: false };
	return (
		<WebsiteField
			value={website}
			onChange={(value) =>
				write("website", (target) => {
					target.website = value;
				})
			}
		/>
	);
}

function Description({
	entry,
	write,
	field = "description",
	label,
}: FieldSetProps & { field?: string; label?: string }) {
	return (
		<div className="col-span-full grid gap-1.5">
			<span className="font-medium text-[13px] leading-4">{label ?? t`Description`}</span>
			<RichTextEditor
				label={label ?? t`Description`}
				value={str(valuesOf(entry)[field])}
				onChange={(html) =>
					write(field, (target) => {
						target[field] = html;
					})
				}
			/>
		</div>
	);
}

function Keywords({ entry, write, label }: FieldSetProps & { label: ReactNode }) {
	return (
		<FormItem className="col-span-full">
			<FormLabel>{label}</FormLabel>
			<FormControl
				render={
					<ChipInput
						value={valuesOf(entry).keywords ?? []}
						onChange={(keywords) =>
							write("keywords", (target) => {
								target.keywords = keywords;
							})
						}
					/>
				}
			/>
		</FormItem>
	);
}

function Level({ entry, write }: FieldSetProps) {
	const level = Number(valuesOf(entry).level ?? 0);
	return (
		<FormItem className="col-span-full gap-3">
			<FormLabel>
				<Trans>Level</Trans>
			</FormLabel>
			<FormControl
				render={
					<Slider
						min={0}
						max={5}
						step={1}
						value={[level]}
						onValueChange={(value) =>
							write("level", (target) => {
								target.level = Array.isArray(value) ? value[0] : value;
							})
						}
					/>
				}
			/>
			<FormDescription>{level === 0 ? t`Hidden` : `${level} / 5`}</FormDescription>
		</FormItem>
	);
}

/** The icon printed before the entry, and its colour (blank uses the template's). */
function IconAndColor({ entry, write }: FieldSetProps) {
	const values = valuesOf(entry);
	return (
		<div className="col-span-full flex items-center gap-2">
			<IconPicker
				value={str(values.icon)}
				onChange={(icon: string) =>
					write("icon", (target) => {
						target.icon = icon;
					})
				}
				popoverProps={{ modal: true }}
			/>
			<ColorPicker
				value={str(values.iconColor)}
				onChange={(color) =>
					write("iconColor", (target) => {
						target.iconColor = color;
					})
				}
				trigger={
					<PopoverTrigger
						aria-label={t`Icon colour`}
						className="flex h-9 items-center gap-2 rounded-lg border border-line-2 bg-raised px-2.5 text-sm"
					>
						<span
							className="size-4 rounded-full border border-line-2"
							style={{ backgroundColor: str(values.iconColor) || "currentColor" }}
						/>
						<Trans>Icon colour</Trans>
					</PopoverTrigger>
				}
			/>
		</div>
	);
}

function Roles({ entry, write, page }: FieldSetProps) {
	const roles = valuesOf(entry).roles ?? [];

	const writeRoles = (key: string, mutate: (roles: RoleItem[]) => void) =>
		write(`roles:${key}`, (target) => {
			mutate(target.roles as RoleItem[]);
		});

	return (
		<div className="col-span-full grid gap-3">
			{roles.map((role, index) => (
				<div key={role.id} className="grid grid-cols-2 gap-x-3 gap-y-2.5 rounded-lg border border-line bg-bg p-3">
					<div className="col-span-full flex items-center justify-between">
						<span className="font-medium text-[13px] text-ink-2">
							<Trans>Role {index + 1}</Trans>
						</span>
						<div className="flex">
							<IconButton
								icon="arrow_upward"
								label={t`Move role up`}
								size="icon-sm"
								disabled={index === 0}
								onClick={() =>
									writeRoles(`move-${role.id}`, (list) => list.splice(index - 1, 0, ...list.splice(index, 1)))
								}
							/>
							<IconButton
								icon="arrow_downward"
								label={t`Move role down`}
								size="icon-sm"
								disabled={index === roles.length - 1}
								onClick={() =>
									writeRoles(`move-${role.id}`, (list) => list.splice(index + 1, 0, ...list.splice(index, 1)))
								}
							/>
							<IconButton
								icon="delete"
								label={t`Remove role`}
								size="icon-sm"
								onClick={() => writeRoles(`remove-${role.id}`, (list) => list.splice(index, 1))}
							/>
						</div>
					</div>
					<TextField
						label={<Trans>Position</Trans>}
						value={role.position}
						wide
						onChange={(value) =>
							writeRoles(`${role.id}:position`, (list) => {
								const target = list[index];
								if (target) target.position = value;
							})
						}
					/>
					<DatesField
						className="col-span-full"
						dates={role.dates ?? EMPTY_RESUME_DATES}
						locale={page.locale}
						format={page.dateFormat}
						onChange={(dates) =>
							writeRoles(`${role.id}:dates`, (list) => {
								const target = list[index];
								if (target) target.dates = dates;
							})
						}
					/>
					<div className="col-span-full grid gap-1.5">
						<span className="font-medium text-[13px] leading-4">
							<Trans>Description</Trans>
						</span>
						<RichTextEditor
							label={t`Description of role ${index + 1}`}
							value={role.description}
							onChange={(html) =>
								writeRoles(`${role.id}:description`, (list) => {
									const target = list[index];
									if (target) target.description = html;
								})
							}
						/>
					</div>
				</div>
			))}

			<Button
				variant="secondary"
				size="sm"
				className="w-fit"
				onClick={() =>
					writeRoles("add", (list) => {
						list.push({
							id: generateId(),
							position: "",
							period: "",
							dates: { ...EMPTY_RESUME_DATES },
							description: "",
						});
					})
				}
			>
				<Trans>Add role</Trans>
			</Button>
		</div>
	);
}

/** The fields each entry type edits, in a two-column grid. The first field takes focus on a new draft. */
export function EntryFields({
	type,
	autoFocus,
	...props
}: FieldSetProps & { type: CustomSectionType; autoFocus?: boolean | undefined }) {
	switch (type) {
		case "experience":
			return (
				<>
					<Text {...props} field="position" label={<Trans>Position</Trans>} autoFocus={autoFocus} />
					<Text {...props} field="company" label={<Trans>Company</Trans>} />
					<Text {...props} field="location" label={<Trans>Location</Trans>} wide />
					<Dates {...props} />
					<Link {...props} />
					<Description {...props} />
					<Roles {...props} />
				</>
			);
		case "education":
			return (
				<>
					<Text {...props} field="school" label={<Trans>School</Trans>} wide autoFocus={autoFocus} />
					<Text {...props} field="degree" label={<Trans>Degree</Trans>} />
					<Text {...props} field="area" label={<Trans>Area of study</Trans>} />
					<Text {...props} field="grade" label={<Trans>Grade</Trans>} />
					<Text {...props} field="location" label={<Trans>Location</Trans>} />
					<Dates {...props} />
					<Link {...props} />
					<Description {...props} />
				</>
			);
		case "projects":
			return (
				<>
					<Text {...props} field="name" label={<Trans>Name</Trans>} wide autoFocus={autoFocus} />
					<Dates {...props} />
					<Link {...props} />
					<Description {...props} />
				</>
			);
		case "skills":
			return (
				<>
					<Text {...props} field="name" label={<Trans>Name</Trans>} autoFocus={autoFocus} />
					<Text {...props} field="proficiency" label={<Trans>Proficiency</Trans>} />
					<Keywords {...props} label={<Trans>Keywords</Trans>} />
					<MoreOptions>
						<Level {...props} />
						<IconAndColor {...props} />
					</MoreOptions>
				</>
			);
		case "languages":
			return (
				<>
					<Text {...props} field="language" label={<Trans>Language</Trans>} autoFocus={autoFocus} />
					<Text {...props} field="fluency" label={<Trans>Fluency</Trans>} />
					<MoreOptions>
						<Level {...props} />
					</MoreOptions>
				</>
			);
		case "interests":
			return (
				<>
					<Text {...props} field="name" label={<Trans>Name</Trans>} wide autoFocus={autoFocus} />
					<Keywords {...props} label={<Trans>Keywords</Trans>} />
					<MoreOptions>
						<IconAndColor {...props} />
					</MoreOptions>
				</>
			);
		case "awards":
			return (
				<>
					<Text {...props} field="title" label={<Trans>Title</Trans>} autoFocus={autoFocus} />
					<Text {...props} field="awarder" label={<Trans>Awarder</Trans>} />
					<Dates {...props} single />
					<Link {...props} />
					<Description {...props} />
				</>
			);
		case "certifications":
			return (
				<>
					<Text {...props} field="title" label={<Trans>Title</Trans>} autoFocus={autoFocus} />
					<Text {...props} field="issuer" label={<Trans>Issuer</Trans>} />
					<Dates {...props} single />
					<Link {...props} />
					<Description {...props} />
				</>
			);
		case "publications":
			return (
				<>
					<Text {...props} field="title" label={<Trans>Title</Trans>} autoFocus={autoFocus} />
					<Text {...props} field="publisher" label={<Trans>Publisher</Trans>} />
					<Dates {...props} single />
					<Link {...props} />
					<Description {...props} />
				</>
			);
		case "volunteer":
			return (
				<>
					<Text {...props} field="organization" label={<Trans>Organization</Trans>} autoFocus={autoFocus} />
					<Text {...props} field="location" label={<Trans>Location</Trans>} />
					<Dates {...props} />
					<Link {...props} />
					<Description {...props} />
				</>
			);
		case "references":
			return (
				<>
					<Text {...props} field="name" label={<Trans>Name</Trans>} autoFocus={autoFocus} />
					<Text {...props} field="position" label={<Trans>Position</Trans>} />
					<Text {...props} field="phone" label={<Trans>Phone</Trans>} wide />
					<Link {...props} />
					<Description {...props} />
				</>
			);
		case "profiles":
			return (
				<>
					<Text {...props} field="network" label={<Trans>Network</Trans>} autoFocus={autoFocus} />
					<Text {...props} field="username" label={<Trans>Username</Trans>} />
					<Link {...props} />
					<MoreOptions>
						<IconAndColor {...props} />
					</MoreOptions>
				</>
			);
		case "summary":
			return <Description {...props} field="content" label={t`Text`} />;
		// Letters are documents of their own; a resume that still carries one hands it over when it saves.
		case "cover-letter":
			return null;
	}
}
