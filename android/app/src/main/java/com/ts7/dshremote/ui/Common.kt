package com.ts7.dshremote.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.ts7.dshremote.data.ConnectionState
import com.ts7.dshremote.data.SessionSummary
import com.ts7.dshremote.ui.theme.Amber
import com.ts7.dshremote.ui.theme.Danger
import com.ts7.dshremote.ui.theme.Ink
import com.ts7.dshremote.ui.theme.MonoText
import com.ts7.dshremote.ui.theme.Outline
import com.ts7.dshremote.ui.theme.Success
import com.ts7.dshremote.ui.theme.SurfaceRaised
import com.ts7.dshremote.ui.theme.TextMuted
import com.ts7.dshremote.ui.theme.TextPrimary
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

fun formatTime(value: Long?): String {
    if (value == null || value <= 0) return "—"
    return SimpleDateFormat("MM-dd HH:mm", Locale.getDefault()).format(Date(value))
}

fun baseName(path: String?): String {
    if (path.isNullOrBlank()) return "未指定目录"
    return path.replace('\\', '/').trimEnd('/').substringAfterLast('/').ifBlank { path }
}

@Composable
fun StatusDot(color: Color, size: Int = 8) {
    Box(
        Modifier
            .size(size.dp)
            .clip(CircleShape)
            .background(color)
    )
}

@Composable
fun ConnectionPill(state: ConnectionState) {
    val (color, label) = when (state) {
        ConnectionState.Connected -> Success to "已连接"
        ConnectionState.Connecting -> Amber to "连接中"
        ConnectionState.Error -> Danger to "连接失败"
        ConnectionState.Disconnected -> TextMuted to "未连接"
    }
    Row(
        Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(SurfaceRaised)
            .padding(horizontal = 10.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        StatusDot(color, 7)
        Spacer(Modifier.width(6.dp))
        Text(label, style = MaterialTheme.typography.labelMedium, color = TextMuted)
    }
}

@Composable
fun SectionLabel(text: String, trailing: String? = null) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(top = 18.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text.uppercase(),
            style = MaterialTheme.typography.labelSmall,
            color = TextMuted,
            letterSpacing = MaterialTheme.typography.labelSmall.letterSpacing
        )
        Spacer(Modifier.weight(1f))
        if (trailing != null) {
            Text(trailing, style = MaterialTheme.typography.labelSmall, color = TextMuted)
        }
    }
}

@Composable
fun SessionCard(
    session: SessionSummary,
    showFolderIcon: Boolean = true,
    showCwd: Boolean = true,
    onClick: () -> Unit
) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp)
            .border(1.dp, Outline, RoundedCornerShape(20.dp))
            .clickable(onClick = onClick),
        color = SurfaceRaised,
        shape = RoundedCornerShape(20.dp)
    ) {
        Row(
            Modifier.padding(16.dp),
            verticalAlignment = Alignment.Top
        ) {
            if (showFolderIcon) {
                Box(
                    Modifier
                        .size(44.dp)
                        .clip(RoundedCornerShape(14.dp))
                        .background(Color(0xFFE9EEF8)),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        Icons.Outlined.Folder,
                        contentDescription = null,
                        tint = if (session.running) Amber else TextMuted,
                        modifier = Modifier.size(23.dp)
                    )
                }
                Spacer(Modifier.width(12.dp))
            }
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        session.title?.takeIf { it.isNotBlank() } ?: "未命名任务",
                        style = MaterialTheme.typography.titleMedium,
                        color = TextPrimary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false)
                    )
                    if (session.running) {
                        Spacer(Modifier.width(8.dp))
                        StatusDot(Success, 7)
                    }
                }
                if (showCwd) {
                    Spacer(Modifier.height(4.dp))
                    Text(
                        baseName(session.cwd),
                        style = MonoText,
                        color = TextMuted,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (session.plan.active) Chip("PLAN", Amber)
                    if (session.permission != null) Chip(session.permission!!.uppercase(), TextMuted)
                    Chip(formatTime(session.updatedAt), TextMuted)
                }
            }
        }
    }
}

@Composable
fun Chip(text: String, color: Color) {
    Text(
        text,
        style = MaterialTheme.typography.labelSmall,
        color = color,
        modifier = Modifier
            .clip(RoundedCornerShape(6.dp))
            .background(Ink.copy(alpha = 0.55f))
            .padding(horizontal = 7.dp, vertical = 3.dp)
    )
}

@Composable
fun EmptyState(title: String, body: String) {
    Column(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 36.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(title, style = MaterialTheme.typography.titleMedium, color = TextPrimary)
        Spacer(Modifier.height(8.dp))
        Text(body, style = MaterialTheme.typography.bodyMedium, color = TextMuted)
    }
}

@Composable
fun PendingBanner(count: Int, onClick: () -> Unit) {
    if (count <= 0) return
    Row(
        Modifier
            .fillMaxWidth()
            .padding(top = 10.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(Color(0xFFFFF4E0))
            .border(1.dp, Amber.copy(alpha = 0.45f), RoundedCornerShape(16.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        StatusDot(Amber, 8)
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text("$count 项需要你处理", style = MaterialTheme.typography.titleMedium, color = Amber)
            Text("审批与提问会在这里等待答复", style = MaterialTheme.typography.bodySmall, color = TextMuted)
        }
        Text("查看", style = MaterialTheme.typography.labelLarge, color = Amber)
    }
}

@Composable
fun TitleText(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.displaySmall,
        fontWeight = FontWeight.SemiBold,
        color = TextPrimary
    )
}
