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
import com.ts7.dshremote.data.TimelineRowModel
import com.ts7.dshremote.data.buildTimelineRows
import com.ts7.dshremote.data.timelineToPlainText
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

private enum class SessionDialog { Rename, Permission, Plan, Stop, Archive, Unarchive, Delete }

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
                        if (state.activeArchived) {
                            DropdownMenuItem(
                                text = { Text("取消归档") },
                                onClick = { menuOpen = false; dialog = SessionDialog.Unarchive }
                            )
                        } else {
                            DropdownMenuItem(text = { Text("归档会话") }, onClick = { menuOpen = false; dialog = SessionDialog.Archive })
                        }
                        DropdownMenuItem(text = { Text("彻底删除", color = Danger) }, onClick = { menuOpen = false; dialog = SessionDialog.Delete })
                    }
                }
            }

            if (state.activeArchived) {
                // 归档后任务不会立刻关掉：留在这里，用户可以从菜单直接取消归档。
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Surface(color = SurfaceRaised, shape = RoundedCornerShape(12.dp)) {
                        Text(
                            "这个任务已归档，电脑和手机的列表里都看不见它。点右上角菜单「取消归档」可以放回去。",
                            style = MaterialTheme.typography.bodySmall,
                            color = Amber,
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)
                        )
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
        SessionDialog.Archive -> AlertDialog(
            onDismissRequest = { dialog = null },
            title = { Text("归档这个任务？") },
            text = { Text("归档后手机和电脑的任务列表都不再显示它，会话日志保留。想找回来时，在电脑上面板或手机当前任务菜单里取消归档都会回到原来的位置。") },
            confirmButton = {
                TextButton(onClick = {
                    scope.launch {
                        val archived = repository.archiveActiveSession().isSuccess
                        dialog = null
                        if (archived) onBack()
                    }
                }) { Text("归档") }
            },
            dismissButton = { TextButton(onClick = { dialog = null }) { Text("取消") } },
            containerColor = SurfaceRaised,
            titleContentColor = TextPrimary,
            textContentColor = TextMuted
        )
        SessionDialog.Unarchive -> AlertDialog(
            onDismissRequest = { dialog = null },
            title = { Text("取消归档这个任务？") },
            text = { Text("取消归档后，它会回到工作区原来的位置，电脑和手机的任务列表都会重新显示它。") },
            confirmButton = {
                TextButton(onClick = {
                    scope.launch {
                        repository.unarchiveActiveSession()
                        dialog = null
                    }
                }) { Text("取消归档") }
            },
            dismissButton = { TextButton(onClick = { dialog = null }) { Text("关闭") } },
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