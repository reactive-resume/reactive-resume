import type { IconName } from "@/ui";
import { useLingui } from "@lingui/react/macro";
import { ORPCError } from "@orpc/client";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { View } from "react-native";
import { isNetworkError } from "@reactive-resume/utils/http";
import { orpc } from "@/api/client";
import { AIProviderSetupSheet, useHasAIProvider } from "@/features/ai/providers";
import { Button, ListRow, Text, TextField, useTheme } from "@/ui";

type Action = "verb" | "result" | "shorter" | "custom";

type ImprovePanelProps = {
	line: { index: number; text: string };
	/** Where the line sits, e.g. the field's label. */
	where: string;
	/** The rest of the field, so a result can come from the lines around it. */
	context: string;
	onClose: () => void;
	/** Swaps the line; false when it changed since Improve was asked. */
	onReplace: (text: string) => Promise<boolean>;
};

/**
 * Improve (`ai.improve`): pick what to change, then Replace or Keep mine. Only the one line changes, and only when
 * the user replaces it. Without a provider, the setup sheet connects one first.
 */
export function ImprovePanel({ line, where, context, onClose, onReplace }: ImprovePanelProps) {
	const { t } = useLingui();
	const { colors, radius, space } = useTheme();
	const ai = useHasAIProvider();
	// "custom" asks what to change; "result" asks what the result was, since only the user knows it (web improve).
	const [asking, setAsking] = useState<"custom" | "result" | null>(null);
	const [request, setRequest] = useState("");
	const [result, setResult] = useState("");
	// The last request sent, with its words, so Try again and Try another send exactly that again.
	const [last, setLast] = useState<{ action: Action; words: string } | null>(null);
	const [changed, setChanged] = useState(false);
	const [setup, setSetup] = useState(false);
	const improve = useMutation(orpc.ai.improve.mutationOptions());

	const options: { action: Action; icon: IconName; label: string }[] = [
		{ action: "verb", icon: "lightning", label: t`Stronger verb` },
		{ action: "result", icon: "trend-up", label: t`Add a result` },
		{ action: "shorter", icon: "arrows-in-line-vertical", label: t`Make it shorter` },
	];

	const run = (
		action: Action,
		words = action === "custom" ? request.trim() : action === "result" ? result.trim() : "",
	) => {
		setLast({ action, words });
		improve.mutate({
			action,
			line: line.text,
			where,
			context: context.slice(0, 10_000),
			...(words ? { request: words } : {}),
		});
	};
	const pick = (action: Action) => (action === "result" ? setAsking("result") : run(action));

	const error = isNetworkError(improve.error)
		? t`Couldn't reach Reactive Resume. Check your internet connection, then try again.`
		: improve.error instanceof ORPCError && improve.error.message
			? improve.error.message
			: t`Couldn't get a suggestion. Nothing changed.`;

	return (
		<View
			style={{
				gap: space.s2,
				padding: space.s3,
				borderRadius: radius.rLg,
				borderWidth: 1,
				borderColor: colors.line,
				backgroundColor: colors.surface,
			}}
		>
			<Text variant="micro" color="ink3">
				{t`Improve selected line`}
			</Text>
			<Text variant="caption" color="ink3">{t`Original`}</Text>
			<Text variant="callout" color="ink2" selectable>
				{line.text}
			</Text>

			{ai.defaultProvider && (
				<Text
					variant="caption"
					color="ink3"
				>{t`Sends this line, surrounding field text and your instructions to ${ai.defaultProvider.label} · ${ai.defaultProvider.model}.`}</Text>
			)}
			{ai.isLoading ? (
				<Text color="ink2">{t`Loading…`}</Text>
			) : !ai.hasAIProvider ? (
				<View style={{ gap: space.s2 }}>
					<Text color="ink2">
						{ai.error ? t`AI providers couldn't be loaded.` : t`Improve needs an AI provider. Connect one to continue.`}
					</Text>
					<View style={{ flexDirection: "row", gap: space.s2 }}>
						{ai.error ? (
							<Button size="sm" variant="secondary" label={t`Try again`} onPress={ai.retry} />
						) : (
							<Button size="sm" label={t`Set up a provider`} onPress={() => setSetup(true)} />
						)}
						<Button size="sm" variant="ghost" label={t`Cancel`} onPress={onClose} />
					</View>
				</View>
			) : improve.data ? (
				<View style={{ gap: space.s2, padding: space.s2, borderRadius: radius.rMd, backgroundColor: colors.bg }}>
					<Text
						accessibilityRole="text"
						accessibilityLiveRegion="polite"
						style={{ backgroundColor: colors.accentSoft }}
					>
						{improve.data.text}
					</Text>
					<Text variant="caption" color="ink3">
						{improve.data.why}
						{improve.data.addsFacts ? ` ${t`Check it's accurate.`}` : ""}
					</Text>
					{changed ? (
						<Text variant="caption" color="dangerText" accessibilityLiveRegion="assertive">
							{t`The line changed since you asked, so it wasn't replaced.`}
						</Text>
					) : null}
					<View style={{ flexDirection: "row", gap: space.s2 }}>
						{!changed ? (
							<Button
								size="sm"
								label={t`Replace`}
								onPress={() => void onReplace(improve.data.text).then((done) => setChanged(!done))}
							/>
						) : null}
						<Button size="sm" variant="secondary" label={t`Keep mine`} onPress={onClose} />
						{last && !changed ? (
							<Button size="sm" variant="ghost" label={t`Try another`} onPress={() => run(last.action, last.words)} />
						) : null}
					</View>
				</View>
			) : improve.isPending ? (
				<Text color="ink2" accessibilityLiveRegion="polite">
					{t`Improving…`}
				</Text>
			) : improve.isError ? (
				<View style={{ gap: space.s2 }}>
					<Text variant="caption" color="dangerText" accessibilityLiveRegion="assertive">
						{error}
					</Text>
					<View style={{ flexDirection: "row", gap: space.s2 }}>
						{/* Sends the same request again (web improve). */}
						<Button
							size="sm"
							variant="secondary"
							label={t`Try again`}
							onPress={() => (last ? run(last.action, last.words) : improve.reset())}
						/>
						<Button size="sm" variant="ghost" label={t`Cancel`} onPress={onClose} />
					</View>
				</View>
			) : asking === "result" ? (
				<View style={{ gap: space.s2 }}>
					<TextField
						label={t`What changed because of this? A number, a time saved, who used it.`}
						value={result}
						maxLength={500}
						autoFocus
						returnKeyType="send"
						onChangeText={setResult}
						onSubmitEditing={() => result.trim() && run("result")}
					/>
					<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s2 }}>
						<Button size="sm" label={t`Add`} disabled={!result.trim()} onPress={() => run("result")} />
						<Button size="sm" variant="ghost" label={t`I don't have one yet`} onPress={() => run("result", "")} />
					</View>
				</View>
			) : asking === "custom" ? (
				<View style={{ gap: space.s2 }}>
					<TextField
						label={t`What should change?`}
						placeholder={t`What should change?`}
						value={request}
						maxLength={500}
						autoFocus
						returnKeyType="send"
						onChangeText={setRequest}
						onSubmitEditing={() => request.trim() && run("custom")}
					/>
					<View style={{ flexDirection: "row", gap: space.s2 }}>
						<Button size="sm" label={t`Ask`} disabled={!request.trim()} onPress={() => run("custom")} />
						<Button size="sm" variant="ghost" label={t`Cancel`} onPress={onClose} />
					</View>
				</View>
			) : (
				<View>
					{options.map((option) => (
						<ListRow
							key={option.action}
							title={option.label}
							leading={option.icon}
							onPress={() => pick(option.action)}
						/>
					))}
					<ListRow title={t`Ask for something else…`} leading="chat-text" onPress={() => setAsking("custom")} />
					<ListRow title={t`Cancel`} leading="x" onPress={onClose} />
				</View>
			)}
			<AIProviderSetupSheet open={setup} onClose={() => setSetup(false)} />
		</View>
	);
}
