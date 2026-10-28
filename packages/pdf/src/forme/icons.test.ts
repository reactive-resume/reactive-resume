import { beforeAll, expect, it } from "vite-plus/test";
import { loadAllIcons, PhosphorIcon } from "./icons";

beforeAll(loadAllIcons);

it("serializes only numeric paint, even when a colour contains markup", () => {
	const icon = PhosphorIcon({ name: "phone", color: 'rgb(0,0,0)"><script>test()</script>)' });
	expect(icon).not.toBeNull();
	expect(icon?.props.content).toContain('fill="#000000"');
	expect(icon?.props.content).not.toContain("<script");
});

it("combines hex alpha with icon opacity", () => {
	const icon = PhosphorIcon({ name: "phone", color: "#00000080", opacity: 0.5 });
	expect(icon?.props.content).toContain(`fill-opacity="${(128 / 255) * 0.5}"`);
});
