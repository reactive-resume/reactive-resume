// One entry per storyboard screen (screens/manifest.json): the hrefs to replay, the fixture to seed, and anything to
// prepare before measuring. Screen agents add their screens here.
import type { Scenario } from "./harness";

export const scenarios: Record<string, Scenario> = {
	Kit: { hrefs: ["/kit"] },
	"B1-Overview": { hrefs: ["/", "/builder/res_product_designer"] },
};
