package com.ts7.dshremote.ui.screens

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.widget.Toast
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowBack
import androidx.compose.material.icons.outlined.ArrowUpward
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.PendingActions
import androidx.compose.material.icons.outlined.Terminal
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import com.ts7.dshremote.data.AppState
import com.ts7.dshremote.data.BridgeRepository
import com.ts7.dshremote.data.SessionPrefs
import com.ts7.dshremote.data.TimelineImage
import com.ts7.dshremote.data.TimelineItem
import com.ts7.dshremote.ui.ApprovalCard
import com.ts7.dshremote.ui.QuestionCard
import com.ts7.dshremote.ui.StatusDot
import com.ts7.dshremote.ui.baseName
import com.ts7.dshremote.ui.formatTime
import com.ts7.dshremote.ui.theme.Amber
import com.ts7.dshremote.ui.theme.Danger
import com.ts7.dshremote.ui.theme.Ink
import com.ts7.dshremote.ui.theme.MonoText
import com.ts7.dshremote.ui.theme.Outline
import com.ts7.dshremote.ui.theme.SurfaceRaised
import com.ts7.dshremote.ui.theme.TextMuted
import com.ts7.dshremote.ui.theme.TextPrimary
import kotlinx.coroutines.launch

private enum class SessionDialog { Rename, Permission, Plan, Stop, Delete }

/**
 * 贴底时额外滚动的像素量。简洁模式把大段工具调用压成一行，只滚到最后一项会把它
 * 顶到屏幕最上沿；补一屏高度后列表会自己夹到末尾，内容就贴底了。
 */
private const val SessionScrollTailPx = 2000f

