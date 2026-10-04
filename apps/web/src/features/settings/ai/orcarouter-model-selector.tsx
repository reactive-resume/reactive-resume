import type { RouterOutput } from "@/libs/orpc/client";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { Combobox } from "@/components/ui/combobox";
import { orpc } from "@/libs/orpc/client";

type CatalogModel = RouterOutput["aiProviders"]["orcaCatalog"]["models"][number];

/**
 * Which capability an entry point needs, and which non-text modalities it actually uploads. The
 * server filters the catalog with exactly these rules; a model that has not declared a modality is
 * never offered for an entry point that sends one.
 */
export type OrcaEntryPoint = "chat" | "pdf" | "docx" | "assistant_image";

type ModelOption = { value: string; label: string; keywords: string[] };

function toOption(model: CatalogModel): ModelOption {
	const details = [model.contextLength ? `${Math.round(model.contextLength / 1000)}K context` : null]
		.filter(Boolean)
		.join(" · ");
	return {
		value: model.id,
		label: details ? `${model.id} · ${details}` : model.id,
		keywords: [model.id, model.name, ...model.inputModalities],
	};
}

export type OrcaModelSelectorProps = {
	providerId: string;
	entryPoint: OrcaEntryPoint;
	value: string;
	onValueChange: (value: string) => void;
	disabled?: boolean;
};

/**
 * The model control for OrcaRouter. It is a real selector over the live catalog — never a free-text
 * field with a few example values — and it is recomputed when the provider or the entry point
 * changes. A selected id that the current filter no longer offers is cleared, and the user is told
 * to pick again.
 */
export function OrcaModelSelector({ providerId, entryPoint, value, onValueChange, disabled }: OrcaModelSelectorProps) {
	const id = useId();
	const { data, isPending, isError, isFetching, refetch } = useQuery(
		orpc.aiProviders.orcaCatalog.queryOptions({
			input: { id: providerId, entryPoint },
			staleTime: 5 * 60 * 1000,
			retry: false,
		}),
	);
	const models = data?.models ?? [];
	const options = models.map(toOption);
	const selectedIsOffered = !value || models.some((model) => model.id === value);
	const invalidated = Boolean(value) && !selectedIsOffered && !isPending && !isError;

	return (
		<div className="grid gap-1.5 sm:col-span-2" data-testid="orca-model-selector">
			<div className="flex items-center justify-between gap-2">
				<span className="text-sm font-medium">
					<Trans>Model</Trans>
				</span>
				<div className="flex items-center gap-2 text-xs text-ink-3">
					{isFetching && <Spinner decorative className="size-3.5" />}
					<button type="button" className="underline underline-offset-2 hover:text-ink" onClick={() => void refetch()}>
						<Trans>Refresh</Trans>
					</button>
				</div>
			</div>
			<Combobox
				id={`${id}-model`}
				value={value || null}
				options={options}
				disabled={disabled || isPending}
				placeholder={isPending ? t`Loading models…` : t`Select a model`}
				emptyMessage={t`No models for this capability`}
				align="end"
				onValueChange={(next) => onValueChange(next ?? "")}
			/>
			{isError ? (
				<p role="alert" className="text-xs text-danger-text" data-testid="orca-catalog-error">
					<Trans>The OrcaRouter model list couldn't be loaded. Refresh to try again.</Trans>
				</p>
			) : isPending ? (
				<p className="text-xs text-ink-3">
					<Trans>Loading models from OrcaRouter…</Trans>
				</p>
			) : data?.source === "seed" ? (
				<p className="text-xs text-warn-text" data-testid="orca-catalog-degraded">
					{data.degradedReason ?? <Trans>Showing a small verified list because OrcaRouter was unreachable.</Trans>}
				</p>
			) : models.length === 0 ? (
				<p className="text-xs text-ink-3">
					<Trans>OrcaRouter returned no models for this capability.</Trans>
				</p>
			) : (
				<p className="text-xs text-ink-3">
					<Trans>{models.length} models from OrcaRouter</Trans>
				</p>
			)}
			{invalidated && (
				<p role="alert" className="text-xs text-warn-text" data-testid="orca-model-invalidated">
					<Trans>The previous model is not available for this capability any more. Choose another one.</Trans>
				</p>
			)}
		</div>
	);
}
