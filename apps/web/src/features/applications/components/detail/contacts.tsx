import type { Contact } from "@reactive-resume/schema/applications/data";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useId, useState } from "react";
import { contactSchema } from "@reactive-resume/schema/applications/data";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { Popover, PopoverContent, PopoverTrigger } from "@reactive-resume/ui/components/popover";

const EMPTY_CONTACT = { name: "", role: "", type: "", email: "", phone: "" };

type ContactsProps = { contacts: Contact[]; disabled: boolean; onChange: (contacts: Contact[]) => void };

/** The Contact cell: the primary contact (the first), and the full list, with add and remove, in a popover. */
export function Contacts({ contacts, disabled, onChange }: ContactsProps) {
	const [primary, ...others] = contacts;

	return (
		<Popover>
			<PopoverTrigger className="grid min-w-0 rounded-md text-start hover:underline">
				<span className="truncate text-sm font-medium">{primary ? primary.name : "—"}</span>
				{others.length > 0 && <span className="text-xs text-ink-3">{t`and ${others.length} more`}</span>}
			</PopoverTrigger>
			<PopoverContent align="start" className="grid w-80 gap-3 p-3">
				<h3 className="text-sm font-semibold">
					<Trans>Contacts</Trans>
				</h3>
				<ContactList contacts={contacts} disabled={disabled} onChange={onChange} />
			</PopoverContent>
		</Popover>
	);
}

function ContactList({ contacts, disabled, onChange }: ContactsProps) {
	const id = useId();
	const [adding, setAdding] = useState(false);
	const [draft, setDraft] = useState(EMPTY_CONTACT);
	const [error, setError] = useState("");

	const add = () => {
		if (!draft.name.trim()) return;
		// Checked with the API's schema here, so a mistyped email is caught before the draft is thrown away.
		const parsed = contactSchema.safeParse(draft);
		if (!parsed.success) return setError(t`Enter a valid email address.`);
		onChange([...contacts, parsed.data]);
		setDraft(EMPTY_CONTACT);
		setError("");
		setAdding(false);
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
			{contacts.length === 0 && !adding && (
				<p className="text-sm text-ink-3">
					<Trans>No contacts yet.</Trans>
				</p>
			)}
			{contacts.map((contact, index) => (
				<div key={`${contact.name}-${index}`} className="flex items-start gap-2.5 text-sm">
					<div className="grid min-w-0 flex-1">
						<span className="truncate font-medium">
							{contact.name}
							{contact.type && <span className="font-normal text-ink-3"> · {contact.type}</span>}
						</span>
						{contact.role && <span className="truncate text-xs text-ink-3">{contact.role}</span>}
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
						disabled={disabled}
						aria-label={t`Remove ${contact.name}`}
						onClick={() => onChange(contacts.filter((_, i) => i !== index))}
					>
						<Icon name="close" size={16} />
					</Button>
				</div>
			))}

			{adding ? (
				<form
					className="grid gap-2 rounded-lg border border-line p-2.5"
					onSubmit={(event) => {
						event.preventDefault();
						add();
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
						<Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
							<Trans>Cancel</Trans>
						</Button>
						<Button type="submit" size="sm" disabled={!draft.name.trim() || disabled}>
							<Trans>Add</Trans>
						</Button>
					</div>
				</form>
			) : (
				<Button size="sm" variant="ghost" className="w-fit" disabled={disabled} onClick={() => setAdding(true)}>
					<Icon name="add" size={16} />
					<Trans>Add contact</Trans>
				</Button>
			)}
		</div>
	);
}