@Composable
fun SessionScreen(
    repository: BridgeRepository,
    state: AppState,
    onBack: () -> Unit,
    onApprovals: () -> Unit
) {
    val session = state.activeSession
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    val listState = rememberLazyListState()

    /** 整段对话铺成纯文本：消息气泡支持长按选词，这个入口负责一键全量复制。 */
    fun copyWholeConversation() {
        val text = timelineToPlainText(state.timeline, state.streamText)
        if (text.isBlank()) {
            Toast.makeText(context, "还没有可复制的内容", Toast.LENGTH_SHORT).show()
            return
        }
        clipboard.setText(AnnotatedString(text))
        Toast.makeText(context, "已复制整段对话 ${text.length} 字", Toast.LENGTH_SHORT).show()
    }

    var menuOpen by remember { mutableStateOf(false) }
    var showDetails by remember { mutableStateOf(SessionPrefs.showDetails(context)) }
    var expandedGroups by remember(session?.id) { mutableStateOf(emptySet<Long>()) }
    val rows = remember(state.timeline, showDetails) { buildTimelineRows(state.timeline, showDetails) }
    var dialog by remember { mutableStateOf<SessionDialog?>(null) }
    var input by remember { mutableStateOf("") }
    var mode by remember { mutableStateOf("queue") }
    var images by remember { mutableStateOf<List<com.ts7.dshremote.data.PromptImage>>(emptyList()) }
    var imageError by remember { mutableStateOf<String?>(null) }
    var renameText by remember(session?.id) { mutableStateOf(session?.title.orEmpty()) }
    var planActive by remember(session?.id) { mutableStateOf(session?.plan?.active == true) }
    var acting by remember { mutableStateOf(false) }
    /** 点开的图片。整屏查看复用同一份已下载字节。 */
    var viewer by remember { mutableStateOf<Pair<TimelineItem, TimelineImage>?>(null) }
    val imageSessionId = state.activeSessionId ?: state.detail?.session?.id
    val imageLoader: suspend (String, Long, Int) -> ByteArray = remember(repository) {
        { sessionId, seq, index -> repository.imageBytes(sessionId, seq, index) }
    }
    val pickImages = com.ts7.dshremote.ui.rememberImagePicker(
        onImages = { picked ->
            images = (images + picked).take(com.ts7.dshremote.data.ImagePayload.MAX_IMAGES)
            imageError = null
        },
        onError = { imageError = it }
    )

    LaunchedEffect(session?.id) { images = emptyList() }

    val approval = state.pending.approvals.firstOrNull { it.sessionId == null || it.sessionId == state.activeSessionId }
    val question = state.pending.questions.firstOrNull { it.sessionId == null || it.sessionId == state.activeSessionId }

    LaunchedEffect(state.timeline.size, state.streamText.length, showDetails) {
        val last = rows.lastIndex
        if (last >= 0) {
            // 简洁模式把大段工具调用压成一行，只滚到“最后一项”会把它顶到屏幕最上沿、
            // 下面空一大片；补一屏的滚动量，让内容贴底。
            runCatching {
                listState.scrollToItem(last)
                listState.scrollBy(SessionScrollTailPx)
            }
        }
    }

    Surface(color = Ink, modifier = Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().imePadding()) {
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
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            session?.title?.takeIf { it.isNotBlank() } ?: "未命名任务",
                            style = MaterialTheme.typography.titleLarge,
                            color = TextPrimary,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        if (session?.running == true) {
                            Spacer(Modifier.width(8.dp))
                            StatusDot(com.ts7.dshremote.ui.theme.Success, 7)
                        }
                    }
                    Text(baseName(session?.cwd), style = MonoText, color = TextMuted, maxLines = 1)
                }
                if (state.pendingCount > 0) {
                    BadgedBox(
                        badge = {
                            Badge(containerColor = Amber, contentColor = Ink) {
                                Text("${state.pendingCount}")
                            }
                        }
                    ) {
                        IconButton(onClick = onApprovals) {
                            Icon(Icons.Outlined.PendingActions, contentDescription = "待审批", tint = Amber)
                        }
                    }
                }
                Box {
                    IconButton(onClick = { menuOpen = true }) {
                        Icon(Icons.Outlined.MoreVert, contentDescription = "更多", tint = TextMuted)
                    }
                    DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                        DropdownMenuItem(text = { Text("重命名") }, onClick = { menuOpen = false; dialog = SessionDialog.Rename })
                        DropdownMenuItem(text = { Text("权限预设") }, onClick = { menuOpen = false; dialog = SessionDialog.Permission })
                        DropdownMenuItem(text = { Text("计划模式") }, onClick = { menuOpen = false; dialog = SessionDialog.Plan })
                        DropdownMenuItem(
                            text = { Text(if (showDetails) "隐藏执行细节" else "显示执行细节") },
                            onClick = {
                                menuOpen = false
                                showDetails = !showDetails
                                SessionPrefs.setShowDetails(context, showDetails)
                            }
                        )
                        DropdownMenuItem(
                            text = { Text("复制整段对话") },
                            onClick = {
                                menuOpen = false
                                copyWholeConversation()
                            }
                        )
                        DropdownMenuItem(text = { Text("停止任务", color = Danger) }, onClick = { menuOpen = false; dialog = SessionDialog.Stop })
                        DropdownMenuItem(text = { Text("彻底删除", color = Danger) }, onClick = { menuOpen = false; dialog = SessionDialog.Delete })
                    }
                }
            }

            LazyColumn(
                state = listState,
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth(),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp, vertical = 8.dp)
            ) {
                if (state.timeline.isEmpty() && state.streamText.isBlank()) {
                    item {
                        Text(
                            "还没有消息。发送第一条指令，DSH 会在电脑上开始工作。",
                            style = MaterialTheme.typography.bodyMedium,
                            color = TextMuted,
                            modifier = Modifier.padding(vertical = 28.dp)
                        )
                    }
                }
                items(rows) { row ->
                    when (row) {
                        is TimelineRowModel.Single -> TimelineRow(
                            item = row.item,
                            sessionId = imageSessionId,
                            loadImage = imageLoader,
                            onOpenImage = { item, image -> viewer = item to image }
                        )
                        is TimelineRowModel.Tools -> {
                            val key = row.items.firstOrNull()?.seq ?: row.items.first().hashCode().toLong()
                            ToolGroupRow(
                                items = row.items,
                                expanded = key in expandedGroups,
                                onToggle = {
                                    expandedGroups = if (key in expandedGroups) expandedGroups - key else expandedGroups + key
                                }
                            )
                        }
                    }
                }
                if (state.streamText.isNotBlank()) {
                    item {
                        Row(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                            Surface(
                                color = SurfaceRaised,
                                shape = RoundedCornerShape(18.dp),
                                modifier = Modifier.widthIn(max = 320.dp)
                            ) {
                                SelectionContainer {
                                    Text(
                                        state.streamText + " ▍",
                                        style = MaterialTheme.typography.bodyLarge,
                                        color = TextPrimary,
                                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp)
                                    )
                                }
                            }
                        }
                    }
                }
            }

            if (approval != null) {
                Box(Modifier.padding(horizontal = 12.dp, vertical = 6.dp)) {
                    ApprovalCard(approval, onResolve = { action ->
                        scope.launch {
                            acting = true
                            repository.approve(approval.id, action)
                            acting = false
                        }
                    }, busy = acting)
                }
            } else if (question != null) {
                Box(Modifier.padding(horizontal = 12.dp, vertical = 6.dp)) {
                    QuestionCard(question, onSubmit = { answers ->
                        scope.launch {
                            acting = true
                            repository.answer(question.id, answers)
                            acting = false
                        }
                    }, busy = acting)
                }
            }

            viewer?.let { (item, image) ->
                ImageViewerDialog(
                    item = item,
                    image = image,
                    sessionId = imageSessionId,
                    loadImage = imageLoader,
                    onDismiss = { viewer = null }
                )
            }

            if (state.pendingCount > 0 && approval == null && question == null) {
                TextButton(onClick = onApprovals, modifier = Modifier.padding(horizontal = 12.dp)) {
                    Text("${state.pendingCount} 项审批在其他任务中", color = Amber)
                }
            }

            if (images.isNotEmpty() || imageError != null) {
                Column(Modifier.padding(horizontal = 12.dp, vertical = 4.dp)) {
                    com.ts7.dshremote.ui.AttachmentChips(
                        images = images,
                        onRemove = { index -> images = images.filterIndexed { i, _ -> i != index } }
                    )
                    imageError?.let {
                        Text(it, style = MaterialTheme.typography.labelSmall, color = Danger)
                    }
                }
            }

            Row(
                Modifier
                    .fillMaxWidth()
                    .background(SurfaceRaised)
                    .padding(horizontal = 10.dp, vertical = 8.dp),
                verticalAlignment = Alignment.Bottom
            ) {
                com.ts7.dshremote.ui.AttachImageButton(
                    onClick = {
                        imageError = null
                        pickImages()
                    },
                    enabled = images.size < com.ts7.dshremote.data.ImagePayload.MAX_IMAGES && !acting
                )
                Spacer(Modifier.width(6.dp))
                OutlinedTextField(
                    value = input,
                    onValueChange = { input = it },
                    placeholder = { Text(if (session?.running == true) "继续追加指令…" else "让 DSH 做什么？") },
                    modifier = Modifier.weight(1f),
                    maxLines = 4,
                    textStyle = MaterialTheme.typography.bodyLarge,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                    keyboardActions = KeyboardActions(onSend = {
                        val text = input.trim()
                        if (text.isNotBlank() || images.isNotEmpty()) {
                            scope.launch {
                                val sent = repository.sendPrompt(text, mode, images)
                                if (sent.isSuccess) {
                                    input = ""
                                    images = emptyList()
                                    imageError = null
                                } else {
                                    imageError = sent.exceptionOrNull()?.message ?: "发送失败"
                                }
                            }
                        }
                    }),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = Amber,
                        unfocusedBorderColor = Outline,
                        focusedContainerColor = Ink,
                        unfocusedContainerColor = Ink,
                        focusedTextColor = TextPrimary,
                        unfocusedTextColor = TextPrimary,
                        cursorColor = Amber
                    )
                )
                Spacer(Modifier.width(8.dp))
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        if (mode == "queue") "排队" else "插入",
                        style = MaterialTheme.typography.labelSmall,
                        color = TextMuted,
                        modifier = Modifier
                            .background(Ink, RoundedCornerShape(6.dp))
                            .padding(horizontal = 6.dp, vertical = 2.dp)
                    )
                    IconButton(
                        onClick = {
                            mode = if (mode == "queue") "steer" else "queue"
                        }
                    ) {
                        Text(if (mode == "queue") "Q" else "S", style = MaterialTheme.typography.labelMedium, color = Amber)
                    }
                }
                IconButton(
                    onClick = {
                        val text = input.trim()
                        if (text.isNotBlank() || images.isNotEmpty()) {
                            scope.launch {
                                val sent = repository.sendPrompt(text, mode, images)
                                if (sent.isSuccess) {
                                    input = ""
                                    images = emptyList()
                                    imageError = null
                                } else {
                                    imageError = sent.exceptionOrNull()?.message ?: "发送失败"
                                }
                            }
                        }
                    },
                    enabled = input.isNotBlank() || images.isNotEmpty(),
                    modifier = Modifier
                        .size(48.dp)
                        .background(if (input.isNotBlank() || images.isNotEmpty()) Amber else Outline, RoundedCornerShape(14.dp))
                ) {
                    Icon(
                        Icons.Outlined.ArrowUpward,
                        contentDescription = "发送",
                        tint = if (input.isNotBlank() || images.isNotEmpty()) Color(0xFFFFFFFF) else TextMuted
                    )
                }
            }
        }
    }

    when (dialog) {
        SessionDialog.Rename -> RenameDialog(
            value = renameText,
            onValueChange = { renameText = it },
            onDismiss = { dialog = null },
            onConfirm = {
                scope.launch {
                    repository.renameSession(renameText)
                    dialog = null
                }
            }
        )
        SessionDialog.Permission -> PermissionDialog(
            presets = state.presets,
            current = session?.permission,
            onDismiss = { dialog = null },
            onSelect = { preset ->
                scope.launch {
                    repository.setPermission(preset)
                    dialog = null
                }
            }
        )
        SessionDialog.Plan -> PlanDialog(
            active = planActive,
            onChange = { planActive = it },
            onDismiss = { dialog = null },
            onConfirm = {
                scope.launch {
                    repository.setPlan(planActive)
                    dialog = null
                }
            }
        )
        SessionDialog.Stop -> AlertDialog(
            onDismissRequest = { dialog = null },
            title = { Text("停止当前任务？") },
            text = { Text("DSH 会中断正在运行的一轮。已产生的记录会保留。") },
            confirmButton = {
                TextButton(onClick = {
                    scope.launch {
                        repository.cancelSession()
                        dialog = null
                    }
                }) { Text("停止", color = Danger) }
            },
            dismissButton = { TextButton(onClick = { dialog = null }) { Text("取消") } },
            containerColor = SurfaceRaised,
            titleContentColor = TextPrimary,
            textContentColor = TextMuted
        )
        SessionDialog.Delete -> AlertDialog(
            onDismissRequest = { dialog = null },
            title = { Text("彻底删除这个任务？") },
            text = { Text("会从工作区移除，并删除该会话在磁盘上的日志目录，无法恢复。运行中的任务需要先停止。") },
            confirmButton = {
                TextButton(onClick = {
                    scope.launch {
                        val deleted = repository.deleteActiveSession().isSuccess
                        dialog = null
                        if (deleted) onBack()
                    }
                }) { Text("删除", color = Danger) }
            },
            dismissButton = { TextButton(onClick = { dialog = null }) { Text("取消") } },
            containerColor = MaterialTheme.colorScheme.surface,
            titleContentColor = TextPrimary,
            textContentColor = TextMuted
        )
        null -> Unit
    }
}

