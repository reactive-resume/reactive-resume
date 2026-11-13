import type { ProviderFields } from "@/features/settings/ai/provider-fields";
import type { RouterOutput } from "@/libs/orpc/client";
import type { AIProvider } from "@reactive-resume/ai/types";
import type { ReactNode } from "react";
import { i18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useId, useRef, useState } from "react";
import { getAIProviderSetupProblem } from "@reactive-resume/ai/defaults";
import { Badge } from "@reactive-resume/ui/components/badge";
import { Button } from "@reactive-resume/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@reactive-resume/ui/components/dialog";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Label } from "@reactive-resume/ui/components/label";
import { SetUpAiLine } from "@/components/calm/set-up-ai-line";
import { Combobox } from "@/components/ui/combobox";
import { keyEnding, providerDefaults, providerLabel, providerOptions } from "@/features/settings/ai/catalog";
import { TryItOn } from "@/features/settings/ai/next-steps";
import { ProviderFieldsForm } from "@/features/settings/ai/provider-fields";
import { providerTestError } from "@/features/settings/ai/test-error";
import { useHasUsableAiProvider } from "@/features/settings/integrations/hooks/use-has-usable-ai-provider";
import { getOrpcErrorMessage } from "@/libs/error-message";
import { client, orpc } from "@/libs/orpc/client";

type SavedProvider = RouterOutput["aiProviders"]["list"][number];
type Connected = { provider: SavedProvider; milliseconds: number; first: boolean };

const blank = (provider: AIProvider): ProviderFields => ({
	label: "",
	apiKey: "",
	fastModel: "",
	capableModel: "",
	...providerDefaults(provider),
});

type ConnectionFormProps = {
	/** Ends the form's footer: Cancel in the dialog. */
	cancel?: ReactNode;
	onTesting: (testing: { provider: AIProvider; model: string; key: string } | null) => void;
	onConnected: (connected: Connected) => void;
};

/**
 * Provider, key and model, with task models and the name and base URL folded. Save and test stores the key, then sends
 * one test prompt; a failure stays in the form with its reason.
 */
