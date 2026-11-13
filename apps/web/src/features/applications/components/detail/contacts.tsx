import type { Application } from "../../types";
import type { Contact } from "@reactive-resume/schema/applications/data";
import type { ReactNode } from "react";
import { i18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useQueryClient } from "@tanstack/react-query";
import { Fragment, useRef, useState } from "react";
import { contactSchema } from "@reactive-resume/schema/applications/data";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { Popover, PopoverContent, PopoverTrigger } from "@reactive-resume/ui/components/popover";
import { cn } from "@reactive-resume/utils/style";
import { applicationDetailQueryKey } from "../../queries";
import { companyInitials } from "../list-view";
import { Chip } from "@/components/calm/filter-bar";
import { IconTile, List, ListRow } from "@/components/calm/list-row";
import { withQueryUndo } from "@/features/career/shared";
import { client, prepareRpc } from "@/libs/orpc/client";

const EMPTY_CONTACT = { name: "", role: "", type: "", email: "", phone: "" };

type ContactsProps = {
	application: Pick<Application, "id" | "contacts" | "contactsVersion">;
	disabled: boolean;
	inline?: boolean;
	onChange: (contacts: Contact[]) => void;
	/** People met at interviews who aren't contacts yet, listed after them. */
	people?: { name: string; role?: string | undefined }[];
	/** The heading above the list, given the list's own Add contact action. Without it the action sits below. */
	renderHeader?: (add: { start: () => void; disabled: boolean }) => ReactNode;
};
type Removing = { index: number; contact: Contact };

const contactKey = (contact: Contact) =>
	JSON.stringify([contact.name, contact.role ?? "", contact.type ?? "", contact.email ?? "", contact.phone ?? ""]);
const sameContact = (a: Contact | undefined, b: Contact | undefined) => !!a && !!b && contactKey(a) === contactKey(b);

/** The Contact cell: the primary contact (the first), and the full list, with add and remove, in a popover. */
export function Contacts({ application, disabled, onChange, inline = false, people, renderHeader }: ContactsProps) {
	const { contacts } = application;
	const queryClient = useQueryClient();
	const [removing, setRemoving] = useState<Removing | null>(null);
	const [preparing, setPreparing] = useState(false);
	const pending = useRef(false);
	const visible = (contact: Contact, index: number) =>
		!removing || index !== removing.index || !sameContact(contact, removing.contact);
	const shown = contacts.filter(visible);
	const remove = (contact: Contact) => {
		if (pending.current) return;
		pending.current = true;
		setPreparing(true);
		withQueryUndo({
			queryClient,
			queryKey: applicationDetailQueryKey(application.id),
			description: t`Removed ${contact.name}`,
			errorMessage: t`Couldn't save the change. Try again.`,
			prepare: () => {
				if (!application.contactsVersion) throw new Error(t`Couldn't save the change. Try again.`);
				return prepareRpc(client.applications.deleteContact, {
					id: application.id,
					index: contacts.indexOf(contact),
					expectedVersion: application.contactsVersion,
				});
			},
			hide: () => {
				setRemoving({ index: contacts.indexOf(contact), contact });
				setPreparing(false);
			},
			restore: () => {
				setRemoving(null);
				setPreparing(false);
				pending.current = false;
			},
		});
	};
	const [primary, ...others] = shown;

	if (inline)
		return (
			<ContactList
				contacts={contacts}
				disabled={disabled || preparing}
				onChange={onChange}
				removing={removing}
				onRemove={remove}
				people={people}
				renderHeader={renderHeader}
			/>
		);
	return (
		<Popover>
			{/* Named for the field, so "—" isn't read out as the button's name. */}
			<PopoverTrigger
				aria-label={
					!primary
						? t`Contact: none yet`
						: others.length > 0
							? t`Contact: ${primary.name} and ${i18n.number(others.length)} more`
							: t`Contact: ${primary.name}`
				}
				className="grid min-w-0 rounded-md text-start hover:underline"
			>
				<span className="truncate text-sm font-medium">{primary ? primary.name : "—"}</span>
				{others.length > 0 && <span className="text-xs text-ink-3">{t`and ${i18n.number(others.length)} more`}</span>}
			</PopoverTrigger>
			<PopoverContent align="start" className="grid w-80 gap-3 p-3">
				<h3 className="text-sm font-semibold">
					<Trans>Contacts</Trans>
				</h3>
				<ContactList
					contacts={contacts}
					disabled={disabled || preparing}
					onChange={onChange}
					removing={removing}
					onRemove={remove}
				/>
			</PopoverContent>
		</Popover>
	);
}

