// Small pieces every workspace tab uses, ported from apps/web/src/features/career/shared.tsx.
import type { IconName } from "@/ui";
import type { ColorToken } from "@/ui/tokens";
import type { GenerateTask } from "@reactive-resume/schema/career";
import type { ReactNode } from "react";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { AIProviderSetupSheet, useHasAIProvider } from "@/features/ai/providers";
import { ReportAiContent } from "@/features/ai/report-content";
import { Banner, Button, Card, Icon, Text, useTheme } from "@/ui";

export { workspaceTabLabel as tabLabel } from "@/shell/workspace-tab-label";

/** What each piece of tab work goes through, in order, before the general phrases take over. */
export const workingSteps = (task: GenerateTask["task"] | "tighten") =>
	({
		fit: [t`Reading the posting`, t`Matching your facts`, t`Weighing each requirement`, t`Checking your preferences`],
		briefing: [t`Reading the posting`, t`Picking your stories`, t`Timing the plan`, t`Drafting questions`],
		practice: [t`Reading your answer`, t`Finding what works`, t`Sharpening the opening`],
		debrief: [t`Reading your notes`, t`Checking against Knowledge`, t`Planning your week`],
		reply: [t`Reading the message`, t`Spotting what changed`, t`Drafting a reply`],
		answer: [t`Reading the question`, t`Drafting`],
		tighten: [t`Tightening`, t`Trimming words`],
	})[task];

/**
 * A 10–30 second wait reads as progress: the label moves through the work's steps every 2.2 seconds, then loops
 * through general phrases. Returns `idle` until `busy`.
 */
export function useWorking(busy: boolean, steps: string[], idle: string) {
	const [state, setState] = useState({ busy, tick: 0 });
	if (state.busy !== busy) setState({ busy, tick: 0 });
	useEffect(() => {
		if (!busy) return;
		const id = setInterval(() => setState((current) => ({ ...current, tick: current.tick + 1 })), 2200);
		return () => clearInterval(id);
	}, [busy]);
	const tick = state.tick;
	if (!busy) return idle;
	const general = [t`Thinking`, t`Cooking`, t`Connecting the dots`, t`Double-checking`, t`Polishing`];
	const phrase = tick < steps.length ? steps[tick] : general[(tick - steps.length) % general.length];
	return `${phrase ?? ""}…`;
}

type CheckRowProps = {
	label: string;
	detail?: string | undefined;
	checked: boolean;
	onChange: (checked: boolean) => void;
	disabled?: boolean | undefined;
	/** Crosses the label out when ticked (plan rows). */
	strike?: boolean | undefined;
	trailing?: ReactNode;
};

/** A tappable checkbox row; the whole row is the 44 pt target. */
export function CheckRow({ label, detail, checked, onChange, disabled, strike, trailing }: CheckRowProps) {
	const { colors, size, space } = useTheme();
	return (
		<Pressable
			accessibilityRole="checkbox"
			accessibilityLabel={label}
			accessibilityState={{ checked, disabled: !!disabled }}
			disabled={disabled}
			onPress={() => onChange(!checked)}
			style={({ pressed }) => ({
				minHeight: size.hit,
				flexDirection: "row",
				alignItems: "flex-start",
				gap: space.s3,
				paddingVertical: space.s2,
				opacity: disabled && !checked ? 0.6 : 1,
				backgroundColor: pressed ? colors.press : "transparent",
			})}
		>
			<Icon
				name={checked ? "check-square" : "square"}
				filled={checked}
				size={size.icon.toolbar}
				color={checked ? colors.accent : colors.ink3}
			/>
			<View style={{ flex: 1, gap: space.s0 }}>
				<Text
					color={checked && strike ? "ink2" : "ink"}
					style={checked && strike ? { textDecorationLine: "line-through" } : null}
				>
					{label}
				</Text>
				{detail ? (
					<Text variant="callout" color="ink2">
						{detail}
					</Text>
				) : null}
			</View>
			{trailing}
		</Pressable>
	);
}

type Tone = "accent" | "warn" | "info" | "danger" | "plain";
const tones: Record<Tone, { background: ColorToken; text: ColorToken }> = {
	accent: { background: "accentSoft", text: "accentText" },
	warn: { background: "warnSoft", text: "warnText" },
	info: { background: "infoSoft", text: "infoText" },
	danger: { background: "dangerSoft", text: "dangerText" },
	plain: { background: "sunken", text: "ink2" },
};

type PillProps = { tone: Tone; label: string; icon?: IconName | undefined };

/** A small status label: colour, icon and words together. */
export function Pill({ tone, label, icon }: PillProps) {
	const { colors, radius, size, space } = useTheme();
	const palette = tones[tone];
	return (
		<View
			style={{
				flexDirection: "row",
				alignItems: "center",
				alignSelf: "flex-start",
				gap: space.s1,
				minHeight: 24,
				paddingHorizontal: space.s2,
				borderRadius: radius.rSm,
				backgroundColor: colors[palette.background],
			}}
		>
			{icon ? <Icon name={icon} size={size.icon.meta} color={colors[palette.text]} /> : null}
			<Text variant="caption" color={palette.text}>
				{label}
			</Text>
		</View>
	);
}

export type EvidenceStatus = "supported" | "partial" | "missing" | "added";

