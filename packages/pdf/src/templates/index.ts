import type { TemplatePage } from "../document";
import type { Template } from "@reactive-resume/schema/templates";
import { AzurillPage } from "./azurill/AzurillPage";
import { BronzorPage } from "./bronzor/BronzorPage";
import { ChikoritaPage } from "./chikorita/ChikoritaPage";
import { DitgarPage } from "./ditgar/DitgarPage";
import { DittoPage } from "./ditto/DittoPage";
import { GengarPage } from "./gengar/GengarPage";
import { GlaliePage } from "./glalie/GlaliePage";
import { KakunaPage } from "./kakuna/KakunaPage";
import { LaprasPage } from "./lapras/LaprasPage";
import { LeafishPage } from "./leafish/LeafishPage";
import { MeowthPage } from "./meowth/MeowthPage";
import { OnyxPage } from "./onyx/OnyxPage";
import { PikachuPage } from "./pikachu/PikachuPage";
import { RhyhornPage } from "./rhyhorn/RhyhornPage";
import { ScizorPage } from "./scizor/ScizorPage";

const templatePages: Partial<Record<Template, TemplatePage>> = {
	azurill: AzurillPage,
	bronzor: BronzorPage,
	chikorita: ChikoritaPage,
	ditgar: DitgarPage,
	ditto: DittoPage,
	gengar: GengarPage,
	glalie: GlaliePage,
	kakuna: KakunaPage,
	lapras: LaprasPage,
	leafish: LeafishPage,
	meowth: MeowthPage,
	onyx: OnyxPage,
	pikachu: PikachuPage,
	rhyhorn: RhyhornPage,
	scizor: ScizorPage,
};

const defaultTemplatePage = AzurillPage;

export const getTemplatePage = (template: Template): TemplatePage => templatePages[template] ?? defaultTemplatePage;
