package me.rxresu.core.data

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import androidx.work.*
import java.security.MessageDigest
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.*
import me.rxresu.core.auth.AuthSession
import me.rxresu.core.auth.SessionState
import me.rxresu.core.database.*
import me.rxresu.core.network.*
import me.rxresu.core.network.generated.*
import me.rxresu.core.network.generated.Application
import me.rxresu.core.page.PageRenderer

/** App must install workerFactory through Configuration.Provider before WorkManager initializes. */
fun realRepositories(
    context: Context,authSession: AuthSession,pageRenderer: PageRenderer,
    onRejectedRetry: suspend (String)->Unit,
    time: TimeSource = TimeSource(),http: okhttp3.OkHttpClient = okhttp3.OkHttpClient(),
): RrRepositories {
    val app=context.applicationContext
    val database=RrDatabase.open(app)
    val scope=CoroutineScope(SupervisorJob()+Dispatchers.Default)
    val connectivity=AndroidConnectivity(app)
    val transport=ApiClient(authSession,authSession,http,time.timezone,{authSession.state.value.scope()},onRejectedRetry)
    val store=RepositoryStore(transport,authSession,RoomListCache(database.cache(),time),time)
    val remote=JsonDraftRemote(store)
    val queue=DraftQueue(database.drafts(),remote,{authSession.state.value.scope()}, {connectivity.online.value}) { owner -> scheduleDraftSync(app,owner) }
    val workerFactory=DraftSyncWorkerFactory(queue,authSession)
    val registry=DraftRegistry { owner,kind,id ->
        val row=queue.open(owner,kind,id)
        if(kind=="resume") PersistentDocumentDraft(owner,kind,id,queue,database.drafts(),remote,authSession,Resume.serializer(),scope,row,updates={ ResumesApi(store).subscribeResumeUpdates(id,RequestOptions(accountScope=owner)) })
        else PersistentDocumentDraft(owner,kind,id,queue,database.drafts(),remote,authSession,CoverLetter.serializer(),scope,row)
    }
    val open: suspend(String,String)->DocumentDraft<*> = { kind,id ->
        registry.open(requireNotNull(authSession.state.value.scope()) { "Sign in before editing." },kind,id)
    }
    scope.launch {
        combine(authSession.state,connectivity.online) { state,online -> state to online }.collect { (state,online) ->
            if(state is SessionState.SignedIn && online) queue.sync(state.accountScope)
        }
    }
    return createRepositories(store,authSession,pageRenderer,DataStorePreferencesRepository(app),open,
        object:DraftsRepository {
            override suspend fun sync()=authSession.state.value.scope()?.let { queue.sync(it) } ?: true
            @OptIn(ExperimentalCoroutinesApi::class)
            override fun pending()=authSession.state.map { it.scope() }.distinctUntilChanged().flatMapLatest { owner ->
                if(owner==null) flowOf(emptyList()) else queue.pending(owner).map { rows -> rows.map { PendingDraft(it.documentId,it.kind,it.name,it.saveStatus()) } }
            }
        },workerFactory,forgetAccount={ owner -> database.drafts().deleteAccount(owner);database.cache().deleteAccount(owner) }) { connectivity.close();scope.cancel();database.close() }
}