/** 简洁模式把相邻的工具调用/结果合并成一行摘要，其余消息原样展示。 */
private sealed interface TimelineRowModel {    data class Single(val item: TimelineItem) : TimelineRowModel
    data class Tools(val items: List<TimelineItem>) : TimelineRowModel
}

private fun buildTimelineRows(timeline: List<TimelineItem>, showDetails: Boolean): List<TimelineRowModel> {
    if (showDetails) return timeline.map { TimelineRowModel.Single(it) }
    val rows = mutableListOf<TimelineRowModel>()
    val tools = mutableListOf<TimelineItem>()
    fun flush() {
        if (tools.isEmpty()) return
        rows += TimelineRowModel.Tools(tools.toList())
        tools.clear()
    }
    timeline.forEach { item ->
        if (item.kind == "tool-call" || item.kind == "tool-result") {
            tools += item
        } else {
            flush()
            rows += TimelineRowModel.Single(item)
        }
    }
    flush()
    return rows
}

/**
 * 把整段对话铺成可复制的纯文本：用户/助手消息整段保留，工具调用与结果压成一行，
 * 生成中的流式文本附在最后。手机上没有跨气泡框选的机制，这条通路负责全量复制。
 */
private fun timelineToPlainText(timeline: List<TimelineItem>, streamText: String): String {
    val builder = StringBuilder()
    timeline.forEach { item ->
        val body = item.text.orEmpty().ifBlank { item.preview.orEmpty() }
        when (item.kind) {
            "user" -> builder.append("[我]\n").append(body).append("\n\n")
            "assistant" -> builder.append("[DSH]\n").append(body).append("\n\n")
            "tool-call" -> {
                builder.append("· 工具 ").append(item.name ?: "tool")
                if (body.isNotBlank()) builder.append("：").append(body.take(600))
                builder.append('\n')
            }
            "tool-result" -> {
                val result = (item.reason ?: body).take(600)
                if (result.isNotBlank()) builder.append(result).append('\n')
            }
            "turn" -> builder.append(if (item.phase == "end") "—— 完成 ——\n" else "—— 运行中 ——\n")
            else -> if (body.isNotBlank()) builder.append(body).append('\n')
        }
    }
    if (streamText.isNotBlank()) builder.append("[DSH 生成中]\n").append(streamText).append('\n')
    return builder.toString().trim()
}

