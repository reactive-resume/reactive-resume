import type { AIProvider } from "@reactive-resume/ai/types";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { AI_PROVIDER_DEFAULT_MODELS, getAIProviderSetupProblem } from "@reactive-resume/ai/defaults";
import { Button, buttonVariants } from "@reactive-resume/ui/components/button";
import { Collapsible, CollapsibleContent } from "@reactive-resume/ui/components/collapsible";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@reactive-resume/ui/components/dialog";
import { Icon } from "@reactive-resume/ui/components/icon";
import { cn } from "@reactive-resume/utils/style";
import { ProviderFieldsForm, type ProviderFields } from "@/features/settings/ai/provider-fields";
import { ProvidersSection } from "@/features/settings/ai/providers";
import { providerTestError } from "@/features/settings/ai/test-error";
import { AiProviderLoadState } from "@/features/settings/integrations/ai-provider-load-state";
import { useHasUsableAiProvider } from "@/features/settings/integrations/hooks/use-has-usable-ai-provider";
import { getOrpcErrorMessage } from "@/libs/error-message";
import { client, orpc } from "@/libs/orpc/client";

type Choice = { provider: AIProvider; label: string; model: string };

// Provider names are brands and stay untranslated.
const CHOICES: Choice[] = [
	{ provider: "openai", label: "OpenAI", model: AI_PROVIDER_DEFAULT_MODELS.openai },
	{ provider: "anthropic", label: "Anthropic", model: AI_PROVIDER_DEFAULT_MODELS.anthropic },
	{ provider: "openai-compatible", label: "OpenAI-compatible", model: "" },
];

/**
 * D1: connecting a provider in place. The key is stored encrypted and tested at once; the assistant is ready as soon
 * as the test passes. Settings keep every other provider and option.
 */
type ProviderSetupProps = {
	/** Connect another one, even when providers are saved (the assistant's model menu). */
	connectOnly?: boolean;
};

export function ProviderSetup({ connectOnly = false }: ProviderSetupProps) {
	const [open, setOpen] = useState<AIProvider | null>(null);
	const state = useHasUsableAiProvider();
	if (state.isUnavailable) return <AiProviderLoadState state={state} />;
	if (state.providers.length > 0 && !connectOnly)
		return (
			<div className="grid gap-3 p-4">
				<p role="status" className="text-sm text-warn-text">
					{state.hasUsableProvider ? (
						<Trans>AI providers</Trans>
					) : (
						<Trans>
							Your saved AI connections need attention. Test or edit them below. History and saved proposals remain
							available.
						</Trans>
					)}
				</p>
				<ProvidersSection />
			</div>
		);

	return (
		<div className="grid gap-4 p-4">
			<div className="grid gap-1">
				<h3 className="text-[15px] font-semibold">
					<Trans>Connect an AI provider</Trans>
				</h3>
				<p className="text-sm text-ink-2">
					<Trans>
						AI features use your own provider. Connecting sends a test prompt; each task asks before sharing its data.
					</Trans>
				</p>
			</div>

			<ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
				{CHOICES.map((choice) => {
					const expanded = open === choice.provider;
					return (
						<li key={choice.provider}>
							<button
								type="button"
								aria-expanded={expanded}
								onClick={() => setOpen(expanded ? null : choice.provider)}
								className="flex h-11 w-full items-center justify-between px-3 text-start text-sm transition-colors duration-quick hover:bg-hover"
							>
								{choice.provider === "openai-compatible" ? <Trans>Other · OpenAI-compatible</Trans> : choice.label}
								<Icon
									name="caret-right"
									size={18}
									className={cn(
										"text-ink-3 transition-transform duration-standard ease-enter",
										expanded && "rotate-90",
									)}
								/>
							</button>
							<Collapsible open={expanded}>
								<CollapsibleContent>
									<ConnectForm choice={choice} />
								</CollapsibleContent>
							</Collapsible>
						</li>
					);
				})}
			</ul>

			<p className="text-xs text-ink-3">
				<Trans>
					More providers and options are in{" "}
					<Link to="/dashboard/settings/ai" className={buttonVariants({ variant: "link", size: "sm" })}>
						Settings
					</Link>
					. The rest of the app works fully without AI.
				</Trans>
			</p>
		</div>
	);
}

type ConnectFormProps = { choice: Choice };
function ConnectForm({ choice }: ConnectFormProps) {
	const queryClient = useQueryClient();
	const createdId = useRef<string | null>(null);
	const submitting = useRef(false);
	const [fields, setFields] = useState<ProviderFields>({
		label: choice.label,
		apiKey: "",
		model: choice.model,
		baseURL: "",
	});
	const [failure, setFailure] = useState<string | null>(null);

	const connect = useMutation({
		mutationFn: async () => {
			const input = {
				label: fields.label.trim() || choice.label,
				provider: choice.provider,
				model: fields.model.trim(),
				apiKey: fields.apiKey.trim(),
				...(fields.baseURL.trim() ? { baseURL: fields.baseURL.trim() } : {}),
			};
			const created = createdId.current
				? await client.aiProviders.update({ id: createdId.current, ...input })
				: await client.aiProviders.create(input);
			createdId.current = created.id;
			return client.aiProviders.test({ id: created.id });
		},
		onSettled: () => {
			submitting.current = false;
		},
		onSuccess: async (tested) => {
			await queryClient.invalidateQueries({ queryKey: orpc.aiProviders.list.key() });
			setFailure(tested.testStatus === "success" ? null : providerTestError(tested.testErrorKind));
		},
		onError: (error) =>
			setFailure(getOrpcErrorMessage(error, { fallback: t`Couldn't connect. Check the key and try again.` })),
	});

	const ready = getAIProviderSetupProblem(choice.provider, fields) === null;

	return (
		<form
			noValidate
			className="grid gap-3 border-t border-line bg-bg p-3"
			onSubmit={(event) => {
				event.preventDefault();
				if (ready && !submitting.current) {
					submitting.current = true;
					connect.mutate();
				}
			}}
		>
			<ProviderFieldsForm provider={choice.provider} value={fields} onChange={setFields} />
			{failure && (
				<p role="alert" className="text-xs text-danger-text">
					{failure}
				</p>
			)}
			<Button
				type="submit"
				size="sm"
				className="w-fit"
				disabled={!ready || connect.isPending}
				loading={connect.isPending}
			>
				{connect.isPending ? <Trans>Testing the connection…</Trans> : <Trans>Connect</Trans>}
			</Button>
		</form>
	);
}

/** Keeps the task mounted, including typed input and selected files, while fixing a connection. */
export function SetUpAi() {
	const [open, setOpen] = useState(false);
	return (
		<>
			<Button type="button" size="sm" variant="secondary" className="w-fit" onClick={() => setOpen(true)}>
				<Trans>Set up AI</Trans>
			</Button>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent closeLabel={t`Close`} className="max-h-[85svh] overflow-y-auto">
					<DialogHeader>
						<DialogTitle>
							<Trans>Set up AI</Trans>
						</DialogTitle>
					</DialogHeader>
					<ProviderSetup />
				</DialogContent>
			</Dialog>
		</>
	);
}