internal fun createRepositories(
    store: RepositoryStore,auth: AuthSession,pages: PageRenderer,preferences: PreferencesRepository,
    open: suspend(String,String)->DocumentDraft<*>,drafts: DraftsRepository,
    workerFactory: WorkerFactory? = null,securityInfo: (() -> AccountSecurityInfo)? = null,
    forgetAccount: suspend (scope: String) -> Unit = {},dispose: ()->Unit = {},
): RrRepositories {
    val docsApi=DocumentsApi(store);val resumesApi=ResumesApi(store);val lettersApi=CoverLettersApi(store)
    val appsApi=ApplicationsApi(store);val careerApi=CareerApi(store)
    val account=object:AccountRepository,AuthenticationApiOperations by AuthenticationApi(store),ApplicationProfileApiOperations by ApplicationProfileApi(store),FilesApiOperations by FilesApi(store) {
        override val session=auth.state
        override fun observeProfile()=store.observe("account-profile",AccountProfile.serializer()) { getProfile() }
        /**
         * Signs out, then removes the departing account's data on this device (drafts, cached lists), as the Expo app
         * does. Credentials always go; a cleanup step that fails is reported afterwards as [SignOutCleanupException].
         */
        override suspend fun signOut() {
            val departing=auth.state.value.scope()
            auth.signOut()
            if(departing!=null) runCatching { forgetAccount(departing) }.onFailure { throw SignOutCleanupException(it) }
        }
        override fun securityInfo()=securityInfo?.invoke() ?: AccountSecurityInfo.BrowserRequired(auth.origin.value.trimEnd('/')+"/dashboard/settings/account")
    }
    val docs=object:DocumentsRepository,DocumentsApiOperations by docsApi {
        override fun observe(query: DocumentQuery)=store.observe("documents:"+ApiJson.encodeToString(DocumentQuery.serializer(),query),ListSerializer(DocumentSummary.serializer())) {
            docsApi.listDocuments(trashed=query.trashed,type=ListDocumentsType.entries.firstOrNull { it.wireValue==query.type },q=query.text,tags=query.tags,public=query.publicOnly,sort=ListDocumentsSort.entries.firstOrNull { it.wireValue==query.sort })
        }
        override suspend fun refresh()=store.refresh()
        override suspend fun duplicate(type: DocumentType,id: String,name: String?): String {
            val raw=if(type==DocumentType.Resume) store.execute(ApiRequest("duplicateResume","POST","/resumes/{id}/duplicate",mapOf("id" to id),body=buildJsonObject { if(name!=null) put("name",name) }))
                else store.execute(ApiRequest("duplicateCoverLetter","POST","/cover-letters/{id}/duplicate",mapOf("id" to id),body=buildJsonObject { if(name!=null) put("name",name) }))
            return if(raw is JsonPrimitive) raw.content else raw.jsonObject.text("id")!!
        }
    }
    val resumes=object:ResumeRepository,ResumesApiOperations by resumesApi,ResumeSharingApiOperations by ResumeSharingApi(store),ResumeStatisticsApiOperations by ResumeStatisticsApi(store),CustomDomainApiOperations by CustomDomainApi(store),FeedbackLinksApiOperations by FeedbackLinksApi(store) {
        @Suppress("UNCHECKED_CAST") override suspend fun openDraft(id: String)=open("resume",id) as DocumentDraft<Resume>
    }
    val letters=object:LettersRepository,CoverLettersApiOperations by lettersApi {
        @Suppress("UNCHECKED_CAST") override suspend fun openDraft(id: String)=open("letter",id) as DocumentDraft<CoverLetter>
    }
    val applications=object:ApplicationsRepository,ApplicationsApiOperations by appsApi {
        override fun observe(query: ApplicationQuery)=store.observe("applications:"+ApiJson.encodeToString(ApplicationQuery.serializer(),query),ListSerializer(Application.serializer())) {
            filterApplications(appsApi.listApplications(status=query.stage,laneId=query.laneId,tags=query.tags),query)
        }
        override suspend fun refresh()=store.refresh()
        override suspend fun calendar()=calendarItems(appsApi.listApplications(),careerApi.listCareerSavedItems(),store.time)
        override suspend fun insights(query: ApplicationQuery)=applicationInsights(filterApplications(appsApi.listApplications(),query.copy(showClosed=true)),store.time)
    }
    val career=object:CareerRepository,CareerApiOperations by careerApi {}
    return RrRepositories(account,docs,resumes,letters,applications,
        object:ChecksRepository,ChecksApiOperations by ChecksApi(store) { override suspend fun getResumeChecks(id: String)=resumesApi.getResumeChecks(id) },
        object:AiRepository,AIApiOperations by AIApi(store),AIProvidersApiOperations by AIProvidersApi(store),IntegrationsApiOperations by IntegrationsApi(store) {},
        object:AssistantRepository,AgentApiOperations by AgentApi(store) {},
        object:WorkspaceRepository,CareerApiOperations by careerApi,ApplicationsApiOperations by appsApi {},career,
        RealSearchRepository(store),
        object:PublicRepository,ResumeSharingApiOperations by ResumeSharingApi(store),FeedbackLinksApiOperations by FeedbackLinksApi(store) {},
        object:PlatformRepository,SystemApiOperations by SystemApi(store),FeatureFlagsApiOperations by FeatureFlagsApi(store),PlatformStatisticsApiOperations by PlatformStatisticsApi(store) {},
        preferences,RealTodayRepository(store),drafts,pages,auth,store.time,workerFactory,dispose)
}

private class AndroidConnectivity(context: Context):AutoCloseable {
    private val manager=context.getSystemService(ConnectivityManager::class.java)
    val online=MutableStateFlow(connected())
    private fun connected()=manager.getNetworkCapabilities(manager.activeNetwork)?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)==true
    private val callback=object:ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) { online.value=connected() }
        override fun onLost(network: Network) { online.value=connected() }
        override fun onCapabilitiesChanged(network: Network,capabilities: NetworkCapabilities) { online.value=connected() }
    }
    init { manager.registerDefaultNetworkCallback(callback) }
    override fun close()=manager.unregisterNetworkCallback(callback)
}
class DraftSyncWorkerFactory(private val queue: DraftQueue,private val auth: AuthSession):WorkerFactory() {
    override fun createWorker(context: Context,workerClassName: String,workerParameters: WorkerParameters): ListenableWorker? =
        if(workerClassName==DraftSyncWorker::class.java.name) DraftSyncWorker(context,workerParameters,queue,auth) else null
}
class DraftSyncWorker(context: Context,parameters: WorkerParameters,private val queue: DraftQueue,private val auth: AuthSession):CoroutineWorker(context,parameters) {
    override suspend fun doWork(): Result {
        val owner=inputData.getString("accountScope") ?: return Result.failure()
        val state=auth.state.first { it !is SessionState.Loading }
        if(state !is SessionState.SignedIn || state.accountScope!=owner) return Result.success()
        return if(queue.sync(owner)) Result.success() else Result.retry()
    }
}
private fun scheduleDraftSync(context: Context,owner: String) {
    val key=MessageDigest.getInstance("SHA-256").digest(owner.toByteArray()).joinToString("") { "%02x".format(it) }
    WorkManager.getInstance(context).enqueueUniqueWork("draft-sync:$key",ExistingWorkPolicy.APPEND_OR_REPLACE,
        OneTimeWorkRequestBuilder<DraftSyncWorker>().setInputData(workDataOf("accountScope" to owner))
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build())
}

/** Signed out, but some of the account's data on this device could not be removed. */
class SignOutCleanupException(cause: Throwable) : Exception("Signed out, but some local data could not be removed.", cause)
