import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { Label } from "@reactive-resume/ui/components/label";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { cn } from "@reactive-resume/utils/style";
import { useOrcaConnect } from "./orcarouter-connect";

/** The two ways in. Neither replaces the other: a key works without a browser, sign-in works without a key. */
export type OrcaAuthMethod = "api_key" | "pkce";

const ORCA_KEY_DASHBOARD_URL = "https://www.orcarouter.ai/console/authorized-apps";

type OrcaAuthMethodsProps = {
	method: OrcaAuthMethod;
	onMethodChange: (method: OrcaAuthMethod) => void;
	/** The pasted key, owned by the parent form so it is saved with the rest of the fields. */
	apiKey: string;
	onApiKeyChange: (value: string) => void;
	apiKeyPlaceholder?: string | undefined;
	/** Called with the new provider row's id once the connect flow stores a key. */
	onConnected: (providerId: string) => void;
	/** Reconnect an existing row rather than creating a new one. */
	providerId?: string | null;
	label?: string | null;
};

export function OrcaAuthMethods(props: OrcaAuthMethodsProps) {
	return (
		<div className="grid gap-3 sm:col-span-2">
			<div role="tablist" aria-label={t`OrcaRouter sign-in method`} className="grid grid-cols-2 gap-2">
				<MethodTab
					active={props.method === "api_key"}
					label={t`API key`}
					hint={t`Paste an sk-orca-… key`}
					onClick={() => props.onMethodChange("api_key")}
					testId="orca-method-api-key"
				/>
				<MethodTab
					active={props.method === "pkce"}
					label={t`Connect with OrcaRouter`}
					hint={t`Sign in with your OrcaRouter account`}
					onClick={() => props.onMethodChange("pkce")}
					testId="orca-method-pkce"
				/>
			</div>
			{props.method === "api_key" ? (
				<div className="grid gap-1.5">
					<Label htmlFor="orca-api-key">
						<Trans>API key</Trans>
					</Label>
					<Input
						id="orca-api-key"
						data-testid="orca-api-key-input"
						type="password"
						value={props.apiKey}
						placeholder={props.apiKeyPlaceholder ?? "sk-orca-…"}
						onChange={(event) => props.onApiKeyChange(event.target.value)}
						autoCorrect="off"
						autoCapitalize="off"
						spellCheck={false}
						{...{ "data-lpignore": "true", "data-1p-ignore": "true", "data-bwignore": "true" }}
					/>
					<p className="text-xs leading-5 text-ink-3">
						<Trans>
							Created in the{" "}
							<a
								href="https://www.orcarouter.ai"
								target="_blank"
								rel="noopener noreferrer"
								className="underline underline-offset-2 hover:text-ink"
							>
								OrcaRouter console
							</a>
							. It is encrypted on the server and never shown again.
						</Trans>
					</p>
				</div>
			) : (
				<ConnectWithOrcaRouter
					providerId={props.providerId ?? null}
					label={props.label ?? null}
					onConnected={props.onConnected}
				/>
			)}
		</div>
	);
}

type MethodTabProps = { active: boolean; label: string; hint: string; onClick: () => void; testId: string };

function MethodTab({ active, label, hint, onClick, testId }: MethodTabProps) {
	return (
		<button
			type="button"
			role="tab"
			aria-selected={active}
			data-testid={testId}
			data-selected={active}
			onClick={onClick}
			className={cn(
				"grid gap-0.5 rounded-[10px] border p-3 text-start transition-colors duration-quick",
				active ? "border-accent bg-accent-soft" : "border-line hover:bg-hover",
			)}
		>
			<span className="text-sm font-medium">{label}</span>
			<span className="text-xs text-ink-3">{hint}</span>
		</button>
	);
}

type ConnectProps = { providerId: string | null; label: string | null; onConnected: (providerId: string) => void };

