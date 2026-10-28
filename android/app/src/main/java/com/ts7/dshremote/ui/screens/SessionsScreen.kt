package com.ts7.dshremote.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.FolderOpen
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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.ts7.dshremote.data.AppState
import com.ts7.dshremote.data.BridgeRepository
import com.ts7.dshremote.data.ConnectionState
import com.ts7.dshremote.data.HostSummary
import com.ts7.dshremote.data.SessionSummary
import com.ts7.dshremote.data.Workspace
import com.ts7.dshremote.ui.ConnectionPill
import com.ts7.dshremote.ui.EmptyState
import com.ts7.dshremote.ui.PendingBanner
import com.ts7.dshremote.ui.SectionLabel
import com.ts7.dshremote.ui.SessionCard
import com.ts7.dshremote.ui.StatusDot
import com.ts7.dshremote.ui.theme.Amber
import com.ts7.dshremote.ui.theme.Danger
import com.ts7.dshremote.ui.theme.Ink
import com.ts7.dshremote.ui.theme.MonoText
import com.ts7.dshremote.ui.theme.Outline
import com.ts7.dshremote.ui.theme.SurfaceRaised
import com.ts7.dshremote.ui.theme.TextMuted
import com.ts7.dshremote.ui.theme.TextPrimary

private data class WorkspaceGroup(
    val id: String,
    val title: String,
    val path: String,
    val sessions: List<SessionSummary>
)

@Composable
fun SessionsScreen(
    repository: BridgeRepository,
    state: AppState,
    onOpen: (String) -> Unit,
    onNew: () -> Unit,
    onApprovals: () -> Unit,
    onSettings: () -> Unit,
    onConnect: () -> Unit,
    onSelectHost: (String) -> Unit
) {
    var query by remember { mutableStateOf("") }
    var collapsedKey by rememberSaveable(state.activeHost?.id ?: "none") { mutableStateOf("") }
    val collapsed = remember(collapsedKey) {
        collapsedKey.split('\u0001').filter { it.isNotEmpty() }.toSet()
    }
    LaunchedEffect(Unit) {
        repository.refreshSessions()
        repository.refreshPending()
    }

    val allGroups = remember(state.sessions, state.workspaces) {
        buildWorkspaceGroups(state.sessions, state.workspaces)
    }
    val groups = remember(allGroups, query) {
        val needle = query.trim()
        if (needle.isEmpty()) allGroups
        else allGroups.mapNotNull { group ->
            val workspaceMatches = group.title.contains(needle, ignoreCase = true) ||
                group.path.contains(needle, ignoreCase = true)
            val members = if (workspaceMatches) group.sessions else group.sessions.filter {
                (it.title ?: "").contains(needle, ignoreCase = true) ||
                    (it.cwd ?: "").contains(needle, ignoreCase = true)
            }
            if (members.isEmpty()) null else group.copy(sessions = members)
        }
    }

    fun toggle(id: String) {
        val next = if (id in collapsed) collapsed - id else collapsed + id
        collapsedKey = next.joinToString("\u0001")
    }

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
                Spacer(Modifier.height(14.dp))
                HostSwitcher(
                    hosts = state.hosts,
                    onSelect = onSelectHost,
                    onAdd = onConnect
                )
                Spacer(Modifier.height(16.dp))
                Row(verticalAlignment = Alignment.Bottom) {
                    Column(Modifier.weight(1f)) {
                        Text("任务", style = MaterialTheme.typography.displaySmall, color = TextPrimary)
                        Spacer(Modifier.height(4.dp))
                        Text(
                            if (state.hosts.isEmpty()) "尚未连接主机"
                            else buildString {
                                append("${state.sessions.size} 个会话 · ${state.hostLabel}")
                                if (state.connected) append(" · ${state.routeLabel}")
                            },
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
                    placeholder = { Text("搜索工作区、标题或目录") },
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
                if (state.totalPendingCount > 0) {
                    PendingBanner(state.totalPendingCount, onApprovals)
                }
                if (state.hosts.isEmpty()) {
                    Spacer(Modifier.height(16.dp))
                    ConnectCard(onClick = onConnect)
                } else if (state.connection == ConnectionState.Error) {
                    Spacer(Modifier.height(12.dp))
                    Surface(color = Danger.copy(alpha = 0.12f), shape = RoundedCornerShape(14.dp)) {
                        Text(
                            "当前主机连接失败，点按上方主机可重试，或前往设置检查地址。",
                            style = MaterialTheme.typography.bodySmall,
                            color = Danger,
                            modifier = Modifier.padding(12.dp)
                        )
                    }
                }
            }

            if (state.hosts.isEmpty()) {
                item { EmptyState("还没有主机", "点按上方按钮，在同一 Wi-Fi 下配对第一台电脑") }
            } else if (state.sessions.isEmpty()) {
                item { EmptyState("还没有任务", "点按 ADD 在当前主机新建一个 DSH 任务") }
            } else if (groups.isEmpty()) {
                item { EmptyState("没有匹配的任务", "试试其他关键词，或清空搜索") }
            } else {
                item { SectionLabel("工作区", "${groups.size}") }
                groups.forEach { group ->
                    val expanded = query.isNotBlank() || group.id !in collapsed
                    item(key = "workspace-${group.id}") {
                        WorkspaceHeader(group, expanded) { toggle(group.id) }
                    }
                    if (expanded) {
                        items(group.sessions, key = { "session-${it.id}" }) { session ->
                            Box(Modifier.padding(start = 16.dp)) {
                                SessionCard(session, showFolderIcon = false, showCwd = false) { onOpen(session.id) }
                            }
                        }
                    }
                    item(key = "gap-${group.id}") { Spacer(Modifier.height(6.dp)) }
                }
            }
        }
    }
}

