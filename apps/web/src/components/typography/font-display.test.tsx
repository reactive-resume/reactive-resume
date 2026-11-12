// @vitest-environment happy-dom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { FontDisplay } from "./font-display";
import { configureFontMirror } from "@/libs/font-source";

vi.mock("motion/react", () => ({ useInView: () => true }));

afterEach(() => {
	cleanup();
	configureFontMirror(undefined);
	vi.unstubAllGlobals();
});

it("loads mirror preview bytes with redirects disabled and isolates CSS faces by source", async () => {
	const faces: { family: string; source: string | ArrayBuffer }[] = [];
	vi.stubGlobal(
		"FontFace",
		class {
			constructor(family: string, source: string | ArrayBuffer) {
				faces.push({ family, source });
			}
			load() {
				return Promise.resolve(this);
			}
		},
	);
	Object.defineProperty(document, "fonts", { configurable: true, value: { add: vi.fn() } });
	const fetcher = vi.fn(async () => new Response(new Uint8Array([0, 1, 0, 0])));
	vi.stubGlobal("fetch", fetcher);
	const props = {
		family: "Preview Test",
		label: "Preview Test",
		type: "web" as const,
		url: "https://fonts.gstatic.com/s/test/preview.ttf",
	};
	configureFontMirror("https://fonts.example/first");
	const view = render(<FontDisplay {...props} />);
	await waitFor(() => expect(faces).toHaveLength(1));
	expect(fetcher).toHaveBeenCalledWith(
		"https://fonts.example/first/fonts.gstatic.com/s/test/preview.ttf",
		expect.objectContaining({ redirect: "error" }),
	);
	expect(faces[0]?.source).toBeInstanceOf(ArrayBuffer);
	configureFontMirror("https://fonts.example/second");
	await act(async () => view.rerender(<FontDisplay {...props} />));
	await waitFor(() => expect(faces).toHaveLength(2));
	expect(faces[0]?.family).not.toBe(faces[1]?.family);
});

it("shows a failed mirror preview as settled instead of still loading", async () => {
	const FontFaceStub = vi.fn();
	vi.stubGlobal("FontFace", FontFaceStub);
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => new Response(null, { status: 404 })),
	);
	configureFontMirror("https://fonts.example/missing");
	const view = render(
		<FontDisplay family="Missing" label="Missing" type="web" url="https://fonts.gstatic.com/s/test/missing.ttf" />,
	);
	await waitFor(() => expect(view.getByText("Missing").className).toContain("opacity-100"));
	expect(FontFaceStub).not.toHaveBeenCalled();
});
