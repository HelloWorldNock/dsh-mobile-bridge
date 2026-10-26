package com.ts7.dshremote.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.ts7.dshremote.data.AppState
import com.ts7.dshremote.data.BridgeRepository
import com.ts7.dshremote.ui.ConnectionPill
import com.ts7.dshremote.ui.EmptyState
import com.ts7.dshremote.ui.PendingBanner
import com.ts7.dshremote.ui.SectionLabel
import com.ts7.dshremote.ui.SessionCard
import com.ts7.dshremote.ui.theme.Amber
import com.ts7.dshremote.ui.theme.Ink
import com.ts7.dshremote.ui.theme.MonoText
import com.ts7.dshremote.ui.theme.Outline
import com.ts7.dshremote.ui.theme.SurfaceRaised
import com.ts7.dshremote.ui.theme.TextMuted
import com.ts7.dshremote.ui.theme.TextPrimary

@Composable
fun SessionsScreen(
    repository: BridgeRepository,
    state: AppState,
    onOpen: (String) -> Unit,
    onNew: () -> Unit,
    onApprovals: () -> Unit,
    onSettings: () -> Unit
) {
    var query by remember { mutableStateOf("") }
    LaunchedEffect(Unit) {
        repository.refreshSessions()
        repository.refreshPending()
    }
    val filtered = remember(state.sessions, query) {
        if (query.isBlank()) state.sessions
        else state.sessions.filter {
            (it.title ?: "").contains(query, ignoreCase = true) || (it.cwd ?: "").contains(query, ignoreCase = true)
        }
    }
    val running = filtered.filter { it.running }
    val recent = filtered.filterNot { it.running }

    Box(Modifier.fillMaxSize().background(Ink)) {
        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(
                start = 20.dp, end = 20.dp, top = 22.dp, bottom = 110.dp
            )
        ) {
            item {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("TS7", style = MaterialTheme.typography.labelSmall, color = Amber)
                    Spacer(Modifier.width(8.dp))
                    Text("/ DSH REMOTE", style = MaterialTheme.typography.labelSmall, color = TextMuted)
                    Spacer(Modifier.weight(1f))
                    ConnectionPill(state.connection)
                    Spacer(Modifier.width(8.dp))
                    IconButton(onClick = onSettings) {
                        Icon(Icons.Outlined.Settings, contentDescription = "设置", tint = TextMuted)
                    }
                }
                Spacer(Modifier.height(18.dp))
                Row(verticalAlignment = Alignment.Bottom) {
                    Column(Modifier.weight(1f)) {
                        Text("任务", style = MaterialTheme.typography.displaySmall, color = TextPrimary)
                        Spacer(Modifier.height(4.dp))
                        Text(
                            "${state.sessions.size} 个会话 · ${state.info?.bridge?.hostName ?: "未命名主机"}",
                            style = MaterialTheme.typography.bodySmall,
                            color = TextMuted
                        )
                    }
                    Button(
                        onClick = onNew,
                        shape = RoundedCornerShape(999.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = Amber, contentColor = Color(0xFFFFFFFF)),
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 18.dp, vertical = 12.dp)
                    ) {
                        Icon(Icons.Outlined.Add, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("ADD", style = MaterialTheme.typography.labelLarge)
                    }
                }
                Spacer(Modifier.height(14.dp))
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    placeholder = { Text("搜索标题或目录") },
                    leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null, tint = TextMuted) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                    keyboardActions = KeyboardActions(onSearch = { }),
                    modifier = Modifier.fillMaxWidth(),
                    textStyle = MonoText,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = Amber,
                        unfocusedBorderColor = Outline,
                        focusedContainerColor = SurfaceRaised,
                        unfocusedContainerColor = SurfaceRaised,
                        focusedTextColor = TextPrimary,
                        unfocusedTextColor = TextPrimary,
                        cursorColor = Amber
                    )
                )
                PendingBanner(state.pendingCount, onApprovals)
            }

            if (running.isNotEmpty()) {
                item { SectionLabel("运行中", "${running.size}") }
                items(running, key = { "run-${it.id}" }) { session ->
                    SessionCard(session) { onOpen(session.id) }
                }
            }

            item { SectionLabel("最近任务", "${recent.size}") }
            if (recent.isEmpty() && running.isEmpty()) {
                item { EmptyState("还没有任务", "点按 ADD 在电脑上新建一个 DSH 任务") }
            } else if (recent.isEmpty()) {
                item { EmptyState("运行中的任务都在上面", "完成或停止后会回到这里") }
            } else {
                items(recent, key = { it.id }) { session ->
                    SessionCard(session) { onOpen(session.id) }
                }
            }
        }
    }
}