export function ConnectionForm({ cancel, onTesting, onConnected }: ConnectionFormProps) {
	const id = useId();
	const queryClient = useQueryClient();
	const state = useHasUsableAiProvider();
	const [provider, setProvider] = useState<AIProvider>("openai");
	const [fields, setFields] = useState<ProviderFields>(blank("openai"));
	const [failure, setFailure] = useState<{ message: string; key: boolean } | null>(null);
	const [pending, setPending] = useState(false);
	// A failed test keeps the saved row; trying again updates it instead of adding a second one.
	const createdId = useRef<string | null>(null);
	const [attemptId, setAttemptId] = useState<string | null>(null);
	const ready = getAIProviderSetupProblem(provider, fields) === null;

	const save = async () => {
		if (pending) return;
		setPending(true);
		setFailure(null);
		const first = !state.providers.some((saved) => saved.testStatus === "success");
		const input = {
			label: fields.label.trim() || providerLabel(provider),
			provider,
			model: fields.model.trim(),
			fastModel: fields.fastModel.trim(),
			capableModel: fields.capableModel.trim(),
			apiKey: fields.apiKey.trim(),
			...(fields.baseURL.trim() ? { baseURL: fields.baseURL.trim() } : {}),
		};
		onTesting({ provider, model: input.model, key: input.apiKey });
		try {
			const saved = createdId.current
				? await client.aiProviders.update({ id: createdId.current, ...input })
				: await client.aiProviders.create(input);
			createdId.current = saved.id;
			setAttemptId(saved.id);
			const started = performance.now();
			const tested = await client.aiProviders.test({ id: saved.id });
			if (tested.testStatus === "success")
				onConnected({ provider: tested, milliseconds: performance.now() - started, first });
			else {
				onTesting(null);
				setFailure({ message: providerTestError(tested.testErrorKind), key: tested.testErrorKind === "auth" });
			}
		} catch (error) {
			onTesting(null);
			setFailure({
				message: getOrpcErrorMessage(error, {
					byCode: {
						PRECONDITION_FAILED: t`AI connections aren't available on this server until ENCRYPTION_SECRET is set.`,
						BAD_REQUEST: t`That connection isn't valid. Check the base URL.`,
					},
					fallback: t`Couldn't connect. Check the key and try again.`,
				}),
				key: false,
			});
		}
		setPending(false);
		void queryClient.invalidateQueries({ queryKey: orpc.aiProviders.list.key() });
	};

	return (
		<form
			noValidate
			className="grid gap-[18px]"
			onSubmit={(event) => {
				event.preventDefault();
				if (ready) void save();
			}}
		>
			{state.providers.some((saved) => saved.id !== attemptId) && !state.hasUsableProvider && (
				<p role="status" className="rounded-lg bg-warn-soft px-3 py-2.5 text-[13px]/[18px] text-warn-text">
					<Trans>
						Your saved connections need attention. Fix them in{" "}
						<Link to="/dashboard/settings/ai" className="font-medium underline">
							Settings › AI
						</Link>
						, or add one here.
					</Trans>
				</p>
			)}
			<div className="grid gap-1.5">
				<Label htmlFor={`${id}-provider`}>
					<Trans>Provider</Trans>
				</Label>
				<Combobox
					id={`${id}-provider`}
					value={provider}
					showClear={false}
					columns={2}
					options={providerOptions}
					onValueChange={(next) => {
						if (!next) return;
						setProvider(next);
						setFields(blank(next));
						setFailure(null);
					}}
				/>
			</div>
			<ProviderFieldsForm
				key={provider}
				provider={provider}
				value={fields}
				onChange={setFields}
				keyError={failure?.key ? failure.message : undefined}
			/>
			{failure && !failure.key && (
				<p role="alert" className="-mt-2 flex items-start gap-1.5 text-[13px]/[18px] text-danger-text">
					<Icon name="warning-circle" size={14} className="mt-0.5 shrink-0" />
					{failure.message}
				</p>
			)}
			<p className="text-xs leading-4 text-ink-3">
				<Trans>Saving sends one test prompt. Your provider may charge for requests made with your key.</Trans>
			</p>
			<DialogFooter>
				{cancel}
				<Button type="submit" disabled={!ready || pending} loading={pending}>
					<Trans>Save and test</Trans>
				</Button>
			</DialogFooter>
		</form>
	);
}

type SetUpAiDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The accent once connected: back to the page that asked ("Back to Practice"). Defaults to Done. */
	backLabel?: ReactNode;
};

