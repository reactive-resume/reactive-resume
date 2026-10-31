import type { RouterOutput } from "@/libs/orpc/client";
import type { ApplicationProfileData } from "@reactive-resume/schema/application-profile";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
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
import { Input } from "@reactive-resume/ui/components/input";
import { parseAmount } from "@reactive-resume/utils/amount";
import { downloadWithAnchor } from "@reactive-resume/utils/file";
import { countryName, SEARCH_REGION_CODES } from "@reactive-resume/utils/region";
import { SettingsSection } from "../section";
import { client, orpc } from "@/libs/orpc/client";

type Record = RouterOutput["applicationProfile"]["get"];
const empty = () => applicationProfileDataSchema.parse({});

export function ApplicationProfileSection() {
	const query = useQuery(orpc.applicationProfile.get.queryOptions());
	return (
		<SettingsSection
			title={<Trans>Private application profile</Trans>}
			description={
				<Trans>
					Application-only details. Never added to public links, document exports or AI context automatically.
				</Trans>
			}
		>
			{query.isPending ? (
				<p role="status">
					<Trans>Loading…</Trans>
				</p>
			) : query.isError && query.data === undefined ? (
				<Button onClick={() => void query.refetch()}>
					<Trans>Couldn't load. Try again.</Trans>
				</Button>
			) : (
				<ApplicationProfileForm initial={query.data ?? null} />
			)}
		</SettingsSection>
	);
}

