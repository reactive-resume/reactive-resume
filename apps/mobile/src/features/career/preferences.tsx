import type { RouterOutput } from "@/api/client";
import type { CareerProfileData } from "@reactive-resume/schema/career";
import { useLingui } from "@lingui/react/macro";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AppState, View } from "react-native";
import { careerProfileDataSchema } from "@reactive-resume/schema/career";
import { parseAmount } from "@reactive-resume/utils/amount";
import { useCareerTime } from "./hooks";
import { RoleSuggestions } from "./role-suggestions";
import { SearchRegionsField } from "./search-regions-field";
import { client, orpc } from "@/api/client";
import { getServer, useSession } from "@/auth/session";
import { useDraft } from "@/features/workspace/hooks";
import { routes } from "@/routes";
import { Banner, Button, ChipInput, SelectSheet, Text, TextArea, TextField, useTheme } from "@/ui";

type PreferencesProps = { initial: CareerProfileData };
export function Preferences({ initial }: PreferencesProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const { locale, timeZone, profile: account } = useCareerTime();
	const router = useRouter();
	const session = useSession();
	const queryClient = useQueryClient();
	const kept = useDraft(
		"preferences",
		{
			draft: initial,
			amount:
				initial.minBase.amount === null
					? ""
					: new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(initial.minBase.amount),
			notice: initial.noticeWeeks === null ? "" : String(initial.noticeWeeks),
		},
		true,
	);
	const draft = kept.value.draft;
	const setDraft = (update: CareerProfileData | ((value: CareerProfileData) => CareerProfileData)) =>
		kept.setValue((current) => ({ ...current, draft: typeof update === "function" ? update(current.draft) : update }));
	const amount = kept.value.amount;
	const setAmount = (amount: string) => kept.setValue((current) => ({ ...current, amount }));
	const notice = kept.value.notice;
	const setNotice = (notice: string) => kept.setValue((current) => ({ ...current, notice }));
	const parsedAmount = parseAmount(amount, locale);
	const noticeValue =
		notice.trim() === "" ? null : /^\d+$/.test(notice) && Number(notice) <= 52 ? Number(notice) : undefined;
	const next = { ...draft, minBase: { ...draft.minBase, amount: parsedAmount }, noticeWeeks: noticeValue };
	const valid =
		parsedAmount === undefined || noticeValue === undefined ? null : careerProfileDataSchema.safeParse(next);
	const json = valid?.success ? JSON.stringify(valid.data) : null;
	const [saved, setSaved] = useState(JSON.stringify(initial));
	const [error, setError] = useState(false);
	const [saving, setSaving] = useState(false);
	const latest = useRef({
		blocked: !!kept.blocked,
		clear: kept.clear,
		unblock: () => kept.setBlocked(null),
		raw: kept.value,
		json,
		server: session.server,
		accountId: account.data?.id,
	});
	const queue = useRef<Promise<unknown>>(Promise.resolve());
	const attempted = useRef<string | null>(saved);
	useLayoutEffect(() => {
		latest.current = {
			blocked: !!kept.blocked,
			clear: kept.clear,
			unblock: () => kept.setBlocked(null),
			raw: kept.value,
			json,
			server: session.server,
			accountId: account.data?.id,
		};
	});
	const flush = useCallback(
		(retry = false) => {
			const current = latest.current;
			if (
				(!retry && current.blocked) ||
				!current.accountId ||
				!current.json ||
				(!retry && attempted.current === current.json)
			)
				return;
			attempted.current = current.json;
			const queuedJson = current.json;
			const value = careerProfileDataSchema.parse(JSON.parse(queuedJson));
			setSaving(true);
			setError(false);
			const write = queue.current.then(async () => {
				const identity = queryClient.getQueryData<RouterOutput["auth"]["getProfile"]>([
					...orpc.auth.getProfile.key(),
					current.server,
				]);
				if (getServer() !== current.server || identity?.id !== current.accountId) return;
				await client.career.saveProfile(value);
				setSaved(queuedJson);
				current.clear(current.raw);
				current.unblock();
				void queryClient.invalidateQueries({ queryKey: orpc.career.profile.key() });
			});
			queue.current = write
				.catch(() => {
					setError(true);
				})
				.finally(() => {
					if (attempted.current === current.json) setSaving(false);
				});
		},
		[queryClient],
	);
	useEffect(() => {
		const timer = setTimeout(() => flush(), 2000);
		return () => clearTimeout(timer);
	}, [json, account.data?.id, flush]);
	useEffect(() => {
		const listener = AppState.addEventListener("change", (state) => {
			if (state !== "active") flush();
		});
		return () => {
			listener.remove();
			flush();
		};
	}, [flush]);
	const change = (patch: Partial<CareerProfileData>) => setDraft((current) => ({ ...current, ...patch }));
	return (
		<View style={{ gap: space.s4 }}>
			<Text variant="title">{t`What you're looking for`}</Text>
			<Text accessibilityLiveRegion="polite" color={error ? "dangerText" : "ink3"}>
				{!valid?.success ? t`Not saved` : error ? t`Not saved` : saving || json !== saved ? t`Saving…` : t`Saved`}
			</Text>
			{error || kept.blocked ? (
				<>
					<Banner
						tone="danger"
						message={
							kept.blocked
								? t`Recovered an unsaved draft. Review it before saving over the current version.`
								: t`Couldn't save your preferences. Your draft is still here.`
						}
					/>
					<Button variant="secondary" label={t`Retry`} onPress={() => flush(true)} />
					{kept.blocked && (
						<Button
							variant="ghost"
							label={t`Use saved version`}
							onPress={() =>
								kept.reset({
									draft: initial,
									amount:
										initial.minBase.amount === null
											? ""
											: new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(initial.minBase.amount),
									notice: initial.noticeWeeks === null ? "" : String(initial.noticeWeeks),
								})
							}
						/>
					)}
				</>
			) : null}
			<SelectSheet
				label={t`Remember facts from my messages`}
				value={draft.memoryMode}
				onChange={(memoryMode) => change({ memoryMode })}
				options={[
					{ value: "ask", label: t`Ask first` },
					{ value: "auto", label: t`Automatically` },
					{ value: "off", label: t`Never` },
				]}
			/>
			<Text color="ink3">
				{draft.memoryMode === "ask"
					? t`The coach proposes each fact in the chat. Nothing is saved until you agree.`
					: draft.memoryMode === "auto"
						? t`The coach saves facts you state, and tells you. You can undo.`
						: t`The coach doesn't remember anything from your messages.`}
			</Text>
			<ChipInput
				label={t`Target roles`}
				values={draft.targetRoles}
				onChange={(targetRoles) => change({ targetRoles })}
			/>
			<RoleSuggestions locale={locale} onUse={(targetRoles) => change({ targetRoles })} />
			<ChipInput
				label={t`Where you want to work`}
				values={draft.locations}
				onChange={(locations) => change({ locations })}
			/>
			{account.data ? (
				// Waits for the account, so its time zone (not the UTC stand-in) decides the automatic country.
				<SearchRegionsField
					value={draft.searchRegions}
					accountTimeZone={timeZone}
					onChange={(searchRegions) => change({ searchRegions })}
				/>
			) : null}
			<TextArea
				label={t`What matters to you`}
				value={draft.priorities}
				maxLength={4000}
				onChangeText={(priorities) => change({ priorities })}
				onBlur={() => flush()}
			/>
			<Text variant="title">{t`Requirements`}</Text>
			<Text color="ink3">{t`Used to check roles and offers. Each is a number, so the coach can compare without guessing.`}</Text>
			<TextField
				label={t`Minimum base salary`}
				keyboardType="decimal-pad"
				value={amount}
				onChangeText={setAmount}
				onBlur={() => flush()}
				error={
					parsedAmount === undefined
						? t`Enter a full amount, such as 95000. Your previous amount is unchanged.`
						: undefined
				}
			/>
			<TextField
				label={t`Currency`}
				value={draft.minBase.currency}
				autoCapitalize="characters"
				maxLength={3}
				onChangeText={(currency) => change({ minBase: { ...draft.minBase, currency: currency.toUpperCase() } })}
				onBlur={() => flush()}
				error={!/^[A-Z]{3}$/.test(draft.minBase.currency) ? t`Enter a three-letter currency code.` : undefined}
			/>
			<SelectSheet
				label={t`Pay period`}
				value={draft.minBase.period}
				onChange={(period) => change({ minBase: { ...draft.minBase, period } })}
				options={[
					{ value: "year", label: t`Per year` },
					{ value: "month", label: t`Per month` },
					{ value: "hour", label: t`Per hour` },
				]}
			/>
			<SelectSheet
				label={t`Office days a week, at most`}
				value={draft.maxOfficeDays === null ? "any" : String(draft.maxOfficeDays)}
				onChange={(value) => change({ maxOfficeDays: value === "any" ? null : Number(value) })}
				options={[
					{ value: "any", label: t`Any` },
					{ value: "0", label: t`Remote` },
					...[1, 2, 3, 4, 5].map((days) => ({ value: String(days), label: String(days) })),
				]}
			/>
			<TextField
				label={t`Notice period (weeks)`}
				keyboardType="number-pad"
				value={notice}
				maxLength={3}
				onChangeText={setNotice}
				onBlur={() => flush()}
				error={noticeValue === undefined ? t`Enter a whole number from 0 to 52, or leave blank.` : undefined}
			/>
			{!valid?.success ? (
				<Banner tone="warn" message={t`Check your preferences. Invalid changes are not saved.`} />
			) : null}
			<Text color="ink3">{t`Times are shown in ${timeZone}.`}</Text>
			<Button label={t`Change timezone`} variant="ghost" onPress={() => router.push(routes.settings("preferences"))} />
		</View>
	);
}
