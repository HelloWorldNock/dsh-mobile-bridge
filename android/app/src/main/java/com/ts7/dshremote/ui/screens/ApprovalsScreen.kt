package com.ts7.dshremote.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowBack
import androidx.compose.material.icons.outlined.VerifiedUser
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.ts7.dshremote.data.AppState
import com.ts7.dshremote.data.BridgeRepository
import com.ts7.dshremote.data.ConnectionState
import com.ts7.dshremote.ui.ApprovalCard
import com.ts7.dshremote.ui.EmptyState
import com.ts7.dshremote.ui.QuestionCard
import com.ts7.dshremote.ui.SectionLabel
import com.ts7.dshremote.ui.StatusDot
import com.ts7.dshremote.ui.theme.Amber
import com.ts7.dshremote.ui.theme.Danger
import com.ts7.dshremote.ui.theme.Ink
import com.ts7.dshremote.ui.theme.TextMuted
import com.ts7.dshremote.ui.theme.TextPrimary
import kotlinx.coroutines.launch

@Composable
fun ApprovalsScreen(
    repository: BridgeRepository,
    state: AppState,
    onBack: () -> Unit
) {
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    val groups = state.pendingHosts

    Surface(color = Ink, modifier = Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 8.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                IconButton(onClick = onBack) {
                    Icon(Icons.Outlined.ArrowBack, contentDescription = "返回", tint = TextPrimary)
                }
                Column(Modifier.weight(1f)) {
                    Text("待处理", style = MaterialTheme.typography.titleLarge, color = TextPrimary)
                    Text(
                        if (groups.size > 1) "${state.totalPendingCount} 项 · 来自 ${groups.size} 台主机"
                        else "${state.totalPendingCount} 项 · 超时会自动回退到桌面",
                        style = MaterialTheme.typography.bodySmall,
                        color = TextMuted
                    )
                }
                Icon(Icons.Outlined.VerifiedUser, contentDescription = null, tint = Amber)
            }

            if (groups.isEmpty()) {
                EmptyState("没有待处理事项", "审批和提问会实时出现在这里")
            } else {
                LazyColumn(
                    Modifier.fillMaxSize(),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    groups.forEach { group ->
                        item(key = "host-${group.id}") {
                            Row(
                                Modifier
                                    .fillMaxWidth()
                                    .padding(top = 6.dp, bottom = 2.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                StatusDot(
                                    if (group.connection == ConnectionState.Connected) Amber else Danger,
                                    7
                                )
                                Spacer(Modifier.width(8.dp))
                                Text(
                                    group.label,
                                    style = MaterialTheme.typography.titleSmall,
                                    color = TextPrimary
                                )
                                Spacer(Modifier.width(8.dp))
                                Text(
                                    "${group.pendingCount} 项",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = TextMuted
                                )
                            }
                        }
                        if (group.pending.approvals.isNotEmpty()) {
                            item(key = "approvals-${group.id}") {
                                SectionLabel("权限审批", "${group.pending.approvals.size}")
                            }
                            items(group.pending.approvals, key = { "a-${group.id}-${it.id}" }) { approval ->
                                Column {
                                    if (!approval.sessionTitle.isNullOrBlank()) {
                                        Text(
                                            approval.sessionTitle,
                                            style = MaterialTheme.typography.labelSmall,
                                            color = TextMuted,
                                            modifier = Modifier.padding(bottom = 4.dp)
                                        )
                                    }
                                    ApprovalCard(approval, onResolve = { action ->
                                        scope.launch {
                                            busy = true
                                            repository.approve(approval.id, action, group.id)
                                            busy = false
                                        }
                                    }, busy = busy)
                                }
                            }
                        }
                        if (group.pending.questions.isNotEmpty()) {
                            item(key = "questions-${group.id}") {
                                SectionLabel("提问与计划审阅", "${group.pending.questions.size}")
                            }
                            items(group.pending.questions, key = { "q-${group.id}-${it.id}" }) { question ->
                                Column {
                                    if (!question.sessionTitle.isNullOrBlank()) {
                                        Text(
                                            question.sessionTitle,
                                            style = MaterialTheme.typography.labelSmall,
                                            color = TextMuted,
                                            modifier = Modifier.padding(bottom = 4.dp)
                                        )
                                    }
                                    QuestionCard(question, onSubmit = { answers ->
                                        scope.launch {
                                            busy = true
                                            repository.answer(question.id, answers, group.id)
                                            busy = false
                                        }
                                    }, busy = busy)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
