// B3 · Entry editor and B20 · New entry. A full screen of the fields the section type needs; the entry's name is the
// title and follows its main field. Saves as you type (one undo step per field visit). B20 is the same editor with a
// draft that exists only once something is typed: leaving it empty creates nothing.
import type { CustomSectionItem, ResumeData } from "@reactive-resume/schema/resume/data";
import type { ResumeDates, YearMonth } from "@reactive-resume/schema/resume/dates";
import { t } from "@lingui/core/macro";
import { useRouter } from "expo-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { createEntry } from "@reactive-resume/resume/entries";
import { formatYearMonth, readLegacyDates, syncResumeDates } from "@reactive-resume/schema/resume/dates";
import { stripHtml } from "@reactive-resume/utils/string";
import { BuilderScreen, editResume, useBuilderParams, useLocked, useResumeData, useSaveWord } from "../shared/document";
import { createEntryWith, deleteEntry } from "../shared/entries";
import {
	type BuilderSection,
	type FieldSpec,
	entryTitle,
	findEntry,
	getEntries,
	isEmptyEntry,
	resolveSection,
	sectionMeta,
	sectionName,
} from "../shared/model";
import { useBuilderStoryboard } from "../shared/storyboard";
import { MonthPickerSheet } from "./MonthPickerSheet";
import { resumeFieldFocus, useResumeStore } from "@/data";
import { STORYBOARD } from "@/dev/storyboard/harness";
import {
	BottomSheet,
	Card,
	FieldRow,
	Form,
	haptic,
	Icon,
	IconButton,
	ListRow,
	Text,
	TextField,
	TextLink,
	Touch,
} from "@/ui";

type Values = Record<string, unknown>;
type Focusable = { focus: () => void };

/** One undo step per field visit: consecutive edits while a field keeps focus merge into one step. */
function useVisit() {
	const visit = useRef(0);
	return {
		key: (field: string) => `${field}:${visit.current}`,
		onFocus: () => {
			visit.current++;
			resumeFieldFocus.onFocus();
		},
		onBlur: resumeFieldFocus.onBlur,
	};
}

function datesOf(entry: Values, locale: string, single: boolean): ResumeDates {
	const legacy = String(entry.period ?? entry.date ?? "");
	return (entry.dates as ResumeDates | undefined) ?? readLegacyDates(legacy, { locale, single });
}

const statusFor = (word: string, name: string, locked: boolean) =>
	locked
		? t`Locked. Unlock it from ··· on the resume.`
		: word === t`Saving…`
			? t`${name} · saving…`
			: word === t`Saved`
				? t`${name} · saved`
				: `${name} · ${word}`;

