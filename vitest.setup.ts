import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Several units under test transitively import the validated server env, which throws at import
// time when a required variable is missing. Tests are expected to run without a .env, so seed the
// three required variables here — before any test module loads. Real values still win.
process.env.APP_URL ??= "http://localhost:3000";
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/postgres";
process.env.AUTH_SECRET ??= "test-auth-secret";

// React Testing Library auto-cleanup hooks into afterEach as a global, but Vitest
// only exposes `afterEach` globally when `test.globals: true` is set. We register
// the cleanup explicitly so component tests do not leak DOM between runs.
afterEach(() => {
	cleanup();
});

// Same reason as the cleanup above: RTL flips `IS_REACT_ACT_ENVIRONMENT` from its own global
// `beforeAll`/`afterAll` hooks, which it skips without `test.globals`. Without the flag React
// logs "The current testing environment is not configured to support act(...)" on every
// `act()` call, so set it here instead.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
