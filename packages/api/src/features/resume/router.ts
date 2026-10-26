import { publicProcedure } from "../../context";
import { crudRouter } from "./crud";
import { updatesRouter } from "./event-router";
import { getRootResume } from "./root";
import { ownerViewer, sharingRouter } from "./sharing";
import { resumeStatisticsRouter } from "./statistics";
import { tagsRouter } from "./tags";
import { versionsRouter } from "./versions";

export const resumeRouter = {
	getRoot: publicProcedure
		.route({ tags: ["Internal"] })
		.handler(({ context }) => getRootResume({ requestHeaders: context.reqHeaders, ...ownerViewer(context) })),
	tags: tagsRouter,
	statistics: resumeStatisticsRouter,
	updates: updatesRouter,

	list: crudRouter.list,
	getById: crudRouter.getById,
	getBySlug: sharingRouter.getBySlug,
	previewUrl: sharingRouter.previewUrl,
	checkSlug: sharingRouter.checkSlug,
	create: crudRouter.create,
	import: crudRouter.import,
	update: crudRouter.update,
	patch: crudRouter.patch,
	setLocked: crudRouter.setLocked,
	setPassword: sharingRouter.setPassword,
	verifyPassword: sharingRouter.verifyPassword,
	removePassword: sharingRouter.removePassword,
	duplicate: crudRouter.duplicate,
	delete: crudRouter.delete,
	listVersions: versionsRouter.listVersions,
	getVersion: versionsRouter.getVersion,
	createVersion: versionsRouter.createVersion,
	renameVersion: versionsRouter.renameVersion,
	deleteVersion: versionsRouter.deleteVersion,
	restoreVersion: versionsRouter.restoreVersion,
};
