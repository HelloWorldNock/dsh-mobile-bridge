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
 * 时间线渲染（R20 第二刀）：工具调用折叠行、单条消息、消息里的图片缩略图与解码。
 * 从 SessionScreen 搬出，函数体未改写；导入表沿用 SessionScreen。
 */

@Composable
internal fun ToolGroupRow(items: List<TimelineItem>, expanded: Boolean, onToggle: () -> Unit) {
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
internal fun TimelineRow(
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

@Composable
internal fun MessageImages(
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
internal fun MessageImageThumb(
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

internal suspend fun loadMessageBitmap(
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