type ContactListProps = {
	contacts: Contact[];
	disabled: boolean;
	onChange: (contacts: Contact[]) => void;
	removing: Removing | null;
	onRemove: (contact: Contact) => void;
	people?: ContactsProps["people"];
	renderHeader?: ContactsProps["renderHeader"];
};

/** A contact's initials (`.mono2.sm`). */
const Initials = ({ name }: { name: string }) => (
	<IconTile aria-hidden="true" className="size-8 rounded-sm text-xs">
		{companyInitials(name)}
	</IconTile>
);

function ContactList({
	contacts,
	disabled,
	onChange,
	removing,
	onRemove,
	people = [],
	renderHeader,
}: ContactListProps) {
	const [adding, setAdding] = useState(false);
	// The contact being corrected: its position, and what it said when the form opened.
	const [editing, setEditing] = useState<{ index: number; original: Contact } | null>(null);
	const [draft, setDraft] = useState(EMPTY_CONTACT);
	const [error, setError] = useState("");
	const shown = contacts.filter(
		(contact, index) => !removing || index !== removing.index || !sameContact(contact, removing.contact),
	);
	const formOpen = adding || editing !== null;
	// Keep one reviewed contact removal active until canonical readback settles it.
	const locked = disabled || removing !== null;

	const close = () => {
		setDraft(EMPTY_CONTACT);
		setError("");
		setAdding(false);
		setEditing(null);
	};

	const save = () => {
		if (!draft.name.trim()) return;
		// Checked with the API's schema here, so a mistyped email is caught before the draft is thrown away.
		const parsed = contactSchema.safeParse(draft);
		if (!parsed.success) return setError(t`Enter a valid email address.`);
		// Contacts are saved by position. If the list changed while the form was open (another tab or device), that
		// position may hold someone else now: stop rather than overwrite them.
		if (editing && !sameContact(contacts[editing.index], editing.original))
			return setError(t`This contact changed somewhere else. Cancel and edit it again.`);
		onChange(
			editing === null
				? [...contacts, parsed.data]
				: contacts.map((contact, index) => (index === editing.index ? parsed.data : contact)),
		);
		close();
	};

	const edit = (index: number) => {
		const contact = contacts[index];
		if (!contact) return;
		setDraft({
			name: contact.name,
			role: contact.role ?? "",
			type: contact.type ?? "",
			email: contact.email ?? "",
			phone: contact.phone ?? "",
		});
		setError("");
		setAdding(false);
		setEditing({ index, original: contact });
	};

	const field = (key: keyof typeof EMPTY_CONTACT, label: string, type = "text") => (
		<label className="grid gap-1.5 t-small text-ink-2">
			{label}
			<Input
				aria-label={label}
				placeholder={label}
				type={type}
				value={draft[key]}
				onChange={(event) => {
					setError("");
					setDraft((current) => ({ ...current, [key]: event.target.value }));
				}}
			/>
		</label>
	);

	return (
		<div className={renderHeader ? "grid" : "grid gap-2"}>
			{renderHeader?.({ start: () => setAdding(true), disabled: locked || formOpen })}
			{shown.length === 0 && people.length === 0 && !formOpen && (
				<p className="text-sm text-ink-3">
					<Trans>No contacts yet.</Trans>
				</p>
			)}
			<List>
				{shown.map((contact) => {
					const index = contacts.indexOf(contact);
					const details = [contact.type, contact.role].filter(Boolean).join(" · ");
					return (
						<ListRow
							key={`${contact.name}-${index}`}
							className="min-h-[52px] py-1.5"
							leading={<Initials name={contact.name} />}
							title={<bdi className="block truncate text-sm/5">{contact.name}</bdi>}
							subtitle={
								details || contact.email || contact.phone ? (
									<>
										{details}
										{[contact.email, contact.phone].filter(Boolean).map((value, position) => (
											<Fragment key={value}>
												{(details || position > 0) && " · "}
												<a
													href={value === contact.email ? `mailto:${value}` : `tel:${value}`}
													className="font-mono text-xs font-medium hover:underline"
												>
													{value}
												</a>
											</Fragment>
										))}
									</>
								) : undefined
							}
							actions={
								<Button
									size="icon-sm"
									variant="ghost"
									className="touch-target relative"
									disabled={locked || formOpen}
									aria-label={t`Edit ${contact.name}`}
									onClick={() => edit(index)}
								>
									<Icon name="pencil-simple" size={16} />
								</Button>
							}
						/>
					);
				})}
				{people.map((person) => (
					<ListRow
						key={person.name}
						className="min-h-[52px] py-1.5"
						leading={<Initials name={person.name} />}
						title={<bdi className="block truncate text-sm/5">{person.name}</bdi>}
						subtitle={person.role}
					/>
				))}
			</List>

			{formOpen ? (
				<form
					className={cn("grid gap-2 rounded-lg border border-line p-2.5", renderHeader && "mt-2")}
					onSubmit={(event) => {
						event.preventDefault();
						save();
					}}
				>
					<div className="grid grid-cols-2 gap-2">
						{field("name", t`Name`)}
						{field("role", t`Role (optional)`)}
					</div>
					<fieldset className="grid gap-1.5">
						<legend className="t-small text-ink-2">
							<Trans>Label</Trans>
						</legend>
						<div className="flex flex-wrap gap-1.5">
							{[t`Recruiter`, t`Hiring manager`, t`Referral`, t`Interviewer`].map((label) => (
								<Chip
									key={label}
									pressed={draft.type === label}
									onClick={() => setDraft((current) => ({ ...current, type: label }))}
								>
									{label}
								</Chip>
							))}
						</div>
						<Input
							aria-label={t`Custom label`}
							placeholder={t`Or your own label`}
							value={draft.type}
							onChange={(event) => setDraft((current) => ({ ...current, type: event.target.value }))}
						/>
					</fieldset>
					<div className="grid grid-cols-2 gap-2">
						{field("email", t`Email (optional)`, "email")}
						{field("phone", t`Phone (optional)`, "tel")}
					</div>
					{error && <p className="text-xs text-danger-text">{error}</p>}
					<div className="flex justify-end gap-1.5">
						{editing !== null && contacts[editing.index] && (
							<Button
								type="button"
								size="sm"
								variant="danger-text"
								className="me-auto"
								disabled={locked}
								onClick={() => {
									const contact = contacts[editing.index];
									close();
									if (contact) onRemove(contact);
								}}
							>
								<Trans>Remove</Trans>
							</Button>
						)}
						<Button type="button" size="sm" variant="ghost" onClick={close}>
							<Trans>Cancel</Trans>
						</Button>
						<Button type="submit" size="sm" variant="secondary" disabled={!draft.name.trim() || disabled}>
							{editing === null ? <Trans>Add contact</Trans> : <Trans>Save</Trans>}
						</Button>
					</div>
				</form>
			) : renderHeader ? null : (
				<Button size="sm" variant="ghost" className="w-fit" disabled={locked} onClick={() => setAdding(true)}>
					<Icon name="plus" size={16} />
					<Trans>Add contact</Trans>
				</Button>
			)}
		</div>
	);
}