export function StatusPill({ status }: { status: EvidenceStatus }) {
	const { t } = useLingui();
	const pills = {
		supported: { tone: "accent", icon: "check-circle", label: t`Supported` },
		added: { tone: "accent", icon: "check-circle", label: t`Added by you` },
		partial: { tone: "warn", icon: "circle-half", label: t`Partly supported` },
		missing: { tone: "plain", icon: "question", label: t`No evidence yet` },
	} as const;
	return <Pill {...pills[status]} />;
}

/** Names exactly what an AI action sends, and where. */
type PrivacyLineProps = { children: string; centered?: boolean };

export function PrivacyLine({ children, centered = false }: PrivacyLineProps) {
	const { colors, size, space } = useTheme();
	return (
		<View
			style={{
				width: centered ? "100%" : undefined,
				flexDirection: centered ? "column" : "row",
				alignItems: centered ? "center" : "flex-start",
				gap: space.s1,
			}}
		>
			<Icon name="lock" size={size.icon.meta} color={colors.ink3} />
			<Text
				variant="caption"
				color="ink3"
				align={centered ? "center" : undefined}
				style={centered ? undefined : { flex: 1 }}
			>
				{children}
			</Text>
		</View>
	);
}

/**
 * Where an AI button's data goes, or, with no usable connection, a button that adds one in place. Tabs show their AI
 * buttons only when `useHasAIProvider().defaultProvider` is set.
 */
type AiNoticeProps = { sends?: string | undefined; centered?: boolean };

export function AiNotice({ sends, centered = false }: AiNoticeProps) {
	const { t } = useLingui();
	const connection = useHasAIProvider();
	const [setup, setSetup] = useState(false);
	const provider = connection.defaultProvider;
	if (connection.isLoading) return <ActivityIndicator />;
	if (connection.error)
		return (
			<Banner
				tone="danger"
				message={t`AI connections couldn't be loaded.`}
				action={{ label: t`Try again`, onPress: connection.retry }}
			/>
		);
	if (!provider)
		return (
			<>
				<Button variant="link" icon="key" label={t`Connect an AI provider`} onPress={() => setSetup(true)} />
				<AIProviderSetupSheet open={setup} onClose={() => setSetup(false)} />
			</>
		);
	const label = provider.label;
	return (
		<>
			<PrivacyLine centered={centered}>
				{sends ??
					t`Sends this application's posting, notes and documents, plus Knowledge that's switched on, to ${label}.`}
			</PrivacyLine>
			<ReportAiContent source="career" />
		</>
	);
}

type BlockProps = { title?: string | undefined; trailing?: ReactNode; children: ReactNode };

/** A card with an optional heading row. */
export function Block({ title, trailing, children }: BlockProps) {
	const { space } = useTheme();
	return (
		<Card>
			<View style={{ gap: space.s3, padding: space.s1 }}>
				{title || trailing ? (
					<View style={{ flexDirection: "row", alignItems: "center", gap: space.s2 }}>
						{title ? (
							<Text variant="label" accessibilityRole="header" style={{ flex: 1 }}>
								{title}
							</Text>
						) : null}
						{trailing}
					</View>
				) : null}
				{children}
			</View>
		</Card>
	);
}

/** A row of buttons that wraps. */
export function Actions({ children }: { children: ReactNode }) {
	const { space } = useTheme();
	return (
		<View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.s2 }}>{children}</View>
	);
}

/** A thin progress track. */
export function Progress({ value, label }: { value: number; label: string }) {
	const { colors, radius } = useTheme();
	const clamped = Math.max(0, Math.min(1, value));
	return (
		<View
			accessibilityRole="progressbar"
			accessibilityLabel={label}
			accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
			style={{ height: 6, borderRadius: radius.rLg, backgroundColor: colors.line, overflow: "hidden" }}
		>
			<View style={{ width: `${clamped * 100}%`, height: "100%", backgroundColor: colors.accent }} />
		</View>
	);
}

type SaveErrorProps = {
	autosave: {
		error: string | null;
		retry: () => void;
		takeServerVersion?: (() => Promise<void>) | undefined;
		resolving: boolean;
		resolveFailed: boolean;
	};
};

/**
 * Shown when autosave stopped (a permanent error, or retries ran out): the text is kept and the user decides. After a
 * conflict this comes back on reopen until they retry or take the server version.
 */
export function SaveError({ autosave }: SaveErrorProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	if (!autosave.error) return null;
	const conflict = autosave.error === "CONFLICT";
	const takeServer = autosave.takeServerVersion;
	return (
		<View style={{ gap: space.s2 }}>
			<Banner
				tone="danger"
				message={
					conflict
						? t`This changed somewhere else, so it wasn't saved. Your text is kept here; Retry saves it over the other copy.`
						: t`This wasn't saved. Your text is kept on this device.`
				}
				action={autosave.resolving ? undefined : { label: t`Retry`, onPress: autosave.retry }}
			/>
			{conflict && takeServer ? (
				<Button
					variant="secondary"
					size="sm"
					label={t`Use server version`}
					loading={autosave.resolving}
					onPress={() => void takeServer()}
				/>
			) : null}
			{autosave.resolveFailed ? (
				<Text variant="callout" color="dangerText" accessibilityRole="alert">
					{t`The server version couldn't be loaded. Your text is kept; try again.`}
				</Text>
			) : null}
		</View>
	);
}
