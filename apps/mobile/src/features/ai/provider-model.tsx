import type { AIModelSuggestion } from "@reactive-resume/ai/models";
import type { AIProvider } from "@reactive-resume/ai/types";
import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { View } from "react-native";
import { AI_PROVIDER_DEFAULT_MODELS } from "@reactive-resume/ai/defaults";
import { getAIProviderModelGroups } from "@reactive-resume/ai/models";
import { IconButton, ListRow, Sheet, Text, TextField, useTheme } from "@/ui";

type ProviderModelProps = {
	provider: AIProvider;
	value: string;
	onChange: (value: string) => void;
	disabled?: boolean;
};

export function ProviderModel({ provider, value, onChange, disabled }: ProviderModelProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const groups = getAIProviderModelGroups(provider);
	const hasSuggestions = groups.recommended.length + groups.other.length > 0;
	const defaultModel = AI_PROVIDER_DEFAULT_MODELS[provider];
	const matches = (model: AIModelSuggestion) =>
		`${model.name} ${model.id}`.toLowerCase().includes(query.trim().toLowerCase());
	const recommended = groups.recommended.filter(matches);
	const other = groups.other.filter(matches);
	const renderGroup = (label: string, items: AIModelSuggestion[]) => {
		return items.length ? (
			<View style={{ gap: space.s2 }}>
				<Text variant="caption" color="ink3" accessibilityRole="header">
					{label}
				</Text>
				{items.map((model) => (
					<ListRow
						key={model.id}
						title={model.name}
						subtitle={`${model.id}${model.recommendation === "capable" ? ` · ${t`More capable`}` : model.id === defaultModel ? ` · ${t`Default`}` : ""}`}
						selected={value === model.id}
						onPress={() => {
							onChange(model.id);
							setOpen(false);
						}}
					/>
				))}
			</View>
		) : null;
	};
	return (
		<>
			<TextField
				label={t`Model`}
				value={value}
				onChangeText={onChange}
				autoCapitalize="none"
				autoCorrect={false}
				editable={!disabled}
				helper={t`Enter any model ID supported by your endpoint.`}
				trailing={
					hasSuggestions ? (
						<IconButton
							icon="caret-down"
							label={t`Choose model`}
							disabled={disabled}
							onPress={() => {
								setQuery("");
								setOpen(true);
							}}
						/>
					) : null
				}
			/>
			{provider === "openai" && (
				<Text color="ink3">
					{t`Fast, lower-cost default for everyday work.`} {defaultModel}
				</Text>
			)}
			{provider !== "openai" && defaultModel && (
				<Text color="ink3">
					{t`Default`}: {defaultModel}
				</Text>
			)}
			{!hasSuggestions && <Text color="ink3">{t`No built-in suggestions for this provider.`}</Text>}
			<Sheet open={open} onClose={() => setOpen(false)} title={t`Choose model`} detents={[0.65, 0.9]}>
				<TextField label={t`Search`} value={query} onChangeText={setQuery} autoCapitalize="none" autoCorrect={false} />
				{renderGroup(t`Recommended`, recommended)}
				{renderGroup(t`All models`, other)}
				{recommended.length + other.length === 0 && <Text color="ink3">{t`No matches`}</Text>}
			</Sheet>
		</>
	);
}
