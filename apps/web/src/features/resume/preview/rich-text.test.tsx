// @vitest-environment happy-dom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { RichText } from "./rich-text";

describe("RichText", () => {
	it("never runs the owner's markup", () => {
		const { container } = render(
			<RichText
				html={
					'<p onclick="alert(1)">Hi<img src=x onerror="alert(1)"><script>alert(1)</script><a href="javascript:alert(1)">x</a></p>'
				}
			/>,
		);
		expect(container.querySelector("img, script, [onclick]")).toBeNull();
		expect(container.querySelector("a")).toBeNull();
		expect(container.textContent).toBe("Hix");
	});

	it("renders an element named after an Object member as its text", () => {
		const { container } = render(<RichText html="<p><constructor>Plain</constructor> <strong>bold</strong></p>" />);
		expect(container.textContent).toBe("Plain bold");
		expect(container.querySelector("strong")?.textContent).toBe("bold");
	});
});