@Composable
private fun ToolGroupRow(items: List<TimelineItem>, expanded: Boolean, onToggle: () -> Unit) {
    val calls = items.filter { it.kind == "tool-call" }
    val error = items.firstOrNull { it.kind == "tool-result" && it.isError }
    val names = calls.mapNotNull { it.name?.takeIf { name -> name.isNotBlank() } }.distinct()
    val summary = buildString {
        append("执行 ")
        append(if (calls.isEmpty()) "工具" else "${calls.size} 步")
        if (names.isNotEmpty()) {
            append(" · ")
            append(names.take(3).joinToString(", "))
            if (names.size > 3) append(" 等")
        }
    }
    val errorText = error?.let { it.reason ?: it.text }?.takeIf { it.isNotBlank() }?.take(200)
    Column(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Row(
            Modifier
                .fillMaxWidth()
                .background(Color(0xFFF3F6F4), RoundedCornerShape(12.dp))
                .border(1.dp, if (error != null) Danger.copy(alpha = 0.5f) else Outline, RoundedCornerShape(12.dp))
                .clickable(onClick = onToggle)
                .padding(horizontal = 10.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                Icons.Outlined.Terminal,
                contentDescription = null,
                tint = if (error != null) Danger else Amber,
                modifier = Modifier.size(14.dp)
            )
            Spacer(Modifier.width(8.dp))
            Column(Modifier.weight(1f)) {
                Text(summary, style = MaterialTheme.typography.labelMedium, color = TextMuted, maxLines = 1)
                if (errorText != null) {
                    Text(
                        errorText,
                        style = MaterialTheme.typography.bodySmall,
                        color = Danger,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            }
            Icon(
                if (expanded) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore,
                contentDescription = if (expanded) "收起细节" else "展开细节",
                tint = TextMuted,
                modifier = Modifier.size(18.dp)
            )
        }
        if (expanded) {
            items.forEach { TimelineRow(it) }
        }
    }
}

@Composable
private fun TimelineRow(
    item: TimelineItem,
    sessionId: String? = null,
    loadImage: (suspend (String, Long, Int) -> ByteArray)? = null,
    onOpenImage: (TimelineItem, TimelineImage) -> Unit = { _, _ -> }
) {
    when (item.kind) {
        "user" -> Row(
            Modifier.fillMaxWidth().padding(vertical = 4.dp),
            horizontalArrangement = Arrangement.End
        ) {
            Surface(
                color = Color(0xFFE8EDFF),
                shape = RoundedCornerShape(18.dp),
                modifier = Modifier.widthIn(max = 320.dp)
            ) {
                Column(
                    modifier = Modifier.padding(
                        horizontal = if (item.images.isEmpty()) 14.dp else 10.dp,
                        vertical = if (item.images.isEmpty()) 10.dp else 10.dp
                    )
                ) {
                    if (item.images.isNotEmpty()) {
                        MessageImages(item, sessionId, loadImage, onOpenImage)
                    }
                    if (!item.text.isNullOrBlank()) {
                        // 长按气泡即可选词：SelectionContainer 给系统选择手柄和「复制/全选」菜单。
                        SelectionContainer {
                            Text(
                                item.text.orEmpty(),
                                style = MaterialTheme.typography.bodyLarge,
                                color = TextPrimary,
                                modifier = Modifier.padding(
                                    start = if (item.images.isEmpty()) 0.dp else 4.dp,
                                    end = if (item.images.isEmpty()) 0.dp else 4.dp,
                                    top = if (item.images.isEmpty()) 0.dp else 8.dp
                                )
                            )
                        }
                    }
                }
            }
        }
        "assistant" -> Row(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
            Surface(
                color = SurfaceRaised,
                shape = RoundedCornerShape(18.dp),
                modifier = Modifier.widthIn(max = 340.dp)
            ) {
                Column(
                    modifier = Modifier.padding(
                        horizontal = if (item.images.isEmpty()) 14.dp else 10.dp,
                        vertical = 10.dp
                    )
                ) {
                    if (item.images.isNotEmpty()) {
                        MessageImages(item, sessionId, loadImage, onOpenImage)
                    }
                    if (!item.text.isNullOrBlank() || item.interrupted) {
                        SelectionContainer {
                            Text(
                                item.text.orEmpty() + if (item.interrupted) "\n\n[已中断]" else "",
                                style = MaterialTheme.typography.bodyLarge,
                                color = TextPrimary,
                                modifier = Modifier.padding(
                                    start = if (item.images.isEmpty()) 0.dp else 4.dp,
                                    end = if (item.images.isEmpty()) 0.dp else 4.dp,
                                    top = if (item.images.isEmpty()) 0.dp else 8.dp
                                )
                            )
                        }
                    }
                }
            }
        }
        "tool-call" -> Row(
            Modifier
                .fillMaxWidth()
                .padding(vertical = 4.dp)
                .background(Ink.copy(alpha = 0.5f), RoundedCornerShape(12.dp))
                .border(1.dp, Outline, RoundedCornerShape(12.dp))
                .padding(10.dp),
            verticalAlignment = Alignment.Top
        ) {
            Icon(Icons.Outlined.Terminal, contentDescription = null, tint = Amber, modifier = Modifier.size(15.dp))
            Spacer(Modifier.width(8.dp))
            SelectionContainer {
                Column {
                    Text(
                        item.name ?: "tool",
                        style = MaterialTheme.typography.labelMedium,
                        color = Amber
                    )
                    if (!item.preview.isNullOrBlank()) {
                        Text(item.preview, style = MonoText, color = TextMuted, maxLines = 5)
                    }
                }
            }
        }
        "tool-result" -> {
            if (!item.text.isNullOrBlank() || !item.reason.isNullOrBlank()) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(vertical = 2.dp)
                        .background(if (item.isError) Color(0xFFFFE9E9) else Color(0xFFF3F6F4), RoundedCornerShape(10.dp))
                        .padding(10.dp)
                ) {
                    SelectionContainer {
                        Text(
                            item.reason ?: item.text.orEmpty(),
                            style = MonoText.copy(fontSize = MaterialTheme.typography.bodySmall.fontSize),
                            color = if (item.isError) Danger else TextMuted,
                            maxLines = 12
                        )
                    }
                }
            }
        }
        "turn" -> Row(
            Modifier.fillMaxWidth().padding(vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(Modifier.weight(1f).height(1.dp).background(Outline))
            Text(
                if (item.phase == "end") "完成${if (item.reason != null) " · ${item.reason}" else ""}" else "运行中",
                style = MaterialTheme.typography.labelSmall,
                color = TextMuted,
                modifier = Modifier.padding(horizontal = 10.dp)
            )
            Box(Modifier.weight(1f).height(1.dp).background(Outline))
        }
        "title" -> Text(
            item.title.orEmpty(),
            style = MaterialTheme.typography.labelMedium,
            color = TextMuted,
            modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp)
        )
        else -> Unit
    }
}

