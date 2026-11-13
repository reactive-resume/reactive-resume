// One entry per storyboard screen (screens/manifest.json): the hrefs to replay, the fixture to seed, and anything to
// prepare before measuring. Each screen agent owns one file under scenarios/.
import type { Scenario } from "./harness";
import { scenarios as a } from "./scenarios/a";
import { scenarios as b } from "./scenarios/b";
import { scenarios as c } from "./scenarios/c";
import { scenarios as d } from "./scenarios/d";
import { scenarios as e } from "./scenarios/e";
import { scenarios as f } from "./scenarios/f";

export const scenarios: Record<string, Scenario> = { Kit: { hrefs: ["/kit"] }, ...a, ...b, ...c, ...d, ...e, ...f };
