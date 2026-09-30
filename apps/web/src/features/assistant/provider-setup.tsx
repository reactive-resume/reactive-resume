import type { AIProvider } from "@reactive-resume/ai/types";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useId, useState } from "react";
import { Button, buttonVariants } from "@reactive-resume/ui/components/button";
import { Collapsible, CollapsibleContent } from "@reactive-resume/ui/components/collapsible";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { Label } from "@reactive-resume/ui/components/label";
import { cn } from "@reactive-resume/utils/style";
import { getOrpcErrorMessage } from "@/libs/error-message";
import { client, orpc } from "@/libs/orpc/client";

type Choice = { provider: AIProvider; label: string; model: string; needsBaseURL?: boolean };

// Provider names are brands and stay untranslated.
const CHOICES: Choice[] = [
	{ provider: "openai", label: "OpenAI", model: "gpt-4.1" },
	{ provider: "anthropic", label: "Anthropic", model: "claude-3-5-sonnet-latest" },
	{ provider: "openai-compatible", label: "OpenAI-compatible", model: "", needsBaseURL: true },
];

/**
 * D1: connecting a provider in place. The key is stored encrypted and tested at once; the assistant is ready as soon
 * as the test passes. Settings keep every other provider and option.
 */
export function ProviderSetup() {
	const [open, setOpen] = useState<AIProvider | null>(null);

	return (
		<div className="grid gap-4 p-4">
			<div className="grid gap-1">
				<h3 className="text-[15px] font-semibold">
					<Trans>Connect an AI provider</Trans>
				</h3>
				<p className="text-sm text-ink-2">
					<Trans>The assistant uses your own key. Nothing is sent anywhere until you connect one.</Trans>
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
									name="chevron_right"
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

function ConnectForm({ choice }: { choice: Choice }) {
	const id = useId();
	const queryClient = useQueryClient();
	const [apiKey, setApiKey] = useState("");
	const [model, setModel] = useState(choice.model);
	const [baseURL, setBaseURL] = useState("");
	const [failure, setFailure] = useState<string | null>(null);

	const connect = useMutation({
		mutationFn: async () => {
			const created = await client.aiProviders.create({
				label: choice.label,
				provider: choice.provider,
				model: model.trim(),
				apiKey: apiKey.trim(),
				...(baseURL.trim() ? { baseURL: baseURL.trim() } : {}),
			});
			return client.aiProviders.test({ id: created.id });
		},
		onSuccess: async (tested) => {
			await queryClient.invalidateQueries({ queryKey: orpc.aiProviders.list.key() });
			setFailure(
				tested.testStatus === "success"
					? null
					: (tested.testError ?? t`The provider didn't answer. Check the key and the model.`),
			);
		},
		onError: (error) =>
			setFailure(getOrpcErrorMessage(error, { fallback: t`Couldn't connect. Check the key and try again.` })),
	});

	const ready = apiKey.trim() && model.trim() && (!choice.needsBaseURL || baseURL.trim());

	return (
		<form
			className="grid gap-3 border-t border-line bg-bg p-3"
			onSubmit={(event) => {
				event.preventDefault();
				if (ready) connect.mutate();
			}}
		>
			{choice.needsBaseURL && (
				<div className="grid gap-1.5">
					<Label htmlFor={`${id}-url`}>
						<Trans>Base URL</Trans>
					</Label>
					<Input
						id={`${id}-url`}
						value={baseURL}
						placeholder="https://…/v1"
						onChange={(event) => setBaseURL(event.target.value)}
					/>
				</div>
			)}
			<div className="grid gap-1.5">
				<Label htmlFor={`${id}-key`}>
					<Trans>API key</Trans>
				</Label>
				<Input
					id={`${id}-key`}
					type="password"
					autoComplete="off"
					value={apiKey}
					onChange={(event) => setApiKey(event.target.value)}
				/>
			</div>
			<div className="grid gap-1.5">
				<Label htmlFor={`${id}-model`}>
					<Trans>Model</Trans>
				</Label>
				<Input id={`${id}-model`} value={model} onChange={(event) => setModel(event.target.value)} />
			</div>
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
