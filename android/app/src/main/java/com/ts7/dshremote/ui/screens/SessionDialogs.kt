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


/**
 * 会话页的对话框（R20 第二刀）：图片全屏查看、重命名、权限预设、计划模式。
 * 从 SessionScreen 搬出，函数体未改写；导入表沿用 SessionScreen。
 */

@Composable
internal fun ImageViewerDialog(
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
internal fun RenameDialog(
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
internal fun PermissionDialog(
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
internal fun PlanDialog(
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