export function EntryScreen({ isNew = false }: { isNew?: boolean }) {
	const params = useBuilderParams();
	const router = useRouter();
	const insets = useSafeAreaInsets();
	const data = useResumeData();
	const locked = useLocked();
	const word = useSaveWord();
	const visit = useVisit();
	const focus = useBuilderStoryboard((s) => s.focus);
	const section = data ? resolveSection(data, params.section) : null;
	// B20: the entry id once the first character has created it.
	const [createdId, setCreatedId] = useState<string | null>(null);
	const [draft, setDraft] = useState<CustomSectionItem | null>(() =>
		isNew && section ? createEntry(section.type) : null,
	);
	const [picker, setPicker] = useState<null | "start" | "end" | "level">(null);
	const [more, setMore] = useState(false);
	const entryId = isNew ? createdId : params.item;
	const stored = data && entryId ? findEntry(data, params.section, entryId) : undefined;
	const entry = (stored ?? (isNew && !createdId ? draft : undefined)) as Values | undefined;
	const inputs = useRef<(Focusable | null)[]>([]);

	// Leaving with every field cleared removes the entry (B3 States); a B20 entry that was never typed never existed.
	const latest = useRef({ section, entryId, data });
	useEffect(() => {
		latest.current = { section, entryId, data };
	});
	useEffect(
		() => () => {
			const { section: s, entryId: id, data: d } = latest.current;
			if (!s || !id || !d) return;
			const current = findEntry(useResumeStore.getState().data ?? d, s.id, id);
			if (current && isEmptyEntry(current)) deleteEntry(s, id, t`Empty entry removed`);
		},
		[],
	);

	if (!data || !section || !entry) return <BuilderScreen title="">{null}</BuilderScreen>;
	const meta = sectionMeta[section.type];
	const locale = data.metadata.page.locale;
	const title = entryTitle(section.type, entry as CustomSectionItem);
	const created = !isNew || !!createdId;

	const change = (field: string, apply: (e: Values, d?: ResumeData) => void) => {
		if (locked) return;
		if (!created) {
			const id = createEntryWith(section, (e) => apply(e as Values));
			setCreatedId(id);
			setDraft(null);
			return;
		}
		editResume(
			(d) => {
				const target = getEntries(d, section).find((e) => e.id === entryId) as Values | undefined;
				if (target) apply(target, d as ResumeData);
				if (field === "dates") syncResumeDates(d as ResumeData);
			},
			{ coalesceKey: visit.key(`${entryId}.${field}`), sameStep: true },
		);
	};

	const textField = (spec: Extract<FieldSpec, { kind: "text" }>, index: number) => (
		<TextField
			key={spec.key}
			label={spec.label()}
			value={String(entry[spec.key] ?? "")}
			placeholder={spec.placeholder?.() ?? (spec.key === meta.primary && isNew ? placeholderFor(section) : undefined)}
			editable={!locked}
			forceFocus={focus === spec.key}
			// Storyboard captures draw the focused field without the system keyboard (B20).
			autoFocus={isNew && index === 0 && !STORYBOARD}
			inputPlaceholder={isNew}
			returnKeyType="next"
			submitBehavior="submit"
			onSubmitEditing={() => inputs.current[index + 1]?.focus()}
			keyboardType={
				spec.keyboard === "email"
					? "email-address"
					: spec.keyboard === "phone"
						? "phone-pad"
						: spec.keyboard === "url"
							? "url"
							: "default"
			}
			onFocus={visit.onFocus}
			onBlur={visit.onBlur}
			onChangeText={(value) => change(spec.key, (e) => (e[spec.key] = value))}
			{...({ ref: (node: Focusable | null) => (inputs.current[index] = node) } as object)}
		/>
	);

	const dates = datesOf(entry, locale, false);
	const show = (value: YearMonth | null) =>
		value ? formatYearMonth(value, { locale, format: data.metadata.page.dateFormat }) : "";
	const reversed = !!dates.start && !!dates.end && !dates.present && dates.end < dates.start;
	const setDates = (next: Partial<ResumeDates>) =>
		change("dates", (e) => {
			const { raw: _raw, ...current } = datesOf(e, locale, false);
			e.dates = { ...current, ...next };
		});

	const render = (spec: FieldSpec, index: number): ReactNode => {
		switch (spec.kind) {
			case "text":
				return textField(spec, index);
			case "dates":
				return spec.single ? (
					<TextField
						key="date"
						label={t`Date`}
						value={show(dates.start)}
						onPress={locked ? undefined : () => setPicker("start")}
					/>
				) : (
					<FieldRow key="dates">
						<TextField
							grow
							label={t`Start`}
							value={show(dates.start)}
							onPress={locked ? undefined : () => setPicker("start")}
						/>
						<TextField
							grow
							label={t`End`}
							value={dates.present ? t`Present` : show(dates.end)}
							error={reversed ? t`The end date is before the start date.` : undefined}
							onPress={locked ? undefined : () => setPicker("end")}
						/>
					</FieldRow>
				);
			case "level": {
				const level = Number(entry.level ?? 0);
				return (
					<TextField
						key="level"
						label={t`Level`}
						value={level ? `${level} / 5` : ""}
						placeholder={t`Not shown`}
						trailingIcon="caret-down"
						onPress={locked ? undefined : () => setPicker("level")}
					/>
				);
			}
			case "keywords":
				return (
					<TextField
						key="keywords"
						label={t`Keywords`}
						value={((entry.keywords as string[] | undefined) ?? []).join(", ")}
						editable={!locked}
						onFocus={visit.onFocus}
						onBlur={visit.onBlur}
						onChangeText={(value) =>
							change("keywords", (e) => {
								e.keywords = value.split(",").map((k) => k.trimStart());
							})
						}
					/>
				);
			case "website": {
				const site = (entry.website as { url: string; label: string; inlineLink: boolean } | undefined) ?? {
					url: "",
					label: "",
					inlineLink: false,
				};
				return (
					<TextField
						key="website"
						label={t`Website`}
						value={site.url}
						keyboardType="url"
						autoCapitalize="none"
						editable={!locked}
						onFocus={visit.onFocus}
						onBlur={visit.onBlur}
						onChangeText={(url) => change("website", (e) => (e.website = { ...site, url }))}
					/>
				);
			}
			case "description": {
				const html = String(entry.description ?? entry.content ?? "");
				const plain = stripHtml(html.replace(/<\/(li|p)>/g, " "))
					.replace(/\s+/g, " ")
					.trim();
				const open = (improve: boolean) => {
					if (!created) return;
					router.push(
						`/builder/${params.id}/section/${section.id}/${entryId}/description${improve ? "?improve=1" : ""}`,
					);
				};
				return (
					<Touch
						key="description"
						onPress={() => open(false)}
						accessibilityRole="button"
						accessibilityLabel={spec.label()}
					>
						<Card>
							<View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
								<Text variant="formLabel" color="ink2">
									{spec.label()}
								</Text>
								<Touch onPress={() => open(true)} feedback="none" accessibilityLabel={t`Improve`}>
									<View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
										<Icon name="sparkle" size={16} color="accentText" />
										<Text variant="formLabel" color="accentText">
											{t`Improve`}
										</Text>
									</View>
								</Touch>
							</View>
							{plain ? (
								<Text variant="body" color="ink2" numberOfLines={3}>
									{plain}
								</Text>
							) : null}
						</Card>
					</Touch>
				);
			}
		}
	};

	const primaryLabel = (
		meta.fields.find((f) => f.kind === "text" && f.key === meta.primary) as
			| Extract<FieldSpec, { kind: "text" }>
			| undefined
	)
		?.label()
		.toLowerCase();

	const discard = () => {
		latest.current.entryId = null;
		router.back();
		if (createdId) deleteEntry(section, createdId, t`Entry discarded`);
	};
	const remove = () => {
		latest.current.entryId = null;
		router.back();
		if (entryId) deleteEntry(section, entryId);
	};

	const footer = locked ? undefined : (
		<View
			style={{
				flexDirection: "row",
				justifyContent: "space-between",
				paddingHorizontal: 24,
				paddingBottom: 8 + insets.bottom,
			}}
		>
			{created ? (
				<View style={{ paddingVertical: 12 }}>
					<TextLink
						label={t`See it on the page`}
						icon="file-text"
						onPress={() => router.push(`/builder/${params.id}/preview?section=${section.id}&item=${entryId}`)}
					/>
				</View>
			) : null}
			<View style={{ paddingVertical: 12 }}>
				{created ? (
					<TextLink label={t`Delete entry`} icon="trash" color="dangerText" onPress={remove} />
				) : (
					<TextLink label={t`Discard`} icon="trash" color="dangerText" onPress={discard} />
				)}
			</View>
		</View>
	);

	const fields = meta.fields;
	return (
		<BuilderScreen
			{...(created ? { title: title || meta.untitled() } : {})}
			backLabel={t`Back to ${sectionName(data, section)}`}
			status={created ? statusFor(word, sectionName(data, section), locked) : undefined}
			subtitle={
				created ? undefined : (
					<>
						<View style={{ paddingTop: 4, paddingHorizontal: 24 }}>
							<Text variant="pageTitle" color="ink3" accessibilityRole="header">
								{placeholderFor(section)}
							</Text>
						</View>
						<View style={{ paddingTop: 6, paddingHorizontal: 24 }}>
							<Text variant="body" color="ink3">
								{t`${sectionName(data, section)} · saved once you start typing`}
							</Text>
						</View>
					</>
				)
			}
			barEnd={
				created && !locked ? (
					<IconButton
						icon="dots-three"
						label={t`Entry options`}
						onPress={() => router.push(`/builder/${params.id}/section/${section.id}/${entryId}/actions`)}
					/>
				) : null
			}
			footer={footer}
			overlay={
				picker === "level" ? (
					<BottomSheet title={t`Level`} height={480} onClose={() => setPicker(null)}>
						{[0, 1, 2, 3, 4, 5].map((n, i) => (
							<ListRow
								key={n}
								title={n === 0 ? t`Not shown` : `${n} / 5`}
								top={i === 0}
								last={n === 5}
								trailing={
									Number(entry.level ?? 0) === n ? <Icon name="check" size={24} color="accentText" /> : undefined
								}
								accessibilityRole="radio"
								accessibilityState={{ selected: Number(entry.level ?? 0) === n }}
								onPress={() => {
									haptic("selection");
									change("level", (e) => (e.level = n));
									setPicker(null);
								}}
							/>
						))}
					</BottomSheet>
				) : picker ? (
					<MonthPickerSheet
						title={
							picker === "start" ? (fields.some((f) => f.kind === "dates" && f.single) ? t`Date` : t`Start`) : t`End`
						}
						value={picker === "start" ? dates.start : dates.end}
						present={picker === "end" && dates.present}
						allowPresent={picker === "end"}
						locale={locale}
						onClose={() => setPicker(null)}
						onChange={({ value, present }) =>
							setDates(
								picker === "start"
									? { start: value }
									: present
										? { present: true, end: null }
										: { end: value, present: false },
							)
						}
					/>
				) : null
			}
		>
			<Form>
				{created && !title && !locked && primaryLabel ? (
					<Text variant="ui" color="ink3">
						{t`Appears on the page once it has a ${primaryLabel}.`}
					</Text>
				) : null}
				{fields.map((spec, index) => render(spec, index))}
				{meta.more.length > 0 ? (
					more ? (
						meta.more.map((spec, index) => render(spec, fields.length + index))
					) : (
						<TextLink label={t`More fields`} icon="caret-down" onPress={() => setMore(true)} />
					)
				) : null}
			</Form>
		</BuilderScreen>
	);
}

const placeholderFor = (section: BuilderSection) => sectionMeta[section.type].placeholder();
