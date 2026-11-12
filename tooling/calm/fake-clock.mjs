// Preloaded into the Calm dev server only (tooling/calm/dev.mjs). The server's clock starts at CALM_NOW on every
// (re)start and then advances one second per real minute: it stays the same morning for weeks, so seeded schedules
// never fall due, Trash never expires and anything the server stamps agrees with the frozen browser clock.
// Postgres `now()` is not affected. Set CALM_REAL_CLOCK=1 to switch this off.
const anchor = Date.parse(process.env.CALM_NOW ?? "");
if (anchor && process.env.CALM_REAL_CLOCK !== "1") {
	const Real = Date;
	const start = Real.now();
	const now = () => anchor + Math.floor((Real.now() - start) / 60);
	globalThis.Date = new Proxy(Real, {
		construct: (target, args, newTarget) => Reflect.construct(target, args.length ? args : [now()], newTarget),
		apply: () => new Real(now()).toString(),
		get: (target, key) => (key === "now" ? now : Reflect.get(target, key)),
	});
}
