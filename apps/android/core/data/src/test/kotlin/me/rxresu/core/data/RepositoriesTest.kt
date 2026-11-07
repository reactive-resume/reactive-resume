package me.rxresu.core.data

import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.test.*
import kotlinx.serialization.json.*
import me.rxresu.core.database.SaveStatus
import me.rxresu.core.network.*
import me.rxresu.core.network.generated.*
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class RepositoriesTest {
    @Test fun storyboardShapesRoundTripThroughGeneratedOperations()=runTest {
        FakeRepositories(coroutineScope=backgroundScope).use { r ->
            val profile=r.account.getProfile();assertEquals("Alex Morgan",profile.name);assertEquals("Europe/Lisbon",profile.timezone)
            val resume=r.resumes.getResume(StoryboardIds.resume)
            assertEquals("Northwind Labs",resume.data.sections.experience.items.first().company)
            assertEquals(resume,ApiJson.decodeFromJsonElement(Resume.serializer(),ApiJson.encodeToJsonElement(Resume.serializer(),resume)))
            val app=r.applications.getApplication(StoryboardIds.lumen)
            val interview=app.activity.filterIsInstance<Interview>().single()
            assertEquals("2026-11-10T10:00:00Z",interview.at);assertEquals("Priya Shah",interview.participants!!.first().name)
            assertEquals(3,r.documents.listDocuments().count { it.type==DocumentType.Resume })
            assertEquals("Lumen cover letter",r.letters.getCoverLetter(StoryboardIds.lumenLetter).name)
            assertTrue(r.career.listCareerSavedItems().any { it.data is Offer })
            assertEquals("Building the shared system",r.career.listCareerStories().first().data.title)
        }
    }
    @Test fun todayComposesBriefingOfferFollowUpAndUpcomingWithPinnedTime()=runTest {
        FakeRepositories(coroutineScope=backgroundScope).use { r ->
            val snapshot=r.today.observe().first { !it.loading }.data!!
            assertEquals(listOf(TodayKind.Briefing,TodayKind.Offer,TodayKind.FollowUp),snapshot.needsYou.map { it.kind })
            assertEquals(listOf("Lumen","Parcel & Co.","Fieldnote"),snapshot.needsYou.map { it.company })
            assertEquals("Orbital Health",snapshot.comingUp.single().company)
            assertEquals("Kiln Studio",snapshot.newRoles.first().company)
            assertEquals("2026-11-07",r.time.today().toString())
            assertFalse(snapshot.firstRun.newAccount);assertFalse(snapshot.firstRun.complete)
        }
    }
    @Test fun fakeMutationsUpdateSameRepositoriesAndObservers()=runTest {
        FakeRepositories(coroutineScope=backgroundScope).use { r ->
            r.documents.renameDocument(ApiJson.decodeFromJsonElement(RenameDocumentRequest.serializer(),buildJsonObject { put("id",StoryboardIds.resume);put("type","resume");put("name","Renamed") }))
            assertEquals("Renamed",r.resumes.getResume(StoryboardIds.resume).name)
            r.documents.setDocumentTags(ApiJson.decodeFromJsonElement(SetDocumentTagsRequest.serializer(),buildJsonObject { put("id",StoryboardIds.resume);put("type","resume");put("tags",JsonArray(emptyList())) }))
            assertTrue(r.resumes.getResume(StoryboardIds.resume).tags.isEmpty())
            r.applications.patchApplication(StoryboardIds.fieldnote,ApiJson.decodeFromJsonElement(PatchApplicationRequest.serializer(),buildJsonObject { put("status","screening") }))
            assertEquals(ApplicationStage.Screening,r.applications.getApplication(StoryboardIds.fieldnote).status)
            r.applications.logApplicationFollowUp(StoryboardIds.fieldnote)
            assertNull(r.applications.getApplication(StoryboardIds.fieldnote).followUpAt)
            val result=r.documents.observe(DocumentQuery(text="Renamed")).first { !it.loading }
            assertEquals("Renamed",result.data!!.single().name)
        }
    }
    @Test fun offlineDraftSyncRetainsDocumentAndUndoRedo()=runTest {
        val controls=FakeControls()
        FakeRepositories(controls=controls,coroutineScope=backgroundScope).use { r ->
            val draft=r.resumes.openDraft(StoryboardIds.resume)
            controls.online.value=false
            val original=draft.state.value.document!!
            draft.update(original.copy(data=original.data.copy(basics=original.data.basics.copy(name="Edited Alex"))));runCurrent()
            assertEquals("Edited Alex",draft.state.value.document!!.data.basics.name)
            assertEquals(SaveStatus.Offline,draft.state.value.status)
            assertEquals(1,r.drafts.pending().first().size)
            draft.undo();runCurrent();assertEquals("Alex Morgan",draft.state.value.document!!.data.basics.name)
            draft.redo();runCurrent();assertEquals("Edited Alex",draft.state.value.document!!.data.basics.name)
            controls.online.value=true;assertTrue(r.drafts.sync());runCurrent()
            assertEquals("Edited Alex",r.resumes.getResume(StoryboardIds.resume).data.basics.name)
            assertEquals(SaveStatus.Saved,draft.state.value.status)
            draft.close()
        }
    }
    @Test fun fakeLoadingEmptyErrorStatesAreControllableWithoutWaiting()=runTest {
        val controls=FakeControls(FakeMode.Loading)
        FakeRepositories(controls=controls,coroutineScope=backgroundScope).use { r ->
            val pending=async { r.documents.listDocuments() };runCurrent();assertFalse(pending.isCompleted)
            controls.mode.value=FakeMode.Empty;assertTrue(pending.await().isEmpty())
            controls.mode.value=FakeMode.Error(ApiException(503,"UNAVAILABLE","Unavailable"))
            assertEquals("UNAVAILABLE",(runCatching { r.documents.listDocuments() }.exceptionOrNull() as ApiException).code)
            controls.reset();assertFalse(r.documents.listDocuments().isEmpty())
        }
    }
    @Test fun preferencesAndSearchUseSharedState()=runTest {
        FakeRepositories(coroutineScope=backgroundScope).use { r ->
            r.preferences.setTheme(ThemePreference.Dark);r.preferences.setHaptics(false)
            r.preferences.setNotification(NotificationCategory.NewRoles,true)
            assertEquals(ThemePreference.Dark,r.preferences.values.first().theme)
            assertFalse(r.preferences.values.first().haptics)
            assertTrue(NotificationCategory.NewRoles in r.preferences.values.first().notifications)
            r.search.remember("Lumen");assertEquals(listOf("Lumen"),r.search.recentSearches.first())
            val results=r.search.search("Lumen").first { !it.loading }
            assertNull(results.error);assertTrue(results.data!!.any { it.kind=="application" });assertTrue(results.data!!.any { it.kind=="resume" })
        }
    }
    @Test fun firstRunDetectionAndCalendarHonorLocalDay()=runTest {
        val controls=FakeControls(FakeMode.Empty)
        FakeRepositories(controls=controls,coroutineScope=backgroundScope).use { r ->
            val apps=r.applications.listApplications();assertTrue(apps.isEmpty())
            val first=r.today.observe().first { !it.loading }
            assertNull(first.error);assertTrue(first.data!!.firstRun.newAccount)
            controls.reset()
            val events=r.applications.calendar();assertTrue(events.any { it.id==StoryboardIds.interview });assertTrue(events.any { it.kind=="offer" })
        }
    }
    @Test fun sharedDraftOwnsReviewedProposalUndoAndMetadataRevision()=runTest {
        FakeRepositories(coroutineScope=backgroundScope).use { r ->
            val draft=r.resumes.openDraft(StoryboardIds.resume)
            assertSame(draft,r.resumes.openDraft(StoryboardIds.resume))
            val original=draft.state.value.document!!
            val edited=original.copy(data=original.data.copy(basics=original.data.basics.copy(headline="Reviewed wording")))
            draft.update(edited,buildJsonObject { put("proposal-1","Reviewed wording") });runCurrent()
            draft.flush();runCurrent()
            assertEquals(JsonPrimitive("Reviewed wording"),draft.state.value.proposalApplications["proposal-1"])
            draft.writeMetadata { baseline -> baseline.withWriteResult(r.resumes.updateResume(baseline.id,UpdateResumeRequest(name="Metadata rename",expectedUpdatedAt=baseline.updatedAt))) }
            draft.undo();runCurrent();draft.flush();runCurrent()
            assertEquals("Metadata rename",draft.state.value.document!!.name)
            assertEquals(original.data.basics.headline,draft.state.value.document!!.data.basics.headline)
            assertEquals(JsonPrimitive(false),draft.state.value.proposalApplications["proposal-1"])
            draft.redo();runCurrent();assertEquals("Reviewed wording",draft.state.value.document!!.data.basics.headline)
            draft.close()
        }
    }
    @Test fun accountSwitchHidesDraftAndRestoresSameOwnersPendingWork()=runTest {
        val auth=FakeAuthSession();val controls=FakeControls()
        FakeRepositories(authSession=auth,controls=controls,coroutineScope=backgroundScope).use { r ->
            val draft=r.resumes.openDraft(StoryboardIds.resume);controls.online.value=false
            draft.update(draft.state.value.document!!.copy(name="Only Alex"));runCurrent()
            auth.state.value=me.rxresu.core.auth.SessionState.SignedIn(auth.origin.value,"other-account");runCurrent()
            assertNull(draft.state.value.document);assertTrue(r.drafts.pending().first().isEmpty())
            auth.state.value=me.rxresu.core.auth.SessionState.SignedIn(auth.origin.value,"storyboard-alex");runCurrent()
            assertEquals("Only Alex",draft.state.value.document!!.name)
            assertSame(draft,r.resumes.openDraft(StoryboardIds.resume));draft.close()
        }
    }
    @Test fun todayDismissUndoAndOfflineCacheKeepAccountState()=runTest {
        val controls=FakeControls()
        FakeRepositories(controls=controls,coroutineScope=backgroundScope).use { r ->
            val first=r.today.observe().first { !it.loading }.data!!
            r.today.dismiss(first.needsYou.first())
            assertEquals(2,r.today.observe().first { !it.loading }.data!!.needsYou.size)
            r.today.undoDismiss(first.needsYou.first())
            assertEquals(3,r.today.observe().first { !it.loading }.data!!.needsYou.size)
            r.documents.observe().first { !it.loading }
            controls.online.value=false
            val cached=r.documents.observe().first { !it.loading }
            assertTrue(cached.offline);assertFalse(cached.data.isNullOrEmpty())
        }
    }
    @Test fun generatedAreasHaveUsableSeededReadsAndMutations()=runTest {
        FakeRepositories(coroutineScope=backgroundScope).use { r ->
            assertEquals(2,r.ai.listAiProviders().size)
            assertEquals(6,r.applications.getApplicationLanes().lanes.size)
            assertEquals(3.0,r.documents.countDocuments().resume,0.0)
            assertEquals(128.0,r.resumes.getResumeStatistics(StoryboardIds.resume).views,0.0)
            val insights=r.applications.insights()
            assertEquals(14,insights.total);assertEquals(6,insights.heardBack);assertEquals(6.0,insights.medianDaysToReply!!,0.0)
            assertEquals(3,insights.byStage[ApplicationStage.Interview]);assertEquals(1,insights.byStage[ApplicationStage.Offer])
            assertEquals(24,r.career.listCareerFacts().size);assertEquals(5,r.career.listCareerStories().size)
            assertEquals(2.0,r.account.listApiKeys().total,0.0)
            assertEquals("Claude Desktop",r.account.listConnectedApplications().connections.single().clientName)
            assertEquals(3,r.resumes.listFeedbackLinks(StoryboardIds.resume).size)
            assertEquals(2,r.checks.getResumeChecks(StoryboardIds.resume).findings.size)
            assertEquals("Sent to Lumen",r.resumes.listResumeVersions(StoryboardIds.resume).first().name)
            assertTrue(r.account.securityInfo() is AccountSecurityInfo.Available)
            val fact=r.career.listCareerFacts().first();r.career.forgetCareerFact(fact.id)
            assertFalse(r.career.listCareerFacts().any { it.id==fact.id })
            val story=r.career.listCareerStories().first()
            r.career.saveCareerStory(SaveCareerStoryRequest(id=story.id,title="Reviewed story",situation="Before",task="Task",action="Action"))
            assertEquals("Reviewed story",r.career.listCareerStories().first().data.title)
            val duplicate=r.documents.duplicate(DocumentType.Resume,StoryboardIds.resume,"Copy for review")
            assertEquals("Copy for review",r.resumes.getResume(duplicate).name)
        }
    }
    @Test fun previewExportsContainReadablePdfAndWordContainers() {
        val pdf=fakeExport("pdf","Alex Morgan","{}").bytes.decodeToString()
        val xref=pdf.substringAfterLast("startxref\n").substringBefore('\n').toInt()
        assertTrue(pdf.startsWith("%PDF-1.4"));assertTrue(pdf.substring(xref).startsWith("xref"));assertTrue(pdf.endsWith("%%EOF\n"))
        val doc=fakeExport("docx","Alex Morgan","{}")
        val entries=java.util.zip.ZipInputStream(doc.bytes.inputStream()).use { zip -> buildList { while(true) { val entry=zip.nextEntry ?: break;add(entry.name) } } }
        assertTrue("word/document.xml" in entries);assertTrue("[Content_Types].xml" in entries)
    }
    @Test fun insightsKeepClosedRepliesAndIgnoreLaneOnlyMoves()=runTest {
        FakeRepositories(coroutineScope=backgroundScope).use { r ->
            val base=r.applications.getApplication(StoryboardIds.fieldnote)
            fun entry(json: String)=ApiJson.decodeFromString(TimelineEntry.serializer(),json)
            val application=base.copy(status=ApplicationStage.Closed,appliedAt="2026-10-28T10:00:00Z",activity=listOf(
                entry("""{"id":"a","at":"2026-10-28T10:00:00Z","type":"stage","stage":"applied"}"""),
                entry("""{"id":"lane","at":"2026-10-29T10:00:00Z","type":"stage","stage":"screening","canonicalTransition":false}"""),
                entry("""{"id":"reply","at":"2026-11-03T10:00:00Z","type":"stage","stage":"closed","closedReason":"not-selected"}"""),
            ))
            val result=applicationInsights(listOf(application),r.time)
            assertEquals(1,result.heardBack);assertEquals(6.0,result.medianDaysToReply!!,0.0)
            assertEquals(1,result.byStage[ApplicationStage.Applied]);assertEquals(0,result.byStage[ApplicationStage.Screening]);assertEquals(1,result.closed)
        }
    }
    @Test fun legacyDateOnlyRemindersAndQuietStageUseAccountTimezoneAndWriteOrder()=runTest {
        FakeRepositories(coroutineScope=backgroundScope).use { r ->
            val base=r.applications.getApplication(StoryboardIds.fieldnote)
            val time=TimeSource(java.time.Clock.fixed(java.time.Instant.parse("2026-11-07T18:00:00Z"),java.time.ZoneOffset.UTC)) { java.time.ZoneId.of("America/Los_Angeles") }
            assertEquals("2026-11-07T17:00:00Z",followUpInstant(base.copy(followUpAt="2026-11-07T00:00:00Z",followUpDateOnly=true),time).toString())
            assertEquals("2026-11-07T00:00:00Z",followUpInstant(base.copy(followUpAt="2026-11-07T00:00:00Z",followUpDateOnly=false),time).toString())
            val stage=ApiJson.decodeFromString(TimelineEntry.serializer(),"""{"id":"current","at":"2026-10-20T10:00:00Z","type":"stage","stage":"applied","writeSequence":2}""")
            val older=ApiJson.decodeFromString(TimelineEntry.serializer(),"""{"id":"older","at":"2026-11-06T10:00:00Z","type":"stage","stage":"applied","writeSequence":1}""")
            val quiet=base.copy(followUpAt=null,activity=listOf(stage,older))
            assertEquals(NextStepKind.NoReply,applicationNextStep(quiet,time).kind)
        }
    }
    @Test fun letterDraftClearsNullableLinksAndRetainsUneditedStyle()=runTest {
        FakeRepositories(coroutineScope=backgroundScope).use { r ->
            val draft=r.letters.openDraft(StoryboardIds.lumenLetter)
            val before=draft.state.value.document!!
            assertNotNull(before.sourceResumeId)
            draft.update(before.copy(sourceResumeId=null,sourceApplicationId=null));runCurrent();draft.flush();runCurrent()
            val saved=r.letters.getCoverLetter(StoryboardIds.lumenLetter)
            assertNull(saved.sourceResumeId);assertNull(saved.sourceApplicationId)
            assertEquals(before.style,saved.style);assertEquals(SaveStatus.Saved,draft.state.value.status)
            draft.close()
        }
    }
}