function ConnectWithOrcaRouter({ providerId, label, onConnected }: ConnectProps) {
	const [code, setCode] = useState("");
	const [copied, setCopied] = useState(false);
	const connect = useOrcaConnect({
		providerId,
		label,
		onConnected: () => onConnected(""),
	});

	const busy = connect.state.phase === "starting" || connect.state.phase === "exchanging";
	const waiting = connect.state.phase === "waiting" || connect.state.phase === "exchanging";
	const authorizeUrl = "authorizeUrl" in connect.state ? connect.state.authorizeUrl : null;

	return (
		<div className="grid gap-3 rounded-[10px] border border-line p-3" data-testid="orca-connect-panel">
			{waiting && authorizeUrl ? (
				<>
					<p className="text-sm leading-5 text-ink-2">
						<Trans>
							Open the OrcaRouter consent screen, approve Reactive Resume, then paste the code it shows below.
						</Trans>
					</p>
					<div className="grid gap-1.5">
						<Label htmlFor="orca-authorize-url">
							<Trans>Consent screen</Trans>
						</Label>
						<div className="flex items-center gap-2">
							<Input id="orca-authorize-url" data-testid="orca-authorize-url" readOnly value={authorizeUrl} />
							<Button
								type="button"
								size="sm"
								variant="secondary"
								onClick={async () => {
									setCopied(true);
									try {
										await navigator.clipboard?.writeText(authorizeUrl);
									} catch {
										// Clipboard access can be denied; the field is selectable as a fallback.
									}
								}}
							>
								{copied ? <Trans>Copied</Trans> : <Trans>Copy</Trans>}
							</Button>
						</div>
					</div>
					<div className="grid gap-1.5">
						<Label htmlFor="orca-code">
							<Trans>Code from OrcaRouter</Trans>
						</Label>
						<Input
							id="orca-code"
							data-testid="orca-code-input"
							value={code}
							autoComplete="off"
							onChange={(event) => setCode(event.target.value)}
						/>
					</div>
				</>
			) : connect.state.phase === "done" ? (
				<p className="flex items-center gap-2 text-sm text-accent-text" data-testid="orca-connect-done">
					<Icon name="check_circle" size={16} />
					<Trans>OrcaRouter account connected.</Trans>
				</p>
			) : (
				<>
					<p className="text-sm leading-5 text-ink-2">
						<Trans>
							Sign in with your OrcaRouter account and Reactive Resume receives its own key, billed to you and revocable
							at any time.
						</Trans>
					</p>
					<p className="text-xs leading-5 text-ink-3">
						<Trans>
							Manage or revoke keys in the{" "}
							<a
								href={ORCA_KEY_DASHBOARD_URL}
								target="_blank"
								rel="noopener noreferrer"
								className="underline underline-offset-2 hover:text-ink"
							>
								authorized apps
							</a>{" "}
							list.
						</Trans>
					</p>
				</>
			)}

			{connect.state.phase === "error" && (
				<p role="alert" data-testid="orca-connect-error" className="text-xs text-danger-text">
					{connect.state.message}
				</p>
			)}

			<div className="flex flex-wrap items-center gap-2">
				{waiting ? (
					<>
						<Button
							type="button"
							size="sm"
							data-testid="orca-connect-submit"
							disabled={!code.trim() || busy}
							loading={connect.state.phase === "exchanging"}
							onClick={() => void connect.complete(code.trim())}
						>
							<Trans>Finish connecting</Trans>
						</Button>
						<Button type="button" size="sm" variant="ghost" data-testid="orca-connect-cancel" onClick={connect.cancel}>
							<Trans>Cancel</Trans>
						</Button>
						{connect.state.phase === "exchanging" && <Spinner decorative className="size-4" />}
					</>
				) : connect.state.phase === "done" ? (
					<Button type="button" size="sm" variant="secondary" onClick={connect.reset}>
						<Trans>Connect again</Trans>
					</Button>
				) : (
					<Button
						type="button"
						size="sm"
						data-testid="orca-connect-start"
						disabled={busy}
						loading={connect.state.phase === "starting"}
						onClick={() => void connect.start()}
					>
						<Trans>Connect with OrcaRouter</Trans>
					</Button>
				)}
			</div>
		</div>
	);
}

export { ORCA_KEY_DASHBOARD_URL };
