export type DeferredFetch = (send: () => Promise<Response>) => Promise<Response>;
export type PreparedRequest<T> = { send: () => Promise<T>; cancel: () => void };

/** Prepare all asynchronous work first; send starts the transport in the caller's stack, including during page exit. */
export function prepareRequest<T>(call: (defer: DeferredFetch) => Promise<T>): Promise<PreparedRequest<T>> {
	let prepared!: (request: PreparedRequest<T>) => void;
	let failed!: (error: unknown) => void;
	const ready = new Promise<PreparedRequest<T>>((resolve, reject) => {
		prepared = resolve;
		failed = reject;
	});
	let receive!: (response: Response | PromiseLike<Response>) => void;
	let reject!: (error: unknown) => void;
	const response = new Promise<Response>((resolve, fail) => {
		receive = resolve;
		reject = fail;
	});
	let state: "waiting" | "held" | "sent" | "cancelled" = "waiting";
	const result = Promise.resolve().then(() =>
		call((send) => {
			// A transport's authenticated retry (for example after token refresh) follows the first authorized send.
			if (state === "sent") return send();
			if (state === "cancelled") return Promise.reject(new DOMException("", "AbortError"));
			if (state === "held") return Promise.reject(new Error("Request already prepared"));
			state = "held";
			prepared({
				send: () => {
					if (state === "held") {
						state = "sent";
						try {
							receive(send());
						} catch (error) {
							reject(error);
						}
					}
					return result;
				},
				cancel: () => {
					if (state !== "held") return;
					state = "cancelled";
					reject(new DOMException("", "AbortError"));
				},
			});
			return response;
		}),
	);
	void result.then(
		() => failed(new Error("Request was not prepared")),
		(error) => {
			if (state === "held") {
				state = "cancelled";
				reject(error);
			}
			failed(error);
		},
	);
	// A callback may fail independently after handing over its transport.
	void response.catch(() => {});
	return ready;
}