/** 取一条消息里第 index 张图的像素。失败（断线、过期、解码不了）统一给 null。 */
private suspend fun loadMessageBitmap(
    sessionId: String?,
    seq: Long,
    index: Int,
    loadImage: (suspend (String, Long, Int) -> ByteArray)?
): Bitmap? {
    val session = sessionId ?: return null
    val loader = loadImage ?: return null
    val bytes = runCatching { loader(session, seq, index) }.getOrNull() ?: return null
    return runCatching { BitmapFactory.decodeByteArray(bytes, 0, bytes.size) }.getOrNull()
}

/** 消息气泡里的图片：单张铺一行，多张按两列排。 */
@Composable
private fun MessageImages(
    item: TimelineItem,
    sessionId: String?,
    loadImage: (suspend (String, Long, Int) -> ByteArray)?,
    onOpen: (TimelineItem, TimelineImage) -> Unit
) {
    val columns = if (item.images.size == 1) 1 else 2
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        item.images.chunked(columns).forEach { line ->
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                line.forEach { image ->
                    MessageImageThumb(
                        item = item,
                        image = image,
                        sessionId = sessionId,
                        loadImage = loadImage,
                        onOpen = onOpen,
                        width = if (columns == 1) 236.dp else 138.dp
                    )
                }
            }
        }
    }
}

