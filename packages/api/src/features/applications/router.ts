import { aiRouter } from "./ai";
import { crudRouter } from "./crud";
import { applicationLanesRouter } from "./lane-router";

export const applicationsRouter = {
	lanes: applicationLanesRouter,
	findPosting: crudRouter.findPosting,
	priorNoResponse: crudRouter.priorNoResponse,
	list: crudRouter.list,
	listSummary: crudRouter.listSummary,
	getById: crudRouter.getById,
	create: crudRouter.create,
	import: crudRouter.import,
	update: crudRouter.update,
	attachDocument: crudRouter.attachDocument,
	removeDocument: crudRouter.removeDocument,
	addNote: crudRouter.addNote,
	addInterview: crudRouter.addInterview,
	updateInterview: crudRouter.updateInterview,
	updateTimelineEntry: crudRouter.updateTimelineEntry,
	deleteTimelineEntry: crudRouter.deleteTimelineEntry,
	delete: crudRouter.delete,
	bulkUpdate: crudRouter.bulkUpdate,
	bulkDelete: crudRouter.bulkDelete,
	stats: crudRouter.stats,
	tags: crudRouter.tags,
	ai: aiRouter,
};