type ApplicationProfileFormProps = { initial: Record };
function ApplicationProfileForm({ initial }: ApplicationProfileFormProps) {
	const { i18n } = useLingui();
	const queryClient = useQueryClient();
	const [record, setRecord] = useState(initial);
	const [draft, setDraft] = useState(initial?.data ?? empty);
	const [amount, setAmount] = useState(
		initial?.data.requestedSalary?.amount === null || initial?.data.requestedSalary?.amount === undefined
			? ""
			: new Intl.NumberFormat(i18n.locale, { maximumFractionDigits: 20 }).format(initial.data.requestedSalary.amount),
	);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [status, setStatus] = useState("");
	const [deleting, setDeleting] = useState(false);
	const patch = (value: Partial<ApplicationProfileData>) => setDraft({ ...draft, ...value });
	const salary = draft.requestedSalary ?? { amount: null, currency: null, period: null };
	const salaryPatch = (value: Partial<typeof salary>) => patch({ requestedSalary: { ...salary, ...value } });
	const replace = (next: Record) => {
		setRecord(next);
		setDraft(next?.data ?? empty());
		setAmount(
			next?.data.requestedSalary?.amount == null
				? ""
				: new Intl.NumberFormat(i18n.locale, { maximumFractionDigits: 20 }).format(next.data.requestedSalary.amount),
		);
		queryClient.setQueryData(orpc.applicationProfile.get.queryKey(), next);
	};
	const run = async (action: () => Promise<void>) => {
		if (busy) return;
		setBusy(true);
		setError("");
		setStatus("");
		try {
			await action();
		} catch {
			setError(
				t`Couldn't complete this action. Your draft is kept. If another device changed the profile, reload the saved profile before trying again.`,
			);
		} finally {
			setBusy(false);
		}
	};
	const save = () => {
		const parsedAmount = parseAmount(amount, i18n.locale);
		const parsed = applicationProfileDataSchema.safeParse({
			...draft,
			requestedSalary: draft.requestedSalary || amount.trim() ? { ...salary, amount: parsedAmount } : null,
		});
		if (parsedAmount === undefined || !parsed.success) {
			setError(
				t`Check email addresses, links, names, countries and salary. A salary amount needs currency and pay period.`,
			);
			return;
		}
		void run(async () => {
			replace(await client.applicationProfile.save({ data: parsed.data, expectedRevision: record?.revision ?? null }));
			setStatus(t`Saved and marked reviewed.`);
		});
	};
	const field = (label: string, value: string, onChange: (next: string) => void, maxLength = 200) => (
		<ProfileField key={label} label={label} value={value} onChange={onChange} maxLength={maxLength} />
	);
	const countries = [
		{ value: "", label: t`Unknown` },
		...SEARCH_REGION_CODES.map((code) => ({ value: code, label: countryName(code, i18n.locale) })),
	];
	const answers = [
		{ value: "unknown", label: t`Unknown` },
		{ value: "yes", label: t`Yes` },
		{ value: "no", label: t`No` },
	];
	return (
		<div className="grid gap-4" id="application-profile">
			<p className="text-sm text-ink-3">
				<Trans>
					Blank fields mean unknown. Nothing is inferred from your resume. Self-identification is not collected here.
					Enter references yourself and review their details before sharing.
				</Trans>
			</p>
			<p className="text-sm text-ink-3">
				<Trans>
					Use Career preferences for work locations, office days, notice period and minimum base salary. Requested
					salary below is separate. Editing answers for one application does not update these global settings.
				</Trans>{" "}
				<Link to="/dashboard/career/knowledge/preferences" className="underline">
					<Trans>Career preferences</Trans>
				</Link>
			</p>
			<p className="text-sm">
				{record
					? t`Last reviewed: ${i18n.date(new Date(record.reviewedAt), { dateStyle: "medium", timeStyle: "short" })}`
					: t`Not reviewed yet`}
			</p>
			<fieldset aria-label={t`Private application profile`} disabled={busy} className="grid gap-4">
				<h3 className="font-semibold">
					<Trans>Contact and address</Trans>
				</h3>
				<div className="grid gap-3 sm:grid-cols-2">
					{field(t`Given name`, draft.givenName, (givenName) => patch({ givenName }))}
					{field(t`Family name`, draft.familyName, (familyName) => patch({ familyName }))}
					{field(t`Application email`, draft.email, (email) => patch({ email }), 320)}
					{field(t`Application phone`, draft.phone, (phone) => patch({ phone }))}
					{Object.entries({
						line1: t`Address line 1`,
						line2: t`Address line 2`,
						city: t`City`,
						region: t`State or region`,
						postalCode: t`Postal code`,
					}).map(([key, label]) =>
						field(label, draft.address[key as keyof Omit<typeof draft.address, "countryCode">], (value) =>
							patch({ address: { ...draft.address, [key]: value } }),
						),
					)}
					<ProfileSelect
						label={t`Address country`}
						value={draft.address.countryCode ?? ""}
						options={countries}
						onChange={(countryCode) => patch({ address: { ...draft.address, countryCode: countryCode || null } })}
					/>
				</div>
				<h3 className="font-semibold">
					<Trans>Links</Trans>
				</h3>
				{draft.links.map((link, index) => (
					<div key={index} className="grid gap-2 rounded-md border border-line p-3">
						{field(t`Link ${index + 1} label`, link.label, (label) =>
							patch({ links: draft.links.map((row, i) => (i === index ? { ...row, label } : row)) }),
						)}
						{field(
							t`Link ${index + 1} URL`,
							link.url,
							(url) => patch({ links: draft.links.map((row, i) => (i === index ? { ...row, url } : row)) }),
							2000,
						)}
						<Button variant="ghost" onClick={() => patch({ links: draft.links.filter((_, i) => i !== index) })}>
							<Trans>Remove link {index + 1}</Trans>
						</Button>
					</div>
				))}
				<Button
					variant="secondary"
					disabled={draft.links.length >= 20}
					onClick={() => patch({ links: [...draft.links, { label: "", url: "" }] })}
				>
					<Trans>Add link</Trans>
				</Button>
				<h3 className="font-semibold">
					<Trans>Work authorization and sponsorship</Trans>
				</h3>
				<p className="text-sm text-ink-3">
					<Trans>Answers apply only to the country shown. A missing country has unknown answers.</Trans>
				</p>
				{draft.workAuthorization.map((row, index) => (
					<div key={row.countryCode} className="grid gap-2 rounded-md border border-line p-3">
						<h4 className="font-medium">{countryName(row.countryCode, i18n.locale)}</h4>
						<ProfileSelect
							label={t`Authorized to work in ${countryName(row.countryCode, i18n.locale)}`}
							value={row.authorized}
							options={answers}
							onChange={(value) =>
								patch({
									workAuthorization: draft.workAuthorization.map((item, i) =>
										i === index ? { ...item, authorized: value as typeof row.authorized } : item,
									),
								})
							}
						/>
						<ProfileSelect
							label={t`Needs sponsorship in ${countryName(row.countryCode, i18n.locale)}`}
							value={row.needsSponsorship}
							options={answers}
							onChange={(value) =>
								patch({
									workAuthorization: draft.workAuthorization.map((item, i) =>
										i === index ? { ...item, needsSponsorship: value as typeof row.needsSponsorship } : item,
									),
								})
							}
						/>
						<Button
							variant="ghost"
							onClick={() => patch({ workAuthorization: draft.workAuthorization.filter((_, i) => i !== index) })}
						>
							<Trans>Remove {countryName(row.countryCode, i18n.locale)}</Trans>
						</Button>
					</div>
				))}
				<ProfileSelect
					label={t`Add authorization country`}
					value=""
					options={[
						{ value: "", label: t`Choose a country` },
						...countries.filter(
							(country) => country.value && !draft.workAuthorization.some((row) => row.countryCode === country.value),
						),
					]}
					onChange={(countryCode) => {
						if (countryCode && draft.workAuthorization.length < 50)
							patch({
								workAuthorization: [
									...draft.workAuthorization,
									{ countryCode, authorized: "unknown", needsSponsorship: "unknown" },
								],
							});
					}}
				/>
				<ProfileSelect
					label={t`Willing to relocate`}
					value={draft.willingToRelocate}
					options={answers}
					onChange={(value) => patch({ willingToRelocate: value as ApplicationProfileData["willingToRelocate"] })}
				/>
				<h3 className="font-semibold">
					<Trans>Requested salary</Trans>
				</h3>
				{field(t`Requested amount`, amount, setAmount)}
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
				<h3 className="font-semibold">
					<Trans>References</Trans>
				</h3>
				{draft.references.map((row, index) => (
					<div key={index} className="grid gap-2 rounded-md border border-line p-3">
						{Object.entries({
							name: t`Reference name`,
							relationship: t`Relationship`,
							company: t`Company`,
							email: t`Reference email`,
							phone: t`Reference phone`,
						}).map(([key, label]) =>
							field(
								t`Reference ${index + 1}: ${label}`,
								row[key as keyof typeof row],
								(value) =>
									patch({
										references: draft.references.map((item, i) => (i === index ? { ...item, [key]: value } : item)),
									}),
								key === "email" ? 320 : 200,
							),
						)}
						<Button
							variant="ghost"
							onClick={() => patch({ references: draft.references.filter((_, i) => i !== index) })}
						>
							<Trans>Remove reference {index + 1}</Trans>
						</Button>
					</div>
				))}
				<Button
					variant="secondary"
					disabled={draft.references.length >= 10}
					onClick={() =>
						patch({
							references: [...draft.references, { name: "", relationship: "", company: "", email: "", phone: "" }],
						})
					}
				>
					<Trans>Add reference</Trans>
				</Button>
			</fieldset>
			{error && (
				<p role="alert" className="text-sm text-danger-text">
					{error}
				</p>
			)}
			<p role="status" className="text-sm">
				{status}
			</p>
			<div className="flex flex-wrap gap-2">
				<Button loading={busy} onClick={save}>
					<Trans>Save and mark reviewed</Trans>
				</Button>
				<Button
					variant="secondary"
					disabled={busy}
					onClick={() =>
						void run(async () => {
							replace(await client.applicationProfile.get());
							setStatus(t`Saved profile reloaded. Unsaved changes discarded.`);
						})
					}
				>
					<Trans>Reload and discard unsaved changes</Trans>
				</Button>
				<Button
					variant="secondary"
					disabled={busy || !record}
					onClick={() =>
						void run(async () => {
							const data = await client.applicationProfile.get();
							if (!data) throw new Error("Profile deleted");
							downloadWithAnchor(
								new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
								"application-profile.json",
							);
						})
					}
				>
					<Trans>Export saved profile</Trans>
				</Button>
				<Button variant="danger" disabled={busy || !record} onClick={() => setDeleting(true)}>
					<Trans>Delete profile</Trans>
				</Button>
			</div>
			<AlertDialog open={deleting} onOpenChange={setDeleting}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							<Trans>Delete private application profile?</Trans>
						</AlertDialogTitle>
						<AlertDialogDescription>
							<Trans>
								This removes the saved profile and its references. Career preferences, documents and submitted answers
								stay unchanged. This cannot be undone.
							</Trans>
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>
							<Trans>Cancel</Trans>
						</AlertDialogCancel>
						<AlertDialogAction
							variant="danger"
							onClick={() => {
								setDeleting(false);
								if (record)
									void run(async () => {
										await client.applicationProfile.delete({ expectedRevision: record.revision });
										replace(null);
										setStatus(t`Application profile deleted.`);
									});
							}}
						>
							<Trans>Delete profile</Trans>
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}

type ProfileFieldProps = { label: string; value: string; onChange: (value: string) => void; maxLength: number };
function ProfileField({ label, value, onChange, maxLength }: ProfileFieldProps) {
	const id = useId();
	return (
		<div className="grid gap-1">
			<label htmlFor={id} className="text-sm">
				{label}
			</label>
			<Input id={id} value={value} maxLength={maxLength} onChange={(event) => onChange(event.target.value)} />
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
		<div className="grid gap-1">
			<label htmlFor={id} className="text-sm">
				{label}
			</label>
			<select
				id={id}
				className="min-h-11 w-full rounded-md border border-line bg-raised px-3 text-sm"
				value={value}
				onChange={(event) => onChange(event.target.value)}
			>
				{options.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</select>
		</div>
	);
}
