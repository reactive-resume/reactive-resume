package me.rxresu.core.data

import kotlinx.coroutines.flow.*
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.*
import me.rxresu.core.network.*
import me.rxresu.core.network.generated.*

internal class RealSearchRepository(private val store: RepositoryStore):SearchRepository {
    private val recent=MutableStateFlow<Pair<String?,List<String>>>(null to emptyList())
    override val recentSearches=combine(store.auth.state,recent) { session,stored -> if(session.scope()==stored.first) stored.second else emptyList() }.distinctUntilChanged()
    override suspend fun remember(query: String) {
        val text=query.trim();if(text.isEmpty()) return
        val owner=store.auth.state.value.scope() ?: return
        val previous=store.cache.get(owner,"recent-searches")?.let { ApiJson.decodeFromString(ListSerializer(String.serializer()),it) }.orEmpty()
        val next=(listOf(text)+previous.filter { it!=text }).take(10)
        store.cache.put(owner,"recent-searches",ApiJson.encodeToString(ListSerializer(String.serializer()),next));recent.value=owner to next
    }
    override fun search(query: String,scope: SearchScope): Flow<Resource<List<SearchHit>>> = flow {
        emit(Resource(loading=true))
        val owner=store.auth.state.value.scope()
        recent.value=owner to owner?.let { store.cache.get(it,"recent-searches")?.let { json -> ApiJson.decodeFromString(ListSerializer(String.serializer()),json) } }.orEmpty()
        if(query.isBlank()) { emit(Resource(shortcuts(scope)));return@flow }
        val offlineGeneration=store.offlineGeneration.get()
        val hits=mutableListOf<SearchHit>();var failed:Throwable?=null
        suspend fun attempt(block: suspend()->Unit) { try { block() } catch(e: kotlinx.coroutines.CancellationException) { throw e } catch(e: Exception) { failed=e } }
        if(scope in setOf(SearchScope.All,SearchScope.Documents)) attempt {
            DocumentsApi(store).listDocuments(q=query).forEach { hits+=SearchHit(it.id,it.name,it.recipient.orEmpty(),it.type.wireValue,documentId=it.id) }
        }
        if(scope in setOf(SearchScope.All,SearchScope.Applications)) attempt {
            ApplicationsApi(store).listApplications().filter { it.company.contains(query,true)||it.role.contains(query,true) }.forEach { hits+=SearchHit(it.id,it.company,it.role,"application",applicationId=it.id) }
        }
        if(scope in setOf(SearchScope.All,SearchScope.Career)) {
            attempt { CareerApi(store).listCareerFacts(query=query).forEach { hits+=SearchHit(it.id,it.text,it.category,"fact",applicationId=it.applicationId) } }
            attempt { CareerApi(store).listCareerStories().filter { ApiJson.encodeToJsonElement(it).toString().contains(query,true) }.forEach { hits+=SearchHit(it.id,it.data.title,it.data.result.orEmpty(),"story",applicationId=it.applicationId) } }
            attempt { AgentApi(store).listAgentThreads().filter { it.title?.contains(query,true)==true || it.firstMessage?.contains(query,true)==true }.forEach { hits+=SearchHit(it.id,it.title ?: it.firstMessage.orEmpty(),"Conversation","thread",it.sourceResumeId,it.applicationId) } }
            attempt {
                CareerApi(store).listCareerSavedItems().forEach { item ->
                    val message=item.data as? MessageDraft ?: return@forEach
                    if(listOf(item.title,message.title,message.message,message.reply).any { it.contains(query,true) }) {
                        hits+=SearchHit(item.id,item.title,message.reply,"message",applicationId=item.applicationId)
                    }
                }
            }
        }
        hits+=shortcuts(scope).filter { it.title.contains(query,true) }
        if(store.auth.state.value.scope()!=owner) throw AccountChangedException()
        emit(Resource(hits,offline=failed is java.io.IOException || store.offlineGeneration.get()!=offlineGeneration,error=failed))
    }
    private fun shortcuts(scope: SearchScope): List<SearchHit> = if(scope !in setOf(SearchScope.All,SearchScope.Settings)) emptyList() else listOf(
        SearchHit("settings","Settings","","destination"),SearchHit("knowledge","Knowledge","","destination"),SearchHit("offers","Offers","","destination"),SearchHit("ats-checker","ATS checker","","destination"),SearchHit("trash","Trash","","destination"),
        SearchHit("new-letter","New cover letter","","command"),SearchHit("save-job","Save job","","command"),SearchHit("theme","Change theme","","command"),SearchHit("language","Change language","","command"),
    )
}
