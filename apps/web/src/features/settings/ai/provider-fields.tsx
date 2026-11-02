import type { AIProviderSetupFields } from "@reactive-resume/ai/defaults";
import type { AIProvider } from "@reactive-resume/ai/types";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useId, useState } from "react";
import { AI_PROVIDER_KEY_URLS, getAIProviderSetupProblem } from "@reactive-resume/ai/defaults";
import { Button } from "@reactive-resume/ui/components/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@reactive-resume/ui/components/collapsible";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { Label } from "@reactive-resume/ui/components/label";
import { providerDefaults, providerLabel } from "./catalog";
import { ProviderModel } from "./provider-model";

export type ProviderFields = AIProviderSetupFields & { label: string };

type ProviderFieldsProps = {
	provider: AIProvider;
	value: ProviderFields;
	onChange: (value: ProviderFields) => void;
	/** Editing: an empty key keeps the saved one. */
	keyOptional?: boolean;
	/** Editing a new address requires a new key instead of forwarding the saved one. */
	keyAgain?: boolean;
};

const secretInputProps = {
	autoComplete: "off",
	autoCorrect: "off",
	autoCapitalize: "off",
	spellCheck: false,
	"data-lpignore": "true",
	"data-1p-ignore": "true",
	"data-bwignore": "true",
} as const;

/** Shared by settings and in-place setup; callers guard submission and use form noValidate. */
export function ProviderFieldsForm({ provider, value, onChange, keyOptional, keyAgain }: ProviderFieldsProps) {
	const id = useId();
	const [urlTouched, setUrlTouched] = useState(false);
	const set = (patch: Partial<ProviderFields>) => onChange({ ...value, ...patch });
	const defaults = providerDefaults(provider);
	const compatible = provider === "openai-compatible";
	const [advanced, setAdvanced] = useState(
		Boolean(!compatible && keyOptional && value.baseURL.trim() && value.baseURL.trim() !== defaults.baseURL),
	);
	const keyURL = AI_PROVIDER_KEY_URLS[provider];
	const problem = getAIProviderSetupProblem(provider, value, Boolean(keyOptional && !keyAgain));
	const explanation =
		problem === "baseURL"
			? t`Enter an http:// or https:// base URL.`
			: problem === "apiKey"
				? t`Enter an API key for this provider.`
				: problem === "model"
					? t`Enter a model ID.`
					: null;
	const urlError = urlTouched && problem === "baseURL";
	const urlField = (
		<div className="grid gap-1.5">
			<Label htmlFor={`${id}-url`}>{compatible ? <Trans>Base URL (required)</Trans> : <Trans>Base URL</Trans>}</Label>
			<Input
				id={`${id}-url`}
				type="url"
				value={value.baseURL}
				required={compatible}
				aria-invalid={urlError || undefined}
				aria-describedby={urlError ? `${id}-url-error` : undefined}
				placeholder={defaults.baseURL || "https://gateway.example.com/v1"}
				onBlur={() => setUrlTouched(true)}
				onChange={(event) => set({ baseURL: event.target.value })}
				{...secretInputProps}
			/>
			{urlError && (
				<p id={`${id}-url-error`} role="alert" className="text-xs text-danger-text">
					{explanation}
				</p>
			)}
		</div>
	);
	const nameField = (
		<div className="grid gap-1.5">
			<Label htmlFor={`${id}-label`}>
				<Trans>Name</Trans>
			</Label>
			<Input
				id={`${id}-label`}
				value={value.label}
				placeholder={providerLabel(provider)}
				onChange={(event) => set({ label: event.target.value })}
			/>
		</div>
	);

	return (
		<div className="grid gap-3">
			<div className="grid gap-1.5">
				<Label htmlFor={`${id}-key`}>
					<Trans>API key</Trans>
				</Label>
				<Input
					id={`${id}-key`}
					type="password"
					value={value.apiKey}
					placeholder={
						keyOptional && !keyAgain
							? t`Leave empty to keep the saved key`
							: provider === "ollama"
								? t`Optional for local Ollama`
								: undefined
					}
					required={provider !== "ollama" && (!keyOptional || keyAgain)}
					aria-describedby={keyAgain ? `${id}-key-hint` : undefined}
					onChange={(event) => set({ apiKey: event.target.value })}
					{...secretInputProps}
				/>
				{keyURL ? (
					<a
						href={keyURL}
						target="_blank"
						rel="noopener noreferrer"
						className="w-fit text-xs text-accent-text underline underline-offset-2"
					>
						<Trans>Get an API key</Trans>
					</a>
				) : (
					<p className="text-xs text-ink-3">
						<Trans>Get an API key from your endpoint operator.</Trans>
					</p>
				)}
				{keyAgain && (
					<p id={`${id}-key-hint`} className="text-xs leading-5 text-ink-3">
						{provider === "ollama" ? (
							<Trans>The saved key isn't sent to a new base URL. Enter it again if this server needs one.</Trans>
						) : (
							<Trans>The saved key isn't sent to a new base URL. Enter it again.</Trans>
						)}
					</p>
				)}
			</div>
			<ProviderModel id={`${id}-model`} provider={provider} value={value.model} onChange={(model) => set({ model })} />
			{compatible ? (
				<>
					{urlField}
					{nameField}
				</>
			) : (
				<Collapsible open={advanced} onOpenChange={setAdvanced}>
					<CollapsibleTrigger render={<Button type="button" variant="ghost" size="sm" className="group w-fit" />}>
						<Trans>Advanced</Trans>
						<Icon name="caret-down" size={16} className="transition-transform group-aria-expanded:rotate-180" />
					</CollapsibleTrigger>
					<CollapsibleContent>
						<div className="grid gap-3 pt-3">
							{nameField}
							{urlField}
						</div>
					</CollapsibleContent>
				</Collapsible>
			)}
			{explanation && !(urlError && (compatible || advanced)) && (
				<p role="status" className="text-xs text-ink-3">
					{explanation}
				</p>
			)}
		</div>
	);
}