/** N11: the one Set up AI dialog, opened over the page that needs it. Closing saves nothing. */
export function SetUpAiDialog({ open, onOpenChange, backLabel }: SetUpAiDialogProps) {
	const [testing, setTesting] = useState<{ provider: AIProvider; model: string; key: string } | null>(null);
	const [connected, setConnected] = useState<Connected | null>(null);
	const [round, setRound] = useState(0);
	const close = () => onOpenChange(false);
	const reset = () => {
		setTesting(null);
		setConnected(null);
		setRound((value) => value + 1);
	};
	const cancel = (
		<Button type="button" variant="ghost" onClick={close}>
			<Trans>Cancel</Trans>
		</Button>
	);

	return (
		<Dialog open={open} onOpenChange={onOpenChange} onOpenChangeComplete={(next) => next || reset()}>
			<DialogContent closeLabel={t`Close`} className="max-h-[90svh] overflow-y-auto">
				{connected ? (
					<>
						<DialogHeader>
							<DialogTitle>
								<Trans>AI is ready</Trans>
							</DialogTitle>
						</DialogHeader>
						<div className="flex items-center gap-3.5 border-y border-line py-2.5">
							<span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent-text">
								<Icon name="check" />
							</span>
							<span className="flex min-w-0 flex-1 flex-col gap-px">
								<span className="truncate text-sm/5 font-medium">{connected.provider.label}</span>
								<span className="truncate text-[13px]/[18px] text-ink-3">
									<Trans>
										{connected.provider.model} · Connected · {i18n.number(Math.round(connected.milliseconds))} ms
									</Trans>
								</span>
							</span>
							{connected.provider.isDefault && (
								<Badge variant="accent">
									<Trans>Default</Trans>
								</Badge>
							)}
						</div>
						<p className="text-sm/5 text-ink-2">
							{connected.first ? (
								<Trans>The first connection is the default. Each task asks before it shares your data.</Trans>
							) : (
								<Trans>Each task asks before it shares your data.</Trans>
							)}
						</p>
						<div className="grid gap-2">
							<p className="text-xs text-ink-3">
								<Trans>Or try it on</Trans>
							</p>
							<TryItOn onLeave={close} />
						</div>
						<DialogFooter>
							<Button type="button" variant="ghost" onClick={reset}>
								<Trans>Add another connection</Trans>
							</Button>
							<Button type="button" onClick={close}>
								{backLabel ?? <Trans>Done</Trans>}
							</Button>
						</DialogFooter>
					</>
				) : (
					<>
						<DialogHeader className="gap-1.5">
							<DialogTitle>
								<Trans>Set up AI</Trans>
							</DialogTitle>
							{!testing && (
								<DialogDescription>
									<Trans>
										AI features use your own provider. The key is encrypted on the server and never shown again.
									</Trans>
								</DialogDescription>
							)}
						</DialogHeader>
						{testing && (
							<>
								<div className="flex items-center gap-3 rounded-lg bg-sunken px-3.5 py-3">
									<Icon name="key" className="text-ink-3" />
									<span className="flex min-w-0 flex-col">
										<span className="truncate text-sm/5 font-medium">
											{providerLabel(testing.provider)} · {testing.model}
										</span>
										<span className="text-xs text-ink-3">
											<Trans>Key ends in {keyEnding(`...${testing.key.slice(-4)}`)} · saved, encrypted</Trans>
										</span>
									</span>
								</div>
								<DialogFooter>
									{cancel}
									<Button disabled loading>
										<Trans>Testing the connection…</Trans>
									</Button>
								</DialogFooter>
							</>
						)}
						{/* Kept mounted while testing, so a failure comes back to the fields as typed. */}
						<div hidden={Boolean(testing)}>
							<ConnectionForm key={round} cancel={cancel} onTesting={setTesting} onConnected={setConnected} />
						</div>
					</>
				)}
			</DialogContent>
		</Dialog>
	);
}

/** Opens the Set up AI dialog in place; render `dialog` once in the component that calls it. */
export function useSetUpAi(options: { backLabel?: ReactNode } = {}) {
	const [open, setOpen] = useState(false);
	return {
		open: () => setOpen(true),
		dialog: <SetUpAiDialog open={open} onOpenChange={setOpen} backLabel={options.backLabel} />,
	};
}

type SetUpAiProps = {
	/** What needs AI here, as a sentence: "A fit check needs AI." */
	needs: ReactNode;
	/** What works without it: "The posting's terms, your resume and your Knowledge work without it." */
	works?: ReactNode;
	/** The accent once connected ("Back to Practice"). */
	backLabel?: ReactNode;
	className?: string;
};

/**
 * N12: the Set up AI line and its dialog. It shows only when the account has no working connection, and stays quiet
 * while that is still being looked up (callers show their own loading and lookup errors).
 */
export function SetUpAi({ needs, works, backLabel, className }: SetUpAiProps) {
	const state = useHasUsableAiProvider();
	const setUp = useSetUpAi({ backLabel });
	// The dialog stays mounted once the line goes, so it can say "AI is ready".
	return (
		<>
			{!state.isUnavailable && !state.hasUsableProvider && (
				<SetUpAiLine lead={needs} onSetUp={setUp.open} {...(className ? { className } : {})}>
					{works}
				</SetUpAiLine>
			)}
			{setUp.dialog}
		</>
	);
}