private fun buildWorkspaceGroups(
    sessions: List<SessionSummary>,
    workspaces: List<Workspace>
): List<WorkspaceGroup> {
    val byId = sessions.associateBy { it.id }
    val claimed = mutableSetOf<String>()
    val groups = workspaces.mapNotNull { workspace ->
        val idMembers = workspace.sessionIds.mapNotNull { sessionId ->
            byId[sessionId]
                ?: byId["session-$sessionId"]
                ?: byId[sessionId.removePrefix("session-")]
        }
        // Older bridges may have no sessionIds, or the workspace may have been
        // recreated with new ids while the sessions still live under its path.
        val pathMembers = sessions.filter { samePath(it.cwd, workspace.path) && it.id !in claimed }
        val members = (idMembers + pathMembers).filterNot { it.id in claimed }.distinctBy { it.id }
        claimed += members.map { it.id }
        if (members.isEmpty()) null
        else WorkspaceGroup(
            id = workspace.id,
            title = workspace.title?.takeIf { it.isNotBlank() }
                ?: workspace.path.substringAfterLast('\\').substringAfterLast('/').ifBlank { "未命名工作区" },
            path = workspace.path,
            sessions = sortSessions(members)
        )
    }
    val remaining = sessions.filterNot { it.id in claimed }
    val cwdGroups = remaining
        .filter { !it.cwd.isNullOrBlank() }
        .groupBy { it.cwd!! }
        .entries
        .sortedByDescending { entry -> entry.value.maxOfOrNull { it.updatedAt ?: 0L } ?: 0L }
        .map { (path, members) ->
            WorkspaceGroup(
                id = "cwd:$path",
                title = path.substringAfterLast('\\').substringAfterLast('/').ifBlank { path },
                path = path,
                sessions = sortSessions(members)
            )
        }
    val orphans = remaining.filter { it.cwd.isNullOrBlank() }
    if (orphans.isEmpty()) return groups + cwdGroups
    return groups + cwdGroups + WorkspaceGroup(
        id = "__unfiled__",
        title = "未归类",
        path = "",
        sessions = sortSessions(orphans)
    )
}

