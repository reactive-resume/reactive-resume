package me.rxresu.feature.documents

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import me.rxresu.core.designsystem.RrButton
import me.rxresu.core.designsystem.RrButtonSize
import me.rxresu.core.designsystem.RrChoiceRow
import me.rxresu.core.designsystem.RrListGroup
import me.rxresu.core.designsystem.RrSectionHeader
import me.rxresu.core.designsystem.RrTextField
import me.rxresu.core.network.generated.Application
import me.rxresu.core.network.generated.DocumentSummary
import me.rxresu.core.network.generated.DocumentType

private const val NEW_JOB = "new"

/**
 * "Copy a resume for a job": Start from (a resume), For which job (an application or Add a job), Name (suggested).
 * Pushed inside D2 and D3. The fields survive a failed copy so nothing typed is lost. [initialApplicationId] picks the
 * job up front (D3 opened from an application's "Copy a resume for this job").
 */
@Composable
internal fun CopyForJobForm(
    library: List<DocumentSummary>,
    applications: List<Application>,
    initialResumeId: String?,
    busy: Boolean,
    onSubmit: (resumeId: String, job: JobChoice, name: String) -> Unit,
    modifier: Modifier = Modifier,
    initialApplicationId: String? = null,
) {
    val resumes = library.filter { it.type == DocumentType.Resume && it.trashedAt == null }
    var resumeId by rememberSaveable { mutableStateOf(initialResumeId ?: resumes.firstOrNull()?.id) }
    var job by rememberSaveable { mutableStateOf(initialApplicationId ?: applications.firstOrNull()?.id ?: NEW_JOB) }
    var company by rememberSaveable { mutableStateOf("") }
    var role by rememberSaveable { mutableStateOf("") }
    var posting by rememberSaveable { mutableStateOf("") }
    var name by rememberSaveable { mutableStateOf<String?>(null) }

    val source = resumes.firstOrNull { it.id == resumeId }
    val app = applications.firstOrNull { it.id == job }
    val suggested = if (job == NEW_JOB) DocumentActionsViewModel.suggestedName(source, company, role) else DocumentActionsViewModel.suggestedName(source, app?.company, app?.role)
    val newJob = job == NEW_JOB
    val ready = source != null && (!newJob || (company.isNotBlank() && role.isNotBlank()))

    Column(modifier.padding(bottom = 16.dp)) {
        RrSectionHeader(stringResource(R.string.docs_start_from), topPadding = 0.dp)
        RrListGroup(Modifier.padding(horizontal = 16.dp)) {
            resumes.forEach { RrChoiceRow(it.name, it.id == resumeId, { resumeId = it.id }) }
        }
        RrSectionHeader(stringResource(R.string.docs_for_which_job))
        RrListGroup(Modifier.padding(horizontal = 16.dp)) {
            applications.forEach { RrChoiceRow(stringResource(R.string.docs_copy_for_company, it.company, it.role), it.id == job, { job = it.id }) }
            RrChoiceRow(stringResource(R.string.docs_add_a_job), newJob, { job = NEW_JOB })
        }
        Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (newJob) {
                RrTextField(company, { company = it }, Modifier.fillMaxWidth(), label = stringResource(R.string.docs_company))
                RrTextField(role, { role = it }, Modifier.fillMaxWidth(), label = stringResource(R.string.docs_role))
                RrTextField(posting, { posting = it }, Modifier.fillMaxWidth(), label = stringResource(R.string.docs_posting_optional), singleLine = false, minLines = 2)
            }
            RrTextField(
                name ?: suggested,
                { name = it },
                Modifier.fillMaxWidth(),
                label = stringResource(R.string.docs_copy_name),
                helper = stringResource(R.string.docs_copy_name_helper),
            )
            RrButton(
                stringResource(if (newJob) R.string.docs_save_create_open else R.string.docs_create_and_open),
                {
                    val target = if (newJob) JobChoice.New(company, role, posting) else JobChoice.Existing(job)
                    onSubmit(resumeId!!, target, name ?: suggested)
                },
                Modifier.fillMaxWidth(),
                size = RrButtonSize.Large,
                enabled = ready,
                loading = busy,
            )
        }
    }
}
