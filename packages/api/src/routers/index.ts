import { agentRouter } from "../features/agent/router";
import { aiProvidersRouter } from "../features/ai-providers/router";
import { aiRouter } from "../features/ai/router";
import { applicationsRouter } from "../features/applications/router";
import { authRouter } from "../features/auth/router";
import { coverLettersRouter } from "../features/cover-letters/router";
import { documentsRouter } from "../features/documents/router";
import { flagsRouter } from "../features/flags/router";
import { resumeRouter } from "../features/resume/router";
import { statisticsRouter } from "../features/statistics/router";
import { storageRouter } from "../features/storage/router";
import { webAccessRouter } from "../features/web-access/router";

export default {
	ai: aiRouter,
	aiProviders: aiProvidersRouter,
	agent: agentRouter,
	applications: applicationsRouter,
	auth: authRouter,
	coverLetters: coverLettersRouter,
	documents: documentsRouter,
	flags: flagsRouter,
	resume: resumeRouter,
	statistics: statisticsRouter,
	storage: storageRouter,
	webAccess: webAccessRouter,
};
