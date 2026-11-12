import type { RenderRequest, RenderedPages } from "./types";

type Job = {
	request: RenderRequest;
	resolve: (result: RenderedPages | null) => void;
	reject: (error: unknown) => void;
};

/** One render in flight, one latest request waiting. Even requests still debouncing make older work stale. */
export class PreviewScheduler {
	private latest = 0;
	private pending: Job | undefined;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private running = false;
	private disposed = false;

	constructor(private readonly render: (request: RenderRequest) => Promise<RenderedPages>) {}

	schedule(request: Omit<RenderRequest, "id">): Promise<RenderedPages | null> {
		if (this.disposed) return Promise.resolve(null);
		const id = ++this.latest;
		clearTimeout(this.timer);
		this.pending?.resolve(null);
		return new Promise((resolve, reject) => {
			this.pending = { request: { ...request, id }, resolve, reject };
			this.timer = setTimeout(
				() => {
					this.timer = undefined;
					void this.pump();
				},
				request.focused ? 250 : 100,
			);
		});
	}

	private async pump(): Promise<void> {
		if (this.running || this.timer || this.disposed) return;
		const job = this.pending;
		if (!job) return;
		this.pending = undefined;
		this.running = true;
		try {
			const result = await this.render(job.request);
			job.resolve(!this.disposed && job.request.id === this.latest ? result : null);
		} catch (error) {
			if (!this.disposed && job.request.id === this.latest) job.reject(error);
			else job.resolve(null);
		} finally {
			this.running = false;
			void this.pump();
		}
	}

	/** Drops waiting work and makes any in-flight result stale; a running native render finishes untouched. */
	cancel() {
		this.latest++;
		clearTimeout(this.timer);
		this.timer = undefined;
		this.pending?.resolve(null);
		this.pending = undefined;
	}

	dispose() {
		this.disposed = true;
		this.cancel();
	}
}