@Composable
private fun MessageImageThumb(
    item: TimelineItem,
    image: TimelineImage,
    sessionId: String?,
    loadImage: (suspend (String, Long, Int) -> ByteArray)?,
    onOpen: (TimelineItem, TimelineImage) -> Unit,
    width: androidx.compose.ui.unit.Dp
) {
    var bitmap by remember(item.seq, image.index) { mutableStateOf<Bitmap?>(null) }
    var failed by remember(item.seq, image.index) { mutableStateOf(false) }
    LaunchedEffect(item.seq, image.index, sessionId) {
        failed = false
        val decoded = loadMessageBitmap(sessionId, item.seq, image.index, loadImage)
        if (decoded == null) failed = true else bitmap = decoded
    }
    val shown = bitmap
    Box(
        Modifier
            .width(width)
            .heightIn(max = 260.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(Color(0x14000000))
            .clickable(enabled = shown != null) { onOpen(item, image) },
        contentAlignment = Alignment.Center
    ) {
        when {
            shown != null -> Image(
                bitmap = shown.asImageBitmap(),
                contentDescription = image.name ?: "图片",
                contentScale = ContentScale.FillWidth,
                modifier = Modifier.fillMaxWidth()
            )
            failed -> Text(
                "图片加载失败",
                style = MaterialTheme.typography.labelSmall,
                color = TextMuted,
                modifier = Modifier.padding(vertical = 22.dp)
            )
            else -> CircularProgressIndicator(
                modifier = Modifier.padding(vertical = 22.dp).size(18.dp),
                strokeWidth = 2.dp,
                color = Amber
            )
        }
    }
}

/** 点缩略图后的整屏查看：点任意位置关闭。 */
@Composable
private fun ImageViewerDialog(
    item: TimelineItem,
    image: TimelineImage,
    sessionId: String?,
    loadImage: (suspend (String, Long, Int) -> ByteArray)?,
    onDismiss: () -> Unit
) {
    var bitmap by remember(item.seq, image.index) { mutableStateOf<Bitmap?>(null) }
    var failed by remember(item.seq, image.index) { mutableStateOf(false) }
    LaunchedEffect(item.seq, image.index, sessionId) {
        failed = false
        val decoded = loadMessageBitmap(sessionId, item.seq, image.index, loadImage)
        if (decoded == null) failed = true else bitmap = decoded
    }
    Dialog(onDismissRequest = onDismiss) {
        Column(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(18.dp))
                .background(Ink)
                .clickable(onClick = onDismiss)
                .padding(10.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            val shown = bitmap
            when {
                shown != null -> Image(
                    bitmap = shown.asImageBitmap(),
                    contentDescription = image.name ?: "图片",
                    contentScale = ContentScale.FillWidth,
                    modifier = Modifier.fillMaxWidth().heightIn(max = 560.dp)
                )
                failed -> Text(
                    "图片加载失败",
                    style = MaterialTheme.typography.bodyMedium,
                    color = TextMuted,
                    modifier = Modifier.padding(vertical = 40.dp)
                )
                else -> CircularProgressIndicator(
                    modifier = Modifier.padding(vertical = 40.dp),
                    color = Amber
                )
            }
            Text(
                listOfNotNull(
                    image.name,
                    image.width?.let { w -> image.height?.let { h -> "$w×$h" } }
                ).joinToString(" · ").ifBlank { "点按关闭" },
                style = MaterialTheme.typography.labelSmall,
                color = TextMuted,
                modifier = Modifier.padding(top = 8.dp, bottom = 4.dp)
            )
        }
    }
}

@Composable
private fun RenameDialog(
    value: String,
    onValueChange: (String) -> Unit,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("重命名任务") },
        text = {
            OutlinedTextField(
                value = value,
                onValueChange = onValueChange,
                singleLine = true,
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = Amber,
                    unfocusedBorderColor = Outline,
                    focusedTextColor = TextPrimary,
                    unfocusedTextColor = TextPrimary
                )
            )
        },
        confirmButton = { TextButton(onClick = onConfirm) { Text("保存") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
        containerColor = SurfaceRaised,
        titleContentColor = TextPrimary,
        textContentColor = TextMuted
    )
}

