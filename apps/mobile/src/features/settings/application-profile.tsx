import type { RouterOutput } from "@/api/client";
import type { ApplicationProfileData } from "@reactive-resume/schema/application-profile";
import { useLingui } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { File, Paths } from "expo-file-system";
import { useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import { useState } from "react";
import { View } from "react-native";
import { applicationProfileDataSchema } from "@reactive-resume/schema/application-profile";
import { parseAmount } from "@reactive-resume/utils/amount";
import { countryName, SEARCH_REGION_CODES } from "@reactive-resume/utils/region";
import { clearAccountExportCache } from "./export-cache";
import { SettingsGroup } from "./layout";
import { client, orpc } from "@/api/client";
import { getAccountScope, useSession } from "@/auth/session";
import { routes } from "@/routes";
import { Banner, Button, ConfirmDialog, SelectSheet, Text, TextField, useTheme } from "@/ui";

type Record = RouterOutput["applicationProfile"]["get"];
const empty = () => applicationProfileDataSchema.parse({});

export function ApplicationProfileSection() {
	const { t } = useLingui();
	const session = useSession();
	const scope = getAccountScope();
	const query = useQuery({
		...orpc.applicationProfile.get.queryOptions(),
		queryKey: [...orpc.applicationProfile.get.key(), scope],
		enabled: session.status === "signed-in" && !!scope,
	});
	if (!scope) return null;
	return (
		<SettingsGroup
			title={t`Private application profile`}
			note={t`Application-only details. Never added to public links, document exports or AI context automatically.`}
		>
			{query.isPending ? (
				<Text>{t`Loading…`}</Text>
			) : query.isError && query.data === undefined ? (
				<Banner
					tone="danger"
					message={t`Couldn't load. Try again.`}
					action={{ label: t`Retry`, onPress: () => void query.refetch() }}
				/>
			) : (
				<ApplicationProfileForm key={scope} initial={query.data ?? null} scope={scope} />
			)}
		</SettingsGroup>
	);
}

type ApplicationProfileFormProps = { initial: Record; scope: string };
function ApplicationProfileForm({ initial, scope }: ApplicationProfileFormProps) {
	const { t, i18n } = useLingui();
	const router = useRouter();
	const { space } = useTheme();
	const queryClient = useQueryClient();
	const [record, setRecord] = useState(initial);
	const [draft, setDraft] = useState(initial?.data ?? empty);
	const [amount, setAmount] = useState(
		initial?.data.requestedSalary?.amount == null
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
		if (getAccountScope() !== scope) return;
		setRecord(next);
		setDraft(next?.data ?? empty());
		setAmount(
			next?.data.requestedSalary?.amount == null
				? ""
				: new Intl.NumberFormat(i18n.locale, { maximumFractionDigits: 20 }).format(next.data.requestedSalary.amount),
		);
		queryClient.setQueryData([...orpc.applicationProfile.get.key(), scope], next);
	};
	const options = { context: { scope } };
	const run = async (action: () => Promise<void>) => {
		if (busy || getAccountScope() !== scope) return;
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
			replace(
				await client.applicationProfile.save(
					{ data: parsed.data, expectedRevision: record?.revision ?? null },
					options,
				),
			);
			setStatus(t`Saved and marked reviewed.`);
		});
	};
	const field = (label: string, value: string, onChangeText: (next: string) => void, maxLength = 200) => (
		<TextField
			key={label}
			label={label}
			value={value}
			onChangeText={onChangeText}
			maxLength={maxLength}
			editable={!busy}
		/>
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
		<View style={{ gap: space.s3 }}>
			<Text color="ink3">{t`Blank fields mean unknown. Nothing is inferred from your resume. Self-identification is not collected here. Enter references yourself and review their details before sharing.`}</Text>
			<Text color="ink3">{t`Use Career preferences for work locations, office days, notice period and minimum base salary. Requested salary below is separate. Editing answers for one application does not update these global settings.`}</Text>
			<Button
				variant="secondary"
				label={t`Career preferences`}
				onPress={() => router.push({ pathname: routes.career("knowledge"), params: { tab: "preferences" } })}
			/>
			<Text>
				{record
					? t`Last reviewed: ${i18n.date(new Date(record.reviewedAt), { dateStyle: "medium", timeStyle: "short" })}`
					: t`Not reviewed yet`}
			</Text>
			<Text variant="heading" accessibilityRole="header">{t`Contact and address`}</Text>
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
			<SelectSheet
				label={t`Address country`}
				value={draft.address.countryCode ?? ""}
				options={countries}
				disabled={busy}
				searchable
				onChange={(countryCode) => patch({ address: { ...draft.address, countryCode: countryCode || null } })}
			/>
			<Text variant="heading" accessibilityRole="header">{t`Links`}</Text>
			{draft.links.map((link, index) => (
				<View key={index} style={{ gap: space.s2 }}>
					{field(t`Link ${index + 1} label`, link.label, (label) =>
						patch({ links: draft.links.map((row, i) => (i === index ? { ...row, label } : row)) }),
					)}
					{field(
						t`Link ${index + 1} URL`,
						link.url,
						(url) => patch({ links: draft.links.map((row, i) => (i === index ? { ...row, url } : row)) }),
						2000,
					)}
					<Button
						variant="ghost"
						label={t`Remove link ${index + 1}`}
						disabled={busy}
						onPress={() => patch({ links: draft.links.filter((_, i) => i !== index) })}
					/>
				</View>
			))}
			<Button
				variant="secondary"
				label={t`Add link`}
				disabled={busy || draft.links.length >= 20}
				onPress={() => patch({ links: [...draft.links, { label: "", url: "" }] })}
			/>
			<Text variant="heading" accessibilityRole="header">{t`Work authorization and sponsorship`}</Text>
			<Text color="ink3">{t`Answers apply only to the country shown. A missing country has unknown answers.`}</Text>
			{draft.workAuthorization.map((row, index) => (
				<View key={row.countryCode} style={{ gap: space.s2 }}>
					<Text>{countryName(row.countryCode, i18n.locale)}</Text>
					<SelectSheet
						label={t`Authorized to work in ${countryName(row.countryCode, i18n.locale)}`}
						value={row.authorized}
						options={answers}
						disabled={busy}
						onChange={(value) =>
							patch({
								workAuthorization: draft.workAuthorization.map((item, i) =>
									i === index ? { ...item, authorized: value as typeof row.authorized } : item,
								),
							})
						}
					/>
					<SelectSheet
						label={t`Needs sponsorship in ${countryName(row.countryCode, i18n.locale)}`}
						value={row.needsSponsorship}
						options={answers}
						disabled={busy}
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
						label={t`Remove ${countryName(row.countryCode, i18n.locale)}`}
						disabled={busy}
						onPress={() => patch({ workAuthorization: draft.workAuthorization.filter((_, i) => i !== index) })}
					/>
				</View>
			))}
			<SelectSheet
				label={t`Add authorization country`}
				value=""
				options={[
					{ value: "", label: t`Choose a country` },
					...countries.filter(
						(country) => country.value && !draft.workAuthorization.some((row) => row.countryCode === country.value),
					),
				]}
				disabled={busy || draft.workAuthorization.length >= 50}
				searchable
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
			<SelectSheet
				label={t`Willing to relocate`}
				value={draft.willingToRelocate}
				options={answers}
				disabled={busy}
				onChange={(value) => patch({ willingToRelocate: value as ApplicationProfileData["willingToRelocate"] })}
			/>
			<Text variant="heading" accessibilityRole="header">{t`Requested salary`}</Text>
			{field(t`Requested amount`, amount, setAmount)}
			<TextField
				label={t`Currency`}
				value={salary.currency ?? ""}
				maxLength={3}
				autoCapitalize="characters"
				autoCorrect={false}
				editable={!busy}
				helper={t`Enter a three-letter currency code.`}
				onChangeText={(currency) => salaryPatch({ currency: currency.toUpperCase() || null })}
			/>
			<SelectSheet
				label={t`Pay period`}
				value={salary.period ?? ""}
				options={[
					{ value: "", label: t`Unknown` },
					{ value: "hour", label: t`Hour` },
					{ value: "month", label: t`Month` },
					{ value: "year", label: t`Year` },
				]}
				disabled={busy}
				onChange={(period) => salaryPatch({ period: period ? (period as "hour" | "month" | "year") : null })}
			/>
			<Text variant="heading" accessibilityRole="header">{t`References`}</Text>
			{draft.references.map((row, index) => (
				<View key={index} style={{ gap: space.s2 }}>
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
						label={t`Remove reference ${index + 1}`}
						disabled={busy}
						onPress={() => patch({ references: draft.references.filter((_, i) => i !== index) })}
					/>
				</View>
			))}
			<Button
				variant="secondary"
				label={t`Add reference`}
				disabled={busy || draft.references.length >= 10}
				onPress={() =>
					patch({
						references: [...draft.references, { name: "", relationship: "", company: "", email: "", phone: "" }],
					})
				}
			/>
			{error ? <Banner tone="danger" message={error} /> : null}
			<Text accessibilityLiveRegion="polite">{status}</Text>
			<Button label={t`Save and mark reviewed`} loading={busy} onPress={save} />
			<Button
				variant="secondary"
				label={t`Reload and discard unsaved changes`}
				disabled={busy}
				onPress={() =>
					void run(async () => {
						replace(await client.applicationProfile.get(undefined, options));
						setStatus(t`Saved profile reloaded. Unsaved changes discarded.`);
					})
				}
			/>
			<Button
				variant="secondary"
				label={t`Export saved profile`}
				disabled={busy || !record}
				onPress={() =>
					void run(async () => {
						clearAccountExportCache();
						if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing unavailable");
						const data = await client.applicationProfile.get(undefined, options);
						if (!data) throw new Error("Profile deleted");
						if (getAccountScope() !== scope) return;
						const file = new File(Paths.cache, `application-profile-${Date.now()}.json`);
						await file.write(`${JSON.stringify(data, null, 2)}\n`);
						if (getAccountScope() !== scope) {
							file.delete();
							return;
						}
						await Sharing.shareAsync(file.uri, {
							mimeType: "application/json",
							UTI: "public.json",
							dialogTitle: t`Export saved profile`,
						});
					})
				}
			/>
			<Button variant="danger" label={t`Delete profile`} disabled={busy || !record} onPress={() => setDeleting(true)} />
			<ConfirmDialog
				open={deleting}
				title={t`Delete private application profile?`}
				message={t`This removes the saved profile and its references. Career preferences, documents and submitted answers stay unchanged. This cannot be undone.`}
				confirmLabel={t`Delete profile`}
				destructive
				onCancel={() => setDeleting(false)}
				onConfirm={() => {
					setDeleting(false);
					if (record)
						void run(async () => {
							await client.applicationProfile.delete({ expectedRevision: record.revision }, options);
							replace(null);
							clearAccountExportCache();
							setStatus(t`Application profile deleted.`);
						});
				}}
			/>
		</View>
	);
}
