import type { RouterOutput } from "@/libs/orpc/client";
import type { ApplicationProfileData } from "@reactive-resume/schema/application-profile";
import type { ReactNode } from "react";
import { plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { useId, useState } from "react";
import { applicationProfileDataSchema } from "@reactive-resume/schema/application-profile";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@reactive-resume/ui/components/alert-dialog";
import { Button } from "@reactive-resume/ui/components/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@reactive-resume/ui/components/dialog";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { Label } from "@reactive-resume/ui/components/label";
import { NativeSelect } from "@reactive-resume/ui/components/native-select";
import { SegmentedControl, SegmentedControlItem } from "@reactive-resume/ui/components/segmented-control";
import { toast } from "@reactive-resume/ui/components/toast";
import { parseAmount } from "@reactive-resume/utils/amount";
import { downloadWithAnchor } from "@reactive-resume/utils/file";
import { countryName, SEARCH_REGION_CODES } from "@reactive-resume/utils/region";
import { cn } from "@reactive-resume/utils/style";
import { TextAction } from "./section";
import { List, ListRow } from "@/components/calm/list-row";
import { SectionHeading } from "@/components/calm/section-heading";
import { client, orpc } from "@/libs/orpc/client";

type Record = RouterOutput["applicationProfile"]["get"];
type Answer = ApplicationProfileData["willingToRelocate"];
const empty = () => applicationProfileDataSchema.parse({});

/** What one dialog edits. A reference is edited by its place in the list; one past the end adds a new one. */
type Group =
	| "name"
	| "email"
	| "phone"
	| "address"
	| "links"
	| "authorization"
	| "relocation"
	| "salary"
	| { reference: number };

/** The parts of the profile a group owns: only these are written on Save, so another device's edits elsewhere stay. */
const groupKeys = (group: Group): (keyof ApplicationProfileData)[] =>
	typeof group === "object"
		? ["references"]
		: (
				{
					name: ["givenName", "familyName"],
					email: ["email"],
					phone: ["phone"],
					address: ["address"],
					links: ["links"],
					authorization: ["workAuthorization"],
					relocation: ["willingToRelocate"],
					salary: ["requestedSalary"],
				} as const
			)[group].slice();

const hostOf = (url: string) => {
	try {
		return new URL(url).host.replace(/^www\./, "");
	} catch {
		return url;
	}
};

export function ProfileSettings() {
	const { session } = useRouteContext({ from: "/dashboard" });
	const query = useQuery(orpc.applicationProfile.get.queryOptions());
	return query.isPending ? (
		<p role="status" className="pt-2 text-[13px]/[18px] text-ink-3">
			<Trans>Loading…</Trans>
		</p>
	) : query.isError && query.data === undefined ? (
		<div role="alert" className="grid justify-items-start gap-2 pt-2">
			<p className="t-small text-ink-2">
				<Trans>Couldn't load your application profile. Your saved data hasn't changed.</Trans>
			</p>
			<Button variant="secondary" loading={query.isFetching} onClick={() => void query.refetch()}>
				{query.isFetching ? <Trans>Retrying…</Trans> : <Trans>Try again</Trans>}
			</Button>
		</div>
	) : (
		<ApplicationProfile key={session.user.id} record={query.data ?? null} />
	);
}

type ApplicationProfileProps = { record: Record };

function ApplicationProfile({ record }: ApplicationProfileProps) {
	const { i18n } = useLingui();
	const queryClient = useQueryClient();
	const [editing, setEditing] = useState<Group | null>(null);
	const [deleting, setDeleting] = useState(false);
	const [busy, setBusy] = useState(false);
	const data = record?.data ?? empty();
	const replace = (next: Record) => queryClient.setQueryData(orpc.applicationProfile.get.queryKey(), next);
	const country = (code: string) => countryName(code, i18n.locale);
	const failed = () =>
		toast.add({
			type: "error",
			description: t`Couldn't complete this action. If another device changed the profile, reload the page and try again.`,
		});

	const exportProfile = async () => {
		try {
			const saved = await client.applicationProfile.get();
			if (!saved) throw new Error("Profile deleted");
			downloadWithAnchor(
				new Blob([JSON.stringify(saved, null, 2)], { type: "application/json" }),
				"application-profile.json",
			);
		} catch {
			failed();
		}
	};

	const remove = async () => {
		setDeleting(false);
		if (!record || busy) return;
		setBusy(true);
		try {
			await client.applicationProfile.delete({ expectedRevision: record.revision });
			replace(null);
			toast.add({ description: t`Profile deleted.` });
		} catch {
			failed();
		} finally {
			setBusy(false);
		}
	};

	const name = [data.givenName, data.familyName].filter(Boolean).join(" ");
	const place = [data.address.city, data.address.countryCode ? country(data.address.countryCode) : ""]
		.filter(Boolean)
		.join(", ");
	const hasStreet = !!data.address.line1;
	const hasPostalCode = !!data.address.postalCode;
	const addressShown = place || data.address.line1 || data.address.region;
	const addressGap =
		!hasStreet && !hasPostalCode
			? t`street and postal code not added`
			: !hasStreet
				? t`street not added`
				: !hasPostalCode
					? t`postal code not added`
					: null;
	const firstLink = data.links[0];
	const moreLinks = data.links.length - 1;
	const firstCountry = data.workAuthorization[0];
	const moreCountries = data.workAuthorization.length - 1;
	const salary = data.requestedSalary;
	const money =
		salary?.amount != null && salary.currency
			? i18n.number(salary.amount, {
					style: "currency",
					currency: salary.currency,
					minimumFractionDigits: Number.isInteger(salary.amount) ? 0 : 2,
					maximumFractionDigits: 2,
				})
			: null;

	const authorizationLine = (row: ApplicationProfileData["workAuthorization"][number]) =>
		[
			row.authorized === "yes"
				? t`authorized to work`
				: row.authorized === "no"
					? t`not authorized to work`
					: t`authorization not answered`,
			row.needsSponsorship === "no"
				? t`no sponsorship needed`
				: row.needsSponsorship === "yes"
					? t`needs sponsorship`
					: t`sponsorship not answered`,
		].join(", ");

	const referenceLine = (row: ApplicationProfileData["references"][number]) =>
		row.email && row.phone
			? t`email and phone saved`
			: row.email
				? t`email saved`
				: row.phone
					? t`phone saved`
					: t`no contact details`;

	return (
		<div id="application-profile" className="flex flex-col">
			<SectionHeading
				first
				note={
					record ? (
						<Trans>
							Last updated {i18n.date(new Date(record.reviewedAt), { day: "numeric", month: "short" })},{" "}
							{i18n.date(new Date(record.reviewedAt), { timeStyle: "short" })}
						</Trans>
					) : (
						<Trans>Not saved yet</Trans>
					)
				}
				action={
					record && (
						<button type="button" className="hover:underline" onClick={() => void exportProfile()}>
							<Trans>Export</Trans>
						</button>
					)
				}
			>
				<Trans>Application profile</Trans>
			</SectionHeading>
			<p className="pb-1.5 text-[13px]/[18px] text-ink-3">
				<Trans>
					Contact details and standard answers for job application forms, kept apart from your resumes. They're added to
					an application only when you choose to include them.
				</Trans>
			</p>
			<List>
				<ProfileRow label={t`Name`} value={name} onEdit={() => setEditing("name")} />
				<ProfileRow
					label={t`Application email`}
					value={data.email && <bdi dir="ltr">{data.email}</bdi>}
					onEdit={() => setEditing("email")}
				/>
				<ProfileRow
					label={t`Application phone`}
					value={data.phone && <bdi dir="ltr">{data.phone}</bdi>}
					onEdit={() => setEditing("phone")}
				/>
				<ProfileRow
					label={t`Address`}
					value={addressShown}
					note={addressShown ? addressGap && <>· {addressGap}</> : null}
					action={addressShown && !addressGap ? "edit" : "add"}
					onEdit={() => setEditing("address")}
				/>
				<ProfileRow
					label={t`Links`}
					value={
						firstLink && (
							<>
								{firstLink.label} ·{" "}
								<span dir="ltr" className="font-mono text-xs/4 font-medium">
									{hostOf(firstLink.url)}
								</span>
							</>
						)
					}
					note={moreLinks > 0 && plural(moreLinks, { one: "and # more", other: "and # more" })}
					onEdit={() => setEditing("links")}
				/>
			</List>

			<SectionHeading className="pt-7">
				<Trans>Standard answers</Trans>
			</SectionHeading>
			<List>
				<ProfileRow
					label={t`Work authorization`}
					value={firstCountry && country(firstCountry.countryCode)}
					note={
						firstCountry && (
							<>
								· {authorizationLine(firstCountry)}
								{moreCountries > 0 && <> · {plural(moreCountries, { one: "and # more", other: "and # more" })}</>}
							</>
						)
					}
					empty={<Trans>not answered</Trans>}
					action={firstCountry ? "edit" : "answer"}
					onEdit={() => setEditing("authorization")}
				/>
				<ProfileRow
					label={t`Relocation`}
					value={
						data.willingToRelocate === "yes"
							? t`Willing to relocate`
							: data.willingToRelocate === "no"
								? t`Not willing to relocate`
								: ""
					}
					empty={<Trans>Willing to relocate: not answered</Trans>}
					action={data.willingToRelocate === "unknown" ? "answer" : "edit"}
					onEdit={() => setEditing("relocation")}
				/>
				<ProfileRow
					label={t`Requested salary`}
					value={
						money &&
						(salary?.period === "hour"
							? t`${money} an hour`
							: salary?.period === "month"
								? t`${money} a month`
								: t`${money} a year`)
					}
					empty={<Trans>not answered</Trans>}
					action={money ? "edit" : "answer"}
					onEdit={() => setEditing("salary")}
				/>
			</List>

			<SectionHeading
				className="pt-7"
				note={data.references.length > 0 ? i18n.number(data.references.length) : undefined}
				action={
					data.references.length < 10 && (
						<button
							type="button"
							className="hover:underline"
							onClick={() => setEditing({ reference: data.references.length })}
						>
							<Trans>Add a reference</Trans>
						</button>
					)
				}
			>
				<Trans>References</Trans>
			</SectionHeading>
			{data.references.length === 0 ? (
				<p className="py-2 text-[13px]/[18px] text-ink-3">
					<Trans>People an employer can contact appear here.</Trans>
				</p>
			) : (
				<List>
					{data.references.map((row, index) => (
						<ProfileRow
							key={index}
							label={row.name}
							value={[row.relationship, row.company].filter(Boolean).join(", ")}
							note={<>· {referenceLine(row)}</>}
							empty={referenceLine(row)}
							action="edit"
							actionLabel={t`Edit ${row.name}`}
							onEdit={() => setEditing({ reference: index })}
						/>
					))}
				</List>
			)}

			{record && (
				<List cap className="mt-4">
					<ListRow
						render={<button type="button" disabled={busy} />}
						variant="danger"
						caret
						title={<Trans>Delete profile</Trans>}
						subtitle={
							<Trans>
								Removes these details and references. Career preferences, documents and answers already sent stay.
							</Trans>
						}
						className="[&>span.flex-col>span]:whitespace-normal"
						onClick={() => setDeleting(true)}
					/>
				</List>
			)}

			<Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
				{editing !== null && (
					<ProfileDialog
						// A fresh draft for each group.
						key={typeof editing === "object" ? `reference-${editing.reference}` : editing}
						group={editing}
						record={record}
						onSaved={(next) => {
							replace(next);
							setEditing(null);
						}}
					/>
				)}
			</Dialog>

			<AlertDialog open={deleting} onOpenChange={setDeleting}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							<Trans>Delete profile?</Trans>
						</AlertDialogTitle>
						<AlertDialogDescription>
							<Trans>
								This removes the saved profile and its references. Career preferences, documents and submitted answers
								stay unchanged. This cannot be undone.
							</Trans>
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel variant="ghost">
							<Trans>Keep profile</Trans>
						</AlertDialogCancel>
						<AlertDialogAction variant="danger" onClick={() => void remove()}>
							<Trans>Delete profile</Trans>
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}

type ProfileRowProps = {
	label: string;
	value: ReactNode;
	/** A quiet remark after the value: what is missing, how many more. */
	note?: ReactNode;
	/** What the row says with no value; "not added" when absent. */
	empty?: ReactNode;
	/** Defaults to Edit with a value and Add without one. */
	action?: "edit" | "add" | "answer";
	actionLabel?: string;
	onEdit: () => void;
};

/** One saved detail: its name, its value or what is missing, and the action that opens its dialog. */
function ProfileRow({ label, value, note, empty, action, actionLabel, onEdit }: ProfileRowProps) {
	const kind = action ?? (value ? "edit" : "add");
	const verb = kind === "edit" ? t`Edit` : kind === "add" ? t`Add` : t`Answer`;
	return (
		<ListRow
			className="min-h-12 py-1.5"
			trailing={
				<TextAction aria-label={actionLabel ?? t`${verb}: ${label}`} onClick={onEdit}>
					{verb}
				</TextAction>
			}
		>
			<span className="w-[168px] shrink-0 text-sm/5 [overflow-wrap:anywhere] text-ink-3 max-sm:w-24">{label}</span>
			<span className="min-w-0 flex-1 text-[15px]/[22px] [overflow-wrap:anywhere]">
				{value ? (
					<>
						<bdi>{value}</bdi>
						{note && (
							<>
								{" "}
								<small className="text-[13px]/[18px] text-ink-3">{note}</small>
							</>
						)}
					</>
				) : (
					<small className="text-[13px]/[18px] text-ink-3">{empty ?? <Trans>not added</Trans>}</small>
				)}
			</span>
		</ListRow>
	);
}

type ProfileDialogProps = { group: Group; record: Record; onSaved: (next: Record) => void };

/** One group of the profile in a dialog with its own Save. */
function ProfileDialog({ group, record, onSaved }: ProfileDialogProps) {
	const { i18n } = useLingui();
	const formId = useId();
	const [draft, setDraft] = useState(() => {
		const data = structuredClone(record?.data ?? empty());
		// A new reference starts as an empty block at the end of the list.
		if (typeof group === "object" && group.reference >= data.references.length)
			data.references.push({ name: "", relationship: "", company: "", email: "", phone: "" });
		return data;
	});
	const [amount, setAmount] = useState(() =>
		record?.data.requestedSalary?.amount == null
			? ""
			: new Intl.NumberFormat(i18n.locale, { maximumFractionDigits: 20 }).format(record.data.requestedSalary.amount),
	);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const patch = (value: Partial<ApplicationProfileData>) => setDraft((current) => ({ ...current, ...value }));
	const salary = draft.requestedSalary ?? { amount: null, currency: null, period: null };
	const salaryPatch = (value: Partial<typeof salary>) => patch({ requestedSalary: { ...salary, ...value } });
	const country = (code: string) => countryName(code, i18n.locale);
	const countries = SEARCH_REGION_CODES.map((code) => ({ value: code, label: country(code) }));
	const referenceIndex = typeof group === "object" ? group.reference : -1;
	const reference = draft.references[referenceIndex];
	const isNewReference = referenceIndex >= (record?.data.references.length ?? 0);

	const save = async (next: ApplicationProfileData = draft) => {
		if (busy) return;
		let candidate = next;
		if (group === "salary") {
			const parsedAmount = parseAmount(amount, i18n.locale);
			if (parsedAmount === undefined) return setError(t`Enter the amount as a number.`);
			candidate = {
				...next,
				requestedSalary:
					parsedAmount === null && !salary.currency && !salary.period ? null : { ...salary, amount: parsedAmount },
			};
		}
		// Only this group's parts are written over the saved profile.
		const merged = { ...(record?.data ?? empty()) };
		for (const key of groupKeys(group)) Object.assign(merged, { [key]: candidate[key] });
		const parsed = applicationProfileDataSchema.safeParse(merged);
		if (!parsed.success)
			return setError(
				t`Check email addresses, links, names, countries and salary. A salary amount needs currency and pay period.`,
			);
		setBusy(true);
		setError("");
		try {
			onSaved(await client.applicationProfile.save({ data: parsed.data, expectedRevision: record?.revision ?? null }));
		} catch {
			setError(t`Couldn't save. If another device changed the profile, reload the page and try again.`);
		} finally {
			setBusy(false);
		}
	};

	const title =
		typeof group === "object"
			? isNewReference
				? t`Add a reference`
				: t`Edit reference`
			: {
					name: t`Name`,
					email: t`Application email`,
					phone: t`Application phone`,
					address: t`Address`,
					links: t`Links`,
					authorization: t`Work authorization`,
					relocation: t`Relocation`,
					salary: t`Requested salary`,
				}[group];

	const text = (
		label: string,
		value: string,
		onChange: (next: string) => void,
		options: { maxLength?: number; type?: string | undefined; autoComplete?: string; className?: string } = {},
	) => (
		<ProfileField
			key={label}
			label={label}
			value={value}
			onChange={onChange}
			maxLength={options.maxLength ?? 200}
			type={options.type}
			autoComplete={options.autoComplete}
			className={options.className}
		/>
	);

	return (
		<DialogContent
			closeLabel={t`Close`}
			className={group === "address" || referenceIndex >= 0 ? "sm:max-w-[560px]" : undefined}
		>
			<DialogHeader>
				<DialogTitle>{title}</DialogTitle>
				<DialogDescription>
					<Trans>Used only when you include it in an employer-form packet.</Trans>
				</DialogDescription>
			</DialogHeader>
			<form
				id={formId}
				noValidate
				className="grid gap-4"
				onSubmit={(event) => {
					event.preventDefault();
					void save();
				}}
			>
				{group === "name" && (
					<div className="grid gap-3 sm:grid-cols-2">
						{text(t`Given name`, draft.givenName, (givenName) => patch({ givenName }), { autoComplete: "given-name" })}
						{text(t`Family name`, draft.familyName, (familyName) => patch({ familyName }), {
							autoComplete: "family-name",
						})}
					</div>
				)}
				{group === "email" &&
					text(t`Application email`, draft.email, (email) => patch({ email }), {
						maxLength: 320,
						type: "email",
						autoComplete: "email",
					})}
				{group === "phone" &&
					text(t`Application phone`, draft.phone, (phone) => patch({ phone }), { type: "tel", autoComplete: "tel" })}
				{group === "address" && (
					<div className="grid gap-3 sm:grid-cols-2">
						{(
							[
								["line1", t`Address line 1`, "sm:col-span-2"],
								["line2", t`Address line 2`, "sm:col-span-2"],
								["city", t`City`, ""],
								["region", t`State or region`, ""],
								["postalCode", t`Postal code`, ""],
							] as const
						).map(([key, label, className]) =>
							text(label, draft.address[key], (value) => patch({ address: { ...draft.address, [key]: value } }), {
								className,
							}),
						)}
						<ProfileSelect
							label={t`Address country`}
							value={draft.address.countryCode ?? ""}
							options={[{ value: "", label: t`Unknown` }, ...countries]}
							onChange={(countryCode) => patch({ address: { ...draft.address, countryCode: countryCode || null } })}
						/>
					</div>
				)}
				{group === "links" && (
					<>
						{draft.links.map((link, index) => (
							<fieldset key={index} className="grid min-w-0 gap-3 border-b border-line pb-4">
								<legend className="sr-only">
									<Trans>Link {i18n.number(index + 1)}</Trans>
								</legend>
								<div className="flex items-end gap-2">
									{text(
										t`Link ${i18n.number(index + 1)} label`,
										link.label,
										(label) => patch({ links: draft.links.map((row, i) => (i === index ? { ...row, label } : row)) }),
										{ className: "flex-1" },
									)}
									<Button
										type="button"
										variant="ghost"
										size="icon"
										aria-label={t`Remove link ${i18n.number(index + 1)}`}
										onClick={() => patch({ links: draft.links.filter((_, i) => i !== index) })}
									>
										<Icon name="x" />
									</Button>
								</div>
								{text(
									t`Link ${i18n.number(index + 1)} URL`,
									link.url,
									(url) => patch({ links: draft.links.map((row, i) => (i === index ? { ...row, url } : row)) }),
									{ maxLength: 2000, type: "url" },
								)}
							</fieldset>
						))}
						{draft.links.length < 20 && (
							<AddLine onClick={() => patch({ links: [...draft.links, { label: "", url: "" }] })}>
								<Trans>Add link</Trans>
							</AddLine>
						)}
					</>
				)}
				{group === "authorization" && (
					<>
						{draft.workAuthorization.map((row, index) => {
							const name = country(row.countryCode);
							const set = (value: Partial<typeof row>) =>
								patch({
									workAuthorization: draft.workAuthorization.map((item, i) =>
										i === index ? { ...item, ...value } : item,
									),
								});
							return (
								<fieldset key={row.countryCode} className="grid min-w-0 gap-2 border-b border-line pb-4">
									<div className="flex items-center justify-between gap-2">
										<legend className="float-start text-[15px]/[22px] font-semibold">{name}</legend>
										<Button
											type="button"
											variant="ghost"
											size="icon-sm"
											aria-label={t`Remove ${name}`}
											onClick={() =>
												patch({ workAuthorization: draft.workAuthorization.filter((_, i) => i !== index) })
											}
										>
											<Icon name="x" />
										</Button>
									</div>
									<AnswerRow
										label={<Trans>Authorized to work here</Trans>}
										name={t`Authorized to work in ${name}`}
										value={row.authorized}
										onChange={(authorized) => set({ authorized })}
									/>
									<AnswerRow
										label={<Trans>Needs sponsorship</Trans>}
										name={t`Needs sponsorship in ${name}`}
										value={row.needsSponsorship}
										onChange={(needsSponsorship) => set({ needsSponsorship })}
									/>
								</fieldset>
							);
						})}
						{draft.workAuthorization.length < 50 && (
							<ProfileSelect
								label={t`Add a country`}
								value=""
								options={[
									{ value: "", label: t`Choose a country` },
									...countries.filter(
										(option) => !draft.workAuthorization.some((row) => row.countryCode === option.value),
									),
								]}
								onChange={(countryCode) => {
									if (countryCode)
										patch({
											workAuthorization: [
												...draft.workAuthorization,
												{ countryCode, authorized: "unknown", needsSponsorship: "unknown" },
											],
										});
								}}
							/>
						)}
					</>
				)}
				{group === "relocation" && (
					<AnswerRow
						label={<Trans>Willing to relocate</Trans>}
						name={t`Willing to relocate`}
						value={draft.willingToRelocate}
						onChange={(willingToRelocate) => patch({ willingToRelocate })}
					/>
				)}
				{group === "salary" && (
					<div className="grid gap-3 sm:grid-cols-3">
						{text(t`Requested amount`, amount, setAmount)}
						<ProfileSelect
							label={t`Currency`}
							value={salary.currency ?? ""}
							options={[
								{ value: "", label: t`Unknown` },
								...Intl.supportedValuesOf("currency").map((value) => ({ value, label: value })),
							]}
							onChange={(currency) => salaryPatch({ currency: currency || null })}
						/>
						<ProfileSelect
							label={t`Pay period`}
							value={salary.period ?? ""}
							options={[
								{ value: "", label: t`Unknown` },
								{ value: "hour", label: t`Hour` },
								{ value: "month", label: t`Month` },
								{ value: "year", label: t`Year` },
							]}
							onChange={(period) => salaryPatch({ period: period ? (period as "hour" | "month" | "year") : null })}
						/>
					</div>
				)}
				{reference && (
					<div className="grid gap-3 sm:grid-cols-2">
						{(
							[
								["name", t`Name`, "sm:col-span-2"],
								["relationship", t`Relationship`, ""],
								["company", t`Company`, ""],
								["email", t`Email`, ""],
								["phone", t`Phone`, ""],
							] as const
						).map(([key, label, className]) =>
							text(
								label,
								reference[key],
								(value) =>
									patch({
										references: draft.references.map((item, i) =>
											i === referenceIndex ? { ...item, [key]: value } : item,
										),
									}),
								{ maxLength: key === "email" ? 320 : 200, className, type: key === "email" ? "email" : undefined },
							),
						)}
					</div>
				)}
				{error && (
					<p role="alert" className="text-[13px]/[18px] text-danger-text">
						{error}
					</p>
				)}
			</form>
			<DialogFooter>
				{reference && !isNewReference && (
					<Button
						type="button"
						variant="danger-text"
						className="sm:me-auto"
						disabled={busy}
						onClick={() => void save({ ...draft, references: draft.references.filter((_, i) => i !== referenceIndex) })}
					>
						<Trans>Remove reference</Trans>
					</Button>
				)}
				<DialogClose render={<Button type="button" variant="ghost" />}>
					<Trans>Cancel</Trans>
				</DialogClose>
				<Button type="submit" form={formId} loading={busy}>
					<Trans>Save</Trans>
				</Button>
			</DialogFooter>
		</DialogContent>
	);
}

type AddLineProps = { onClick: () => void; children: ReactNode };

/** "Add a …" at the foot of a list inside a dialog. */
function AddLine({ onClick, children }: AddLineProps) {
	return (
		<TextAction type="button" className="justify-self-start" onClick={onClick}>
			<Icon name="plus" />
			{children}
		</TextAction>
	);
}

type AnswerRowProps = { label: ReactNode; name: string; value: Answer; onChange: (value: Answer) => void };

/** A yes, no or unknown answer: the question on the left, the three choices at the end. */
function AnswerRow({ label, name, value, onChange }: AnswerRowProps) {
	return (
		<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
			<span className="text-sm/5">{label}</span>
			<SegmentedControl aria-label={name} value={value} onValueChange={(next) => onChange(next as Answer)}>
				<SegmentedControlItem value="yes">
					<Trans>Yes</Trans>
				</SegmentedControlItem>
				<SegmentedControlItem value="no">
					<Trans>No</Trans>
				</SegmentedControlItem>
				<SegmentedControlItem value="unknown">
					<Trans>Unknown</Trans>
				</SegmentedControlItem>
			</SegmentedControl>
		</div>
	);
}

type ProfileFieldProps = {
	label: string;
	value: string;
	onChange: (value: string) => void;
	maxLength: number;
	type?: string | undefined;
	autoComplete?: string | undefined;
	className?: string | undefined;
};
function ProfileField({ label, value, onChange, maxLength, type, autoComplete, className }: ProfileFieldProps) {
	const id = useId();
	return (
		<div className={cn("grid min-w-0 gap-1.5", className)}>
			<Label htmlFor={id}>{label}</Label>
			<Input
				id={id}
				type={type ?? "text"}
				value={value}
				maxLength={maxLength}
				autoComplete={autoComplete}
				onChange={(event) => onChange(event.target.value)}
			/>
		</div>
	);
}
type ProfileSelectProps = {
	label: string;
	value: string;
	options: { value: string; label: string }[];
	onChange: (value: string) => void;
};
function ProfileSelect({ label, value, options, onChange }: ProfileSelectProps) {
	const id = useId();
	return (
		<div className="grid min-w-0 gap-1.5">
			<Label htmlFor={id}>{label}</Label>
			<NativeSelect id={id} value={value} onChange={(event) => onChange(event.target.value)}>
				{options.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</NativeSelect>
		</div>
	);
}
