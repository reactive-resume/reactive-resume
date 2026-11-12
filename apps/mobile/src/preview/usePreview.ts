import type { RenderRequest, RenderedPages } from "./types";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { Template } from "@reactive-resume/schema/templates";
import { useEffect, useMemo, useRef, useState } from "react";
import { PixelRatio } from "react-native";
import { createPreviewPipeline } from "./pipeline";
import { PreviewScheduler } from "./scheduler";
import { space } from "@/ui/tokens";

export type PreviewOptions = Pick<RenderRequest, "focused" | "pages" | "renderOptions"> & {
	scale?: number | undefined;
	/** Canvas dimensions in layout points; only intersecting pages are rasterized. */
	viewport?: { width: number; height: number; offset: number; zoom: number } | undefined;
};
export type PreviewState = {
	result: RenderedPages | null;
	rendering: boolean;
	error: boolean;
	/** The failure was fonts missing from the server's font mirror, which only its administrator can fix. */
	missingMirrorFonts: boolean;
	retry: () => void;
	/** Layout points per PDF point, for matching tap overlays to the raster. */
	displayScale: number;
};

/** Data and template are the wave contract; optional viewport settings also serve thumbnails and letters. */
export function usePreview(data: ResumeData | null, template?: Template, options: PreviewOptions = {}): PreviewState {
	const [state, setState] = useState({
		result: null as RenderedPages | null,
		error: false,
		missingMirrorFonts: false,
		job: null as unknown,
	});
	const [attempt, setAttempt] = useState(0);
	const worker = useRef<PreviewScheduler | null>(null);
	const { focused, pages, renderOptions, viewport } = options;
	const sizes = state.result?.pageMap.pages ?? [{ width: 595.28, height: 841.89 }];
	const displayScale = viewport ? (viewport.width / (sizes[0]?.width ?? 595.28)) * viewport.zoom : 1;
	const scale = options.scale ?? Math.min(6, Math.max(0.1, displayScale * PixelRatio.get()));
	const visible =
		pages ??
		(viewport
			? sizes.reduce<{ indices: number[]; top: number }>(
					(value, page, index) => {
						const height = page.height * displayScale + space.s8 + space.s6;
						return {
							top: value.top + height,
							indices:
								value.top + height >= viewport.offset && value.top <= viewport.offset + viewport.height
									? [...value.indices, index]
									: value.indices,
						};
					},
					{ top: 0, indices: [] },
				).indices
			: undefined);
	const pageKey = visible?.join(",");
	const job = useMemo(
		() => ({ data, template, focused, renderOptions, scale, pageKey, attempt }),
		[data, template, focused, renderOptions, scale, pageKey, attempt],
	);

	useEffect(() => {
		const pipeline = createPreviewPipeline();
		const scheduler = new PreviewScheduler(pipeline.render);
		worker.current = scheduler;
		return () => {
			scheduler.dispose();
			worker.current = null;
			void pipeline.dispose().catch(() => undefined);
		};
	}, []);

	useEffect(() => {
		if (!job.data) {
			worker.current?.cancel();
			return;
		}
		let active = true;
		void worker.current
			?.schedule({
				...job,
				data: job.data,
				pages: job.pageKey === undefined ? undefined : job.pageKey.split(",").filter(Boolean).map(Number),
			})
			.then((result) => {
				if (active && result) setState({ result, error: false, missingMirrorFonts: false, job });
			})
			.catch((error: unknown) => {
				const missingMirrorFonts = error instanceof Error && error.cause === "pdf-font-mirror";
				if (active) setState((previous) => ({ ...previous, error: true, missingMirrorFonts, job }));
			});
		return () => {
			active = false;
		};
	}, [job]);

	return {
		result: data ? state.result : null,
		error: state.job === job && state.error,
		missingMirrorFonts: state.job === job && state.error && state.missingMirrorFonts,
		rendering: !!data && state.job !== job,
		displayScale,
		retry: () => setAttempt((value) => value + 1),
	};
}
