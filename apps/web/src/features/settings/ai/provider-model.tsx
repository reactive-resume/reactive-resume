import type { AIModelSuggestion } from "@reactive-resume/ai/models";
import type { AIProvider } from "@reactive-resume/ai/types";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useRef, useState } from "react";
import { AI_PROVIDER_DEFAULT_MODELS } from "@reactive-resume/ai/defaults";
import { getAIProviderModelGroups } from "@reactive-resume/ai/models";
import {
	ComboboxContent,
	ComboboxGroup,
	ComboboxGroupLabel,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
	ComboboxRoot,
	ComboboxTrigger,
	useFilter,
} from "@reactive-resume/ui/components/combobox";
import { Input } from "@reactive-resume/ui/components/input";
import { InputGroupAddon, InputGroupButton } from "@reactive-resume/ui/components/input-group";
import { Label } from "@reactive-resume/ui/components/label";

type ProviderModelProps = {
	id: string;
	provider: AIProvider;
	value: string;
	onChange: (value: string) => void;
};

export function ProviderModel({ id, provider, value, onChange }: ProviderModelProps) {
	const anchor = useRef<HTMLDivElement>(null);
	const [query, setQuery] = useState("");
	const [open, setOpen] = useState(false);
	const { contains } = useFilter();
	const groups = getAIProviderModelGroups(provider);
	const models = [...groups.recommended, ...groups.other];
	const shown = models.filter((model) => contains(model.id, query) || contains(model.name, query));
	const defaultModel = AI_PROVIDER_DEFAULT_MODELS[provider];
	const inputProps = {
		id,
		"aria-describedby": `${id}-hint`,
		autoComplete: "off",
		autoCorrect: "off",
		autoCapitalize: "off",
		spellCheck: false,
	} as const;
	const renderGroup = (label: string, items: AIModelSuggestion[]) => {
		const listed = items.filter((model) => shown.includes(model));
		return listed.length ? (
			<ComboboxGroup aria-label={label}>
				<ComboboxGroupLabel className="px-2.5 py-1.5 text-xs font-medium text-ink-3">{label}</ComboboxGroupLabel>
				{listed.map((model) => (
					<ComboboxItem key={model.id} value={model}>
						<span className="grid gap-0.5">
							<span>{model.name}</span>
							<span className="text-xs text-ink-3">
								{model.id}
								{model.recommendation === "capable"
									? ` · ${t`More capable`}`
									: model.id === defaultModel
										? ` · ${t`Default`}`
										: ""}
							</span>
						</span>
					</ComboboxItem>
				))}
			</ComboboxGroup>
		) : null;
	};
	return (
		<div className="grid gap-1.5">
			<Label htmlFor={id}>
				<Trans>Model</Trans>
			</Label>
			{models.length ? (
				<ComboboxRoot
					open={open && shown.length > 0}
					items={models}
					filteredItems={shown}
					filter={null}
					value={models.find((model) => model.id === value) ?? null}
					inputValue={value}
					itemToStringLabel={(model) => model.id}
					isItemEqualToValue={(a, b) => a.id === b.id}
					onValueChange={(model) => {
						if (model) onChange(model.id);
					}}
					onInputValueChange={(next, details) => {
						if (details.reason === "input-change") {
							onChange(next);
							setQuery(next);
						}
					}}
					onOpenChange={(nextOpen, details) => {
						if (nextOpen && details.reason !== "input-change") setQuery("");
						setOpen(nextOpen);
					}}
				>
					<div ref={anchor}>
						<ComboboxInput {...inputProps} className="w-full">
							<InputGroupAddon align="inline-end">
								<ComboboxTrigger aria-label={t`Choose model`} render={<InputGroupButton size="icon-xs" />} />
							</InputGroupAddon>
						</ComboboxInput>
					</div>
					<ComboboxContent anchor={anchor}>
						<ComboboxList className="max-h-(--available-height)">
							{renderGroup(t`Recommended`, groups.recommended)}
							{renderGroup(t`All models`, groups.other)}
						</ComboboxList>
					</ComboboxContent>
				</ComboboxRoot>
			) : (
				<Input {...inputProps} value={value} onChange={(event) => onChange(event.target.value)} />
			)}
			<div id={`${id}-hint`} className="grid gap-1 text-xs leading-5 text-ink-3">
				{provider === "openai" && (
					<p>
						<Trans>Fast, lower-cost default for everyday work.</Trans> {defaultModel}
					</p>
				)}
				{provider !== "openai" && defaultModel && (
					<p>
						<Trans>Default</Trans>: {defaultModel}
					</p>
				)}
				{!models.length && (
					<p>
						<Trans>No built-in suggestions for this provider.</Trans>
					</p>
				)}
				<p>
					<Trans>Enter any model ID supported by your endpoint.</Trans>
				</p>
			</div>
		</div>
	);
}
