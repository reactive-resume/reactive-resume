import type { TemplateSemanticManifest } from "../../semantic/template-manifest";
import { baseManifest, itemHeaderRowPart } from "../../semantic/shared-parts";

export const meowthSemanticManifest = baseManifest("meowth", [itemHeaderRowPart]) satisfies TemplateSemanticManifest;
