package me.rxresu.core.data

import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.json.*
import me.rxresu.core.auth.AuthSession
import me.rxresu.core.auth.SessionState
import me.rxresu.core.database.*
import me.rxresu.core.network.generated.*
import me.rxresu.core.page.PageRenderer

class FakeAuthSession(initialScope: String = "storyboard-alex") : AuthSession {
    override val origin=MutableStateFlow("https://example.invalid")
    override val state=MutableStateFlow<SessionState>(SessionState.SignedIn(origin.value,initialScope))
    override suspend fun accessToken(): String? = if(state.value is SessionState.SignedIn) "preview-token" else null
    override suspend fun refresh(rejected: String)=accessToken()
    override suspend fun signOut() { state.value=SessionState.SignedOut }
}

/** Main-source factory for Compose previews/Roborazzi. Pass a test scope to control autosave with virtual time. */
@Suppress("FunctionName")
fun FakeRepositories(
    controls: FakeControls = FakeControls(),
    time: TimeSource = TimeSource.storyboard(),
    authSession: AuthSession = FakeAuthSession(),
    pageRenderer: PageRenderer? = null,
    coroutineScope: CoroutineScope? = null,
): RrRepositories {
    val scope=coroutineScope ?: CoroutineScope(SupervisorJob()+Dispatchers.Default)
    val transport=FakeTransport(controls,time)
    val store=RepositoryStore(transport,authSession,MemoryListCache(),time)
    val dao=MemoryDraftDao()
    val remote=JsonDraftRemote(store)
    val queue=DraftQueue(dao,remote,{authSession.state.value.scope()}, {controls.online.value})
    val registry=DraftRegistry { owner,kind,id ->
        val row=queue.open(owner,kind,id)
        if(kind=="resume") PersistentDocumentDraft(owner,kind,id,queue,dao,remote,authSession,Resume.serializer(),scope,row)
        else PersistentDocumentDraft(owner,kind,id,queue,dao,remote,authSession,CoverLetter.serializer(),scope,row)
    }
    val open: suspend(String,String)->DocumentDraft<*> = { kind,id ->
        registry.open(requireNotNull(authSession.state.value.scope()) { "Sign in before editing." },kind,id)
    }
    val drafts=object:DraftsRepository {
        override suspend fun sync()=authSession.state.value.scope()?.let { queue.sync(it) } ?: true
        @OptIn(ExperimentalCoroutinesApi::class)
        override fun pending()=authSession.state.map { it.scope() }.distinctUntilChanged().flatMapLatest { owner -> if(owner==null) flowOf(emptyList()) else queue.pending(owner).map { it.map { PendingDraft(it.documentId,it.kind,it.name,it.saveStatus()) } } }
    }
    return createRepositories(store,authSession,pageRenderer ?: StoryboardPageRenderer { transport.state },FakePreferencesRepository(),open,drafts,
        securityInfo={ AccountSecurityInfo.Available(true,8,listOf("This iPhone","MacBook"),listOf("GitHub"),3) }) { if(coroutineScope==null) scope.cancel() }
}

internal class MemoryDraftDao: DraftDao() {
    private val records=MutableStateFlow<Map<Triple<String,String,String>,DraftRecord>>(emptyMap())
    override fun observe(scope: String,kind: String,id: String)=records.map { it[Triple(scope,kind,id)] }.distinctUntilChanged()
    override suspend fun get(scope: String,kind: String,id: String)=records.value[Triple(scope,kind,id)]
    override suspend fun pending(scope: String)=records.value.values.filter { it.accountScope==scope && it.dirty }
    override fun observePending(scope: String)=records.map { it.values.filter { row -> row.accountScope==scope && row.dirty } }.distinctUntilChanged()
    override suspend fun put(record: DraftRecord) { records.update { it+(Triple(record.accountScope,record.kind,record.documentId) to record) } }
    override suspend fun deleteAccount(scope: String) { records.update { values -> values.filterValues { it.accountScope!=scope } } }
}