private fun sortSessions(items: List<SessionSummary>): List<SessionSummary> =
    items.sortedWith(
        compareByDescending<SessionSummary> { it.running }.thenByDescending { it.updatedAt ?: 0L }
    )

private fun samePath(left: String?, right: String?): Boolean {
    if (left.isNullOrBlank() || right.isNullOrBlank()) return false
    return left.trimEnd('\\', '/').equals(right.trimEnd('\\', '/'), ignoreCase = true)
}

@Composable
private fun WorkspaceHeader(
    group: WorkspaceGroup,
    expanded: Boolean,
    onToggle: () -> Unit
) {
    val running = group.sessions.count { it.running }
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .clickable(onClick = onToggle)
            .padding(horizontal = 6.dp, vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            if (expanded) Icons.Outlined.FolderOpen else Icons.Outlined.Folder,
            contentDescription = null,
            tint = if (expanded) Amber else TextMuted,
            modifier = Modifier.size(20.dp)
        )
        Spacer(Modifier.width(8.dp))
        Text(
            group.title,
            style = MaterialTheme.typography.titleSmall,
            color = TextPrimary,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f)
        )
        if (running > 0) {
            Text(
                "$running 运行中",
                style = MaterialTheme.typography.labelSmall,
                color = Amber
            )
            Spacer(Modifier.width(8.dp))
        }
        Text(
            "${group.sessions.size}",
            style = MaterialTheme.typography.labelMedium,
            color = TextMuted
        )
        Spacer(Modifier.width(4.dp))
        Icon(
            if (expanded) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore,
            contentDescription = if (expanded) "收起" else "展开",
            tint = TextMuted,
            modifier = Modifier.size(20.dp)
        )
    }
}

@Composable
private fun HostSwitcher(
    hosts: List<HostSummary>,
    onSelect: (String) -> Unit,
    onAdd: () -> Unit
) {
    Row(
        Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        hosts.forEach { host ->
            HostChip(host, onClick = { onSelect(host.id) })
        }
        Row(
            Modifier
                .border(1.dp, Outline, RoundedCornerShape(999.dp))
                .clickable(onClick = onAdd)
                .padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(Icons.Outlined.Add, contentDescription = "添加主机", tint = Amber, modifier = Modifier.size(16.dp))
            Spacer(Modifier.width(4.dp))
            Text("主机", style = MaterialTheme.typography.labelMedium, color = Amber)
        }
    }
}

@Composable
private fun HostChip(host: HostSummary, onClick: () -> Unit) {
    val active = host.active
    Row(
        Modifier
            .background(if (active) Amber.copy(alpha = 0.14f) else SurfaceRaised, RoundedCornerShape(999.dp))
            .border(1.dp, if (active) Amber else Outline, RoundedCornerShape(999.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        StatusDot(
            when (host.connection) {
                ConnectionState.Connected -> Amber
                ConnectionState.Connecting -> Amber
                ConnectionState.Error -> Danger
                ConnectionState.Disconnected -> TextMuted
            },
            7
        )
        Spacer(Modifier.width(6.dp))
        Text(
            host.label,
            style = MaterialTheme.typography.labelMedium,
            color = if (active) TextPrimary else TextMuted
        )
        if (host.pendingCount > 0) {
            Spacer(Modifier.width(6.dp))
            Text(
                "${host.pendingCount}",
                style = MaterialTheme.typography.labelSmall,
                color = Amber
            )
        }
    }
}

@Composable
private fun ConnectCard(onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .background(SurfaceRaised, RoundedCornerShape(18.dp))
            .border(1.dp, Amber.copy(alpha = 0.35f), RoundedCornerShape(18.dp))
            .clickable(onClick = onClick)
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(Modifier.weight(1f)) {
            Text("连接一台电脑", style = MaterialTheme.typography.titleMedium, color = TextPrimary)
            Text("同一局域网 · 支持同时连接多台 DSH", style = MaterialTheme.typography.bodySmall, color = TextMuted)
        }
        Text("开始", style = MaterialTheme.typography.labelLarge, color = Amber)
    }
}
