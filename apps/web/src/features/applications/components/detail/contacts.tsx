import type { Application } from "../../types";
import type { Contact } from "@reactive-resume/schema/applications/data";
import { i18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import { contactSchema } from "@reactive-resume/schema/applications/data";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { Popover, PopoverContent, PopoverTrigger } from "@reactive-resume/ui/components/popover";
import { applicationDetailQueryKey } from "../../queries";
import { withQueryUndo } from "@/features/career/shared";
import { client, prepareRpc } from "@/libs/orpc/client";

const EMPTY_CONTACT = { name: "", role: "", type: "", email: "", phone: "" };

type ContactsProps = {
	application: Pick<Application, "id" | "contacts" | "contactsVersion">;
	disabled: boolean;
	onChange: (contacts: Contact[]) => void;
};
type Removing = { index: number; contact: Contact };

const contactKey = (contact: Contact) =>
	JSON.stringify([contact.name, contact.role ?? "", contact.type ?? "", contact.email ?? "", contact.phone ?? ""]);
const sameContact = (a: Contact | undefined, b: Contact | undefined) => !!a && !!b && contactKey(a) === contactKey(b);

/** The Contact cell: the primary contact (the first), and the full list, with add and remove, in a popover. */
export function Contacts({ application, disabled, onChange }: ContactsProps) {
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
};

function ContactList({ contacts, disabled, onChange, removing, onRemove }: ContactListProps) {
	const id = useId();
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
	);

	return (
		<div className="grid gap-2">
			{shown.length === 0 && !formOpen && (
				<p className="text-sm text-ink-3">
					<Trans>No contacts yet.</Trans>
				</p>
			)}
			{shown.map((contact) => {
				const index = contacts.indexOf(contact);
				return (
					<div key={`${contact.name}-${index}`} className="flex items-start gap-2.5 text-sm">
						<div className="grid min-w-0 flex-1">
							<span className="truncate font-medium">
								<bdi>{contact.name}</bdi>
								{contact.type && <span className="font-normal text-ink-3"> · {contact.type}</span>}
							</span>
							{contact.role && (
								<span dir="auto" className="truncate text-xs text-ink-3">
									{contact.role}
								</span>
							)}
							{contact.email && (
								<a href={`mailto:${contact.email}`} className="truncate text-xs text-accent-text hover:underline">
									{contact.email}
								</a>
							)}
							{contact.phone && (
								<a href={`tel:${contact.phone}`} className="truncate text-xs text-accent-text hover:underline">
									{contact.phone}
								</a>
							)}
						</div>
						<Button
							size="icon-xs"
							variant="ghost"
							className="touch-target relative"
							disabled={locked || formOpen}
							aria-label={t`Edit ${contact.name}`}
							onClick={() => edit(index)}
						>
							<Icon name="pencil-simple" size={16} />
						</Button>
						<Button
							size="icon-xs"
							variant="ghost"
							className="touch-target relative"
							disabled={locked || formOpen}
							aria-label={t`Remove ${contact.name}`}
							onClick={() => onRemove(contact)}
						>
							<Icon name="x" size={16} />
						</Button>
					</div>
				);
			})}

			{formOpen ? (
				<form
					className="grid gap-2 rounded-lg border border-line p-2.5"
					onSubmit={(event) => {
						event.preventDefault();
						save();
					}}
				>
					{field("name", t`Name`)}
					<div className="grid grid-cols-2 gap-2">
						{field("role", t`Role (optional)`)}
						<Input
							aria-label={t`Label`}
							placeholder={t`Label, e.g. Recruiter`}
							list={`${id}-types`}
							value={draft.type}
							onChange={(event) => setDraft((current) => ({ ...current, type: event.target.value }))}
						/>
					</div>
					<div className="grid grid-cols-2 gap-2">
						{field("email", t`Email (optional)`, "email")}
						{field("phone", t`Phone (optional)`, "tel")}
					</div>
					<datalist id={`${id}-types`}>
						<option value={t`Recruiter`} />
						<option value={t`Hiring manager`} />
						<option value={t`Referral`} />
						<option value={t`Interviewer`} />
					</datalist>
					{error && <p className="text-xs text-danger-text">{error}</p>}
					<div className="flex justify-end gap-1.5">
						<Button type="button" size="sm" variant="ghost" onClick={close}>
							<Trans>Cancel</Trans>
						</Button>
						<Button type="submit" size="sm" disabled={!draft.name.trim() || disabled}>
							{editing === null ? <Trans>Add</Trans> : <Trans>Save</Trans>}
						</Button>
					</div>
				</form>
			) : (
				<Button size="sm" variant="ghost" className="w-fit" disabled={locked} onClick={() => setAdding(true)}>
					<Icon name="plus" size={16} />
					<Trans>Add contact</Trans>
				</Button>
			)}
		</div>
	);
}
