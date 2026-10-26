package com.ts7.dshremote.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowBack
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.LinkOff
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.VerifiedUser
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.ts7.dshremote.data.AppState
import com.ts7.dshremote.ui.ConnectionPill
import com.ts7.dshremote.ui.SectionLabel
import com.ts7.dshremote.ui.theme.Amber
import com.ts7.dshremote.ui.theme.Danger
import com.ts7.dshremote.ui.theme.Ink
import com.ts7.dshremote.ui.theme.MonoText
import com.ts7.dshremote.ui.theme.Outline
import com.ts7.dshremote.ui.theme.SurfaceRaised
import com.ts7.dshremote.ui.theme.TextMuted
import com.ts7.dshremote.ui.theme.TextPrimary

@Composable
fun SettingsScreen(
    state: AppState,
    onBack: () -> Unit,
    onRetry: () -> Unit,
    onForget: () -> Unit,
    onApprovals: () -> Unit
) {
    var confirmForget by remember { mutableStateOf(false) }
    val host = state.info?.bridge
    val device = state.info?.device

    Surface(color = Ink, modifier = Modifier.fillMaxSize()) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
        ) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                IconButton(onClick = onBack) {
                    Icon(Icons.Outlined.ArrowBack, contentDescription = "返回", tint = TextPrimary)
                }
                Column(Modifier.weight(1f)) {
                    Text("设置", style = MaterialTheme.typography.titleLarge, color = TextPrimary)
                    Text("连接、审批与主机信息", style = MaterialTheme.typography.bodySmall, color = TextMuted)
                }
                ConnectionPill(state.connection)
            }

            Column(Modifier.padding(horizontal = 18.dp)) {
                SectionLabel("连接")
                Row(
                    Modifier
                        .fillMaxWidth()
                        .background(SurfaceRaised, RoundedCornerShape(18.dp))
                        .padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(host?.hostName ?: "未知主机", style = MaterialTheme.typography.titleMedium, color = TextPrimary)
                        Text(state.baseUrl.ifBlank { "未配对" }, style = MonoText, color = TextMuted)
                    }
                    OutlinedButton(onClick = onRetry, shape = RoundedCornerShape(12.dp)) {
                        Icon(Icons.Outlined.Refresh, contentDescription = null, tint = Amber)
                        Spacer(Modifier.width(6.dp))
                        Text("重连", color = Amber)
                    }
                }
                Spacer(Modifier.height(8.dp))
                Row(
                    Modifier
                        .fillMaxWidth()
                        .background(SurfaceRaised, RoundedCornerShape(18.dp))
                        .clickable { onApprovals() }
                        .padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(Icons.Outlined.VerifiedUser, contentDescription = null, tint = Amber)
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text("待处理审批", style = MaterialTheme.typography.titleMedium, color = TextPrimary)
                        Text("${state.pendingCount} 项", style = MaterialTheme.typography.bodySmall, color = TextMuted)
                    }
                    Icon(Icons.Outlined.ChevronRight, contentDescription = null, tint = TextMuted)
                }

                SectionLabel("主机信息")
                InfoRow("设备 ID", host?.deviceId ?: "—")
                InfoRow("桥接版本", host?.version ?: "—")
                InfoRow("端口", (host?.port ?: 48123).toString())
                InfoRow("在线客户端", (host?.clients ?: 0).toString())
                InfoRow("此手机 ID", device?.id ?: "—")

                SectionLabel("安全")
                Text(
                    "审批与提问会先发到已连接手机；手机离线或超时后自动回退桌面。完全访问预设下不会产生审批。",
                    style = MaterialTheme.typography.bodySmall,
                    color = TextMuted
                )
                Spacer(Modifier.height(10.dp))
                OutlinedButton(
                    onClick = { confirmForget = true },
                    modifier = Modifier.fillMaxWidth().height(50.dp),
                    shape = RoundedCornerShape(14.dp)
                ) {
                    Icon(Icons.Outlined.LinkOff, contentDescription = null, tint = Danger)
                    Spacer(Modifier.width(8.dp))
                    Text("断开并重新配对", color = Danger)
                }

                SectionLabel("关于")
                Text("TS7 DSH Remote 0.1.0", style = MaterialTheme.typography.bodyMedium, color = TextPrimary)
                Text(
                    "Android 客户端 · 通过局域网连接 DeepSeek Harness 手机桥接插件",
                    style = MaterialTheme.typography.bodySmall,
                    color = TextMuted,
                    modifier = Modifier.padding(top = 4.dp)
                )
                Spacer(Modifier.height(40.dp))
            }
        }
    }

    if (confirmForget) {
        AlertDialog(
            onDismissRequest = { confirmForget = false },
            title = { Text("断开配对？") },
            text = { Text("这台手机将清除保存的 token，需要重新输入电脑设置页的配对码。") },
            confirmButton = {
                TextButton(onClick = {
                    confirmForget = false
                    onForget()
                }) { Text("断开", color = Danger) }
            },
            dismissButton = {
                TextButton(onClick = { confirmForget = false }) { Text("取消") }
            },
            containerColor = SurfaceRaised
        )
    }
}

@Composable
private fun InfoRow(label: String, value: String) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 7.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(label, style = MaterialTheme.typography.bodyMedium, color = TextMuted)
        Text(value, style = MonoText, color = TextPrimary)
    }
}