@Composable
private fun PermissionDialog(
    presets: com.ts7.dshremote.data.PresetCatalog,
    current: String?,
    onDismiss: () -> Unit,
    onSelect: (String) -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("权限预设") },
        text = {
            Column {
                Text(
                    "只允许一次审批的预设才会把审批送到手机；danger-full-access 不再询问。",
                    style = MaterialTheme.typography.bodySmall,
                    color = TextMuted
                )
                Spacer(Modifier.height(10.dp))
                val options = presets.options.ifEmpty {
                    listOf(
                        com.ts7.dshremote.data.PresetOption("read-only", "只读"),
                        com.ts7.dshremote.data.PresetOption("workspace-write", "工作区写入"),
                        com.ts7.dshremote.data.PresetOption("danger-full-access", "完全访问")
                    )
                }
                options.forEach { option ->
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .padding(vertical = 6.dp)
                            .background(
                                if (option.value == current) Color(0xFFE8EDFF) else SurfaceRaised,
                                RoundedCornerShape(12.dp)
                            )
                            .padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(option.name ?: option.value, style = MaterialTheme.typography.titleMedium, color = TextPrimary)
                            if (!option.description.isNullOrBlank()) {
                                Text(option.description, style = MaterialTheme.typography.bodySmall, color = TextMuted)
                            }
                        }
                        TextButton(onClick = { onSelect(option.value) }) {
                            Text(if (option.value == current) "当前" else "切换", color = Amber)
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("关闭") } },
        containerColor = SurfaceRaised,
        titleContentColor = TextPrimary,
        textContentColor = TextMuted
    )
}

@Composable
private fun PlanDialog(
    active: Boolean,
    onChange: (Boolean) -> Unit,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("计划模式") },
        text = {
            Column {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("先计划，后执行", style = MaterialTheme.typography.titleMedium, color = TextPrimary)
                        Text("开启后 DSH 先给出计划，等你批准再动手。", style = MaterialTheme.typography.bodySmall, color = TextMuted)
                    }
                    Switch(
                        checked = active,
                        onCheckedChange = onChange,
                        colors = SwitchDefaults.colors(checkedThumbColor = Ink, checkedTrackColor = Amber)
                    )
                }
            }
        },
        confirmButton = { TextButton(onClick = onConfirm) { Text("应用") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
        containerColor = SurfaceRaised,
        titleContentColor = TextPrimary,
        textContentColor = TextMuted
    )
}
