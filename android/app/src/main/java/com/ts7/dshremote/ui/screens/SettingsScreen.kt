package com.ts7.dshremote.ui.screens

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
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
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import android.Manifest
import android.content.Intent
import android.net.Uri
import com.ts7.dshremote.BuildConfig
import com.ts7.dshremote.data.AppState
import com.ts7.dshremote.data.ConnectionState
import com.ts7.dshremote.data.EmbeddedTailscale
import com.ts7.dshremote.data.Endpoints
import com.ts7.dshremote.data.GroupInfo
import com.ts7.dshremote.data.HostSummary
import com.ts7.dshremote.notify.Alerts
import com.ts7.dshremote.notify.KeepAlive
import com.ts7.dshremote.notify.Reliability
import com.ts7.dshremote.ui.ConnectionPill
import com.ts7.dshremote.ui.SectionLabel
import com.ts7.dshremote.ui.StatusDot
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

@Composable
fun SettingsScreen(
    state: AppState,
    tailscale: EmbeddedTailscale,
    onBack: () -> Unit,
    onRetry: (String) -> Unit,
    onSelectHost: (String) -> Unit,
    onPairNew: () -> Unit,
    onForgetHost: (String) -> Unit,
    onAddEndpoint: (String, String) -> Result<Unit>,
    onApprovals: () -> Unit,
    onLinkGroup: suspend () -> String?,
    onCheckUpdate: () -> Unit
) {
    var forgetTarget by remember { mutableStateOf<HostSummary?>(null) }
    var endpointDialog by remember { mutableStateOf(false) }
    var endpointUrl by remember { mutableStateOf("") }
    var endpointError by remember { mutableStateOf<String?>(null) }
    var authKeyDialog by remember { mutableStateOf(false) }
    var authKeyValue by remember { mutableStateOf("") }
    val ts by tailscale.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
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
                    Text(
                        if (state.hosts.isEmpty()) "连接、审批与主机信息"
                        else "${state.connectedHostCount}/${state.hosts.size} 台主机在线",
                        style = MaterialTheme.typography.bodySmall,
                        color = TextMuted
                    )
                }
                ConnectionPill(state.connection)
            }

            Column(Modifier.padding(horizontal = 18.dp)) {
                SectionLabel("已配对主机", "${state.hosts.size} 台")
                if (state.hosts.isEmpty()) {
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .background(SurfaceRaised, RoundedCornerShape(18.dp))
                            .clickable { onPairNew() }
                            .padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text("还没有配对主机", style = MaterialTheme.typography.titleMedium, color = TextPrimary)
                            Text("在同一 Wi-Fi 下连接电脑端的 DSH 桥接", style = MaterialTheme.typography.bodySmall, color = TextMuted)
                        }
                        Text("添加", style = MaterialTheme.typography.labelLarge, color = Amber)
                    }
                } else {
                    state.hosts.forEach { item ->
                        HostRow(
                            host = item,
                            onSelect = { onSelectHost(item.id) },
                            onRetry = { onRetry(item.id) },
                            onForget = { forgetTarget = item }
                        )
                        Spacer(Modifier.height(8.dp))
                    }
                }
                Spacer(Modifier.height(4.dp))
                OutlinedButton(
                    onClick = onPairNew,
                    modifier = Modifier.fillMaxWidth().height(48.dp),
                    shape = RoundedCornerShape(14.dp)
                ) {
                    Icon(Icons.Outlined.Add, contentDescription = null, tint = Amber)
                    Spacer(Modifier.width(8.dp))
                    Text("添加另一台主机", color = Amber)
                }

                Spacer(Modifier.height(8.dp))
                GroupCard(state = state, onLink = onLinkGroup)

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
                        Text(
                            if (state.hosts.size > 1) "${state.totalPendingCount} 项 · 来自 ${state.pendingHosts.size} 台主机"
                            else "${state.pendingCount} 项",
                            style = MaterialTheme.typography.bodySmall,
                            color = TextMuted
                        )
                    }
                    Icon(Icons.Outlined.ChevronRight, contentDescription = null, tint = TextMuted)
                }

                SectionLabel("当前主机")
                if (state.activeHost == null) {
                    Text("未选择主机", style = MaterialTheme.typography.bodyMedium, color = TextMuted)
                } else {
                    Text(
                        state.activeHost?.label ?: "未知主机",
                        style = MaterialTheme.typography.titleMedium,
                        color = TextPrimary
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(state.baseUrl.ifBlank { "未配对" }, style = MonoText, color = TextMuted)
                    val endpoints = state.activeHost?.endpoints.orEmpty()
                    if (endpoints.size > 1) {
                        Spacer(Modifier.height(6.dp))
                        endpoints.forEach { endpoint ->
                            Text(
                                "${Endpoints.label(endpoint.kind)} · ${endpoint.url}",
                                style = MaterialTheme.typography.bodySmall,
                                color = TextMuted
                            )
                        }
                    }
                    TextButton(onClick = {
                        endpointError = null
                        endpointDialog = true
                    }) {
                        Icon(Icons.Outlined.Add, contentDescription = null, tint = Amber, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("添加备用地址", color = Amber)
                    }
                    Spacer(Modifier.height(8.dp))
                    InfoRow("当前线路", if (state.connected) state.routeLabel else "未连接")
                    InfoRow("设备 ID", host?.deviceId ?: "—")
                    InfoRow("桥接版本", host?.version ?: "—")
                    InfoRow("端口", (host?.port ?: 48123).toString())
                    InfoRow("在线客户端", (host?.clients ?: 0).toString())
                    InfoRow("此手机 ID", device?.id ?: "—")
                }

                SectionLabel("安全")
                Text(
                    "审批与提问会先发到已连接手机；手机离线或超时后自动回退桌面。完全访问预设下不会产生审批。",
                    style = MaterialTheme.typography.bodySmall,
                    color = TextMuted
                )

                SectionLabel("远程访问")
                Text(
                    "电脑端开启 Tailscale 后，插件会把 tailnet 地址一起广播给手机。手机离开同一局域网时会自动改走 Tailscale，回到局域网后自动切回直连；无需手动改地址。",
                    style = MaterialTheme.typography.bodySmall,
                    color = TextMuted
                )
                Text(
                    "两种用法：手机已装 Tailscale（系统 VPN）时直接使用；也可以打开下面的内嵌 Tailscale，由 App 自带节点，不依赖系统 VPN。",
                    style = MaterialTheme.typography.bodySmall,
                    color = TextMuted,
                    modifier = Modifier.padding(top = 6.dp)
                )

                SectionLabel("内嵌 Tailscale（实验室）")
                Row(
                    Modifier
                        .fillMaxWidth()
                        .background(SurfaceRaised, RoundedCornerShape(18.dp))
                        .padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(Modifier.weight(1f)) {
                        Text("随 App 启动", style = MaterialTheme.typography.titleMedium, color = TextPrimary)
                        Text(
                            embeddedStatus(ts.phase, ts.error),
                            style = MaterialTheme.typography.bodySmall,
                            color = when (ts.phase) {
                                EmbeddedTailscale.Phase.Error -> Danger
                                EmbeddedTailscale.Phase.Connected -> Amber
                                else -> TextMuted
                            }
                        )
                    }
                    Switch(
                        checked = ts.enabled,
                        onCheckedChange = { tailscale.setEnabled(it) }
                    )
                }
                Text(
                    "内嵌节点是 userspace 实现，只有本 App 的 DSH 流量走 tailnet；不会接管系统网络，也不影响其他 VPN。首次使用需要登录一次 tailnet（或填 auth key）。",
                    style = MaterialTheme.typography.bodySmall,
                    color = TextMuted,
                    modifier = Modifier.padding(top = 8.dp)
                )
                if (ts.phase == EmbeddedTailscale.Phase.NeedsLogin && !ts.authUrl.isNullOrBlank()) {
                    OutlinedButton(
                        onClick = {
                            runCatching {
                                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(ts.authUrl)))
                            }
                        },
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                        shape = RoundedCornerShape(14.dp)
                    ) { Text("打开 tailnet 登录页", color = Amber) }
                }
                TextButton(onClick = {
                    authKeyValue = tailscale.authKey()
                    authKeyDialog = true
                }) {
                    Text(if (tailscale.authKey().isBlank()) "填写 auth key（可选）" else "更换 auth key", color = Amber)
                }
                InfoRow("节点名", ts.hostname.ifBlank { "—" })

                SectionLabel("后台与通知")
                var notificationsOk by remember { mutableStateOf(Reliability.notificationsGranted(context)) }
                var batteryOk by remember { mutableStateOf(Reliability.batteryExempt(context)) }
                var keepAliveOn by remember { mutableStateOf(KeepAlive.enabled(context)) }
                val permissionLauncher = rememberLauncherForActivityResult(
                    ActivityResultContracts.RequestPermission()
                ) { notificationsOk = Reliability.notificationsGranted(context) }
                val lifecycleOwner = LocalLifecycleOwner.current
                DisposableEffect(lifecycleOwner) {
                    val observer = LifecycleEventObserver { _, event ->
                        if (event == Lifecycle.Event.ON_RESUME) {
                            notificationsOk = Reliability.notificationsGranted(context)
                            batteryOk = Reliability.batteryExempt(context)
                            keepAliveOn = KeepAlive.enabled(context)
                        }
                    }
                    lifecycleOwner.lifecycle.addObserver(observer)
                    onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
                }

                SettingRow(
                    title = "通知权限",
                    detail = if (notificationsOk) "已允许，审批与任务结束会提醒" else "未允许，锁屏时收不到任何提醒",
                    detailColor = if (notificationsOk) TextMuted else Danger
                ) {
                    if (!notificationsOk) {
                        TextButton(onClick = { permissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS) }) {
                            Text("去允许", color = Amber)
                        }
                    }
                }
                SettingRow(
                    title = "电池优化豁免",
                    detail = if (batteryOk) "已豁免，息屏后连接更稳" else "未豁免，深度休眠时连接可能被系统挂起",
                    detailColor = if (batteryOk) TextMuted else Danger
                ) {
                    if (!batteryOk) {
                        TextButton(onClick = { Reliability.openBatterySettings(context) }) {
                            Text("去设置", color = Amber)
                        }
                    }
                }
                Row(
                    Modifier
                        .fillMaxWidth()
                        .background(SurfaceRaised, RoundedCornerShape(18.dp))
                        .padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(Modifier.weight(1f)) {
                        Text("息屏保持连接", style = MaterialTheme.typography.titleMedium, color = TextPrimary)
                        Text(
                            "屏幕熄灭时持有唤醒锁，保持事件流不断开；会略微增加耗电",
                            style = MaterialTheme.typography.bodySmall,
                            color = TextMuted
                        )
                    }
                    Switch(
                        checked = keepAliveOn,
                        onCheckedChange = {
                            keepAliveOn = it
                            KeepAlive.setEnabled(context, it)
                        }
                    )
                }
                TextButton(onClick = { Alerts.test(context) }) {
                    Text("发送测试通知", color = Amber)
                }
                Text(
                    "任务结束或需要你审批、回答时会发通知；点通知直接回到对应任务。前台服务常驻通知栏是 Android 的硬性要求，可折叠但无法完全隐藏。",
                    style = MaterialTheme.typography.bodySmall,
                    color = TextMuted
                )
                Reliability.oemHint()?.let { hint ->
                    Text(
                        hint,
                        style = MaterialTheme.typography.bodySmall,
                        color = Amber,
                        modifier = Modifier.padding(top = 8.dp)
                    )
                }

                SectionLabel("关于")
                val update = state.update
                Row(
                    Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            "TS7 DSH Remote ${BuildConfig.VERSION_NAME}",
                            style = MaterialTheme.typography.bodyMedium,
                            color = TextPrimary
                        )
                        Text(
                            when {
                                update == null -> "还没查过 GitHub 上的最新版本"
                                update.error != null -> update.error
                                update.hasUpdate -> "有新版本 ${update.latest} · ${formatTime(update.checkedAt)} 查过"
                                else -> "已是最新版本 · ${formatTime(update.checkedAt)} 查过"
                            },
                            style = MaterialTheme.typography.bodySmall,
                            color = if (update?.hasUpdate == true) Amber else TextMuted,
                            modifier = Modifier.padding(top = 4.dp)
                        )
                    }
                    TextButton(onClick = onCheckUpdate, enabled = !state.updateChecking) {
                        Text(if (state.updateChecking) "检查中…" else "检查更新")
                    }
                }
                update?.takeIf { it.hasUpdate }?.let { latest ->
                    TextButton(onClick = {
                        runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(latest.url))) }
                    }) {
                        Text("去下载 ${latest.latest}", color = Amber)
                    }
                }
                Text(
                    "Android 客户端 · 通过局域网同时连接多台 DeepSeek Harness 主机",
                    style = MaterialTheme.typography.bodySmall,
                    color = TextMuted,
                    modifier = Modifier.padding(top = 4.dp)
                )
                Spacer(Modifier.height(40.dp))
            }
        }
    }

    forgetTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { forgetTarget = null },
            title = { Text("移除这台主机？") },
            text = { Text("将清除「${target.label}」在本机保存的 token，需要使用电脑设置页的配对码重新配对。") },
            confirmButton = {
                TextButton(onClick = {
                    forgetTarget = null
                    onForgetHost(target.id)
                }) { Text("移除", color = Danger) }
            },
            dismissButton = {
                TextButton(onClick = { forgetTarget = null }) { Text("取消") }
            },
            containerColor = SurfaceRaised
        )
    }

    if (endpointDialog) {
        AlertDialog(
            onDismissRequest = { endpointDialog = false },
            title = { Text("添加备用地址") },
            text = {
                Column {
                    Text(
                        "用于插件没有自动上报的线路，例如虚拟机端口转发到宿主机 Tailscale 的地址。保存后仍按局域网优先自动切换。",
                        style = MaterialTheme.typography.bodySmall,
                        color = TextMuted
                    )
                    Spacer(Modifier.height(10.dp))
                    OutlinedTextField(
                        value = endpointUrl,
                        onValueChange = { endpointUrl = it },
                        label = { Text("地址") },
                        placeholder = { Text("100.x.x.x:48125") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                        textStyle = MonoText
                    )
                    endpointError?.let { message ->
                        Spacer(Modifier.height(8.dp))
                        Text(message, style = MaterialTheme.typography.bodySmall, color = Danger)
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    val hostId = state.activeHost?.id ?: return@TextButton
                    val result = onAddEndpoint(hostId, endpointUrl)
                    if (result.isSuccess) {
                        endpointDialog = false
                        endpointUrl = ""
                        endpointError = null
                    } else {
                        endpointError = result.exceptionOrNull()?.message ?: "地址无效"
                    }
                }) { Text("添加", color = Amber) }
            },
            dismissButton = {
                TextButton(onClick = { endpointDialog = false }) { Text("取消") }
            },
            containerColor = SurfaceRaised
        )
    }

    if (authKeyDialog) {
        AlertDialog(
            onDismissRequest = { authKeyDialog = false },
            title = { Text("Tailscale auth key") },
            text = {
                Column {
                    Text(
                        "在 tailnet 管理页创建 auth key 后填入，可跳过每次登录。留空则使用网页登录。密钥只保存在本机。",
                        style = MaterialTheme.typography.bodySmall,
                        color = TextMuted
                    )
                    Spacer(Modifier.height(10.dp))
                    OutlinedTextField(
                        value = authKeyValue,
                        onValueChange = { authKeyValue = it },
                        label = { Text("tskey-auth-…") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                        textStyle = MonoText
                    )
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    authKeyDialog = false
                    tailscale.setAuthKey(authKeyValue)
                }) { Text("保存", color = Amber) }
            },
            dismissButton = {
                TextButton(onClick = { authKeyDialog = false }) { Text("取消") }
            },
            containerColor = SurfaceRaised
        )
    }
}

private fun embeddedStatus(phase: EmbeddedTailscale.Phase, error: String?): String = when (phase) {
    EmbeddedTailscale.Phase.Off -> "未启用；使用系统 Tailscale 或仅局域网"
    EmbeddedTailscale.Phase.Starting -> "正在启动节点…"
    EmbeddedTailscale.Phase.NeedsLogin -> "需要登录 tailnet"
    EmbeddedTailscale.Phase.Connected -> "已连接 tailnet"
    EmbeddedTailscale.Phase.Error -> error ?: "启动失败"
}

@Composable
private fun HostRow(
    host: HostSummary,
    onSelect: () -> Unit,
    onRetry: () -> Unit,
    onForget: () -> Unit
) {
    Row(
        Modifier
            .fillMaxWidth()
            .background(SurfaceRaised, RoundedCornerShape(18.dp))
            .clickable { onSelect() }
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        StatusDot(statusColor(host.connection), 8)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(host.label, style = MaterialTheme.typography.titleMedium, color = TextPrimary)
                if (host.active) {
                    Spacer(Modifier.width(8.dp))
                    Text("当前", style = MaterialTheme.typography.labelSmall, color = Amber)
                }
            }
            Text(
                "${host.baseUrl} · ${statusLabel(host.connection)}" +
                    if (host.connected) " · ${host.routeLabel}" else "",
                style = MonoText,
                color = TextMuted
            )
            if (host.pendingCount > 0) {
                Text("${host.pendingCount} 项待处理", style = MaterialTheme.typography.bodySmall, color = Amber)
            }
        }
        IconButton(onClick = onRetry) {
            Icon(Icons.Outlined.Refresh, contentDescription = "重连", tint = TextMuted, modifier = Modifier.size(20.dp))
        }
        IconButton(onClick = onForget) {
            Icon(Icons.Outlined.LinkOff, contentDescription = "移除", tint = Danger, modifier = Modifier.size(20.dp))
        }
    }
}

@Composable
private fun GroupCard(state: AppState, onLink: suspend () -> String?) {
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    val group: GroupInfo? = state.group
    val peers = group?.peers.orEmpty()
    val online = peers.count { it.status == "online" }

    Column(
        Modifier
            .fillMaxWidth()
            .background(SurfaceRaised, RoundedCornerShape(18.dp))
            .padding(16.dp)
    ) {
        Text("协作组", style = MaterialTheme.typography.titleMedium, color = TextPrimary)
        Text(
            when {
                group?.group == null -> "同一个手机绑定过的电脑可以互派任务：慢机器出需求，性能好的机器跑本地模型。"
                else -> "${group.group.name} · ${peers.size} 台已入组，${online} 台在线"
            },
            style = MaterialTheme.typography.bodySmall,
            color = TextMuted,
            modifier = Modifier.padding(top = 4.dp)
        )
        peers.forEach { peer ->
            Row(
                Modifier.fillMaxWidth().padding(top = 10.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                StatusDot(if (peer.status == "online") Amber else TextMuted, 8)
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        peer.name.ifBlank { peer.baseUrl },
                        style = MaterialTheme.typography.bodyMedium,
                        color = TextPrimary
                    )
                    Text(
                        peer.collabRoot?.takeIf { it.isNotBlank() }
                            ?: "${peer.baseUrl} · 未设置协作目录",
                        style = MonoText,
                        color = TextMuted
                    )
                }
            }
        }
        Spacer(Modifier.height(12.dp))
        OutlinedButton(
            onClick = {
                if (busy) return@OutlinedButton
                busy = true
                message = null
                scope.launch {
                    val result = runCatching { onLink() }.getOrElse { error ->
                        error.message?.takeIf { it.isNotBlank() } ?: "组队失败"
                    }
                    message = result ?: "已把 ${state.hosts.size} 台主机连成协作组"
                    busy = false
                }
            },
            enabled = !busy && state.hosts.size > 1,
            modifier = Modifier.fillMaxWidth().height(46.dp),
            shape = RoundedCornerShape(14.dp)
        ) {
            Text(
                when {
                    busy -> "正在组队…"
                    state.hosts.size <= 1 -> "先配对第二台电脑"
                    else -> "把已配对的主机连成协作组"
                },
                color = if (state.hosts.size > 1) Amber else TextMuted
            )
        }
        message?.let {
            Text(
                it,
                style = MaterialTheme.typography.bodySmall,
                color = if (it.startsWith("已")) TextMuted else Danger,
                modifier = Modifier.padding(top = 8.dp)
            )
        }
    }
}

private fun statusColor(state: ConnectionState) = when (state) {
    ConnectionState.Connected -> Amber
    ConnectionState.Connecting -> Amber
    ConnectionState.Error -> Danger
    ConnectionState.Disconnected -> TextMuted
}

private fun statusLabel(state: ConnectionState) = when (state) {
    ConnectionState.Connected -> "在线"
    ConnectionState.Connecting -> "连接中"
    ConnectionState.Error -> "连接失败"
    ConnectionState.Disconnected -> "离线"
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

@Composable
private fun SettingRow(
    title: String,
    detail: String,
    detailColor: Color,
    action: @Composable () -> Unit
) {
    Row(
        Modifier
            .fillMaxWidth()
            .background(SurfaceRaised, RoundedCornerShape(18.dp))
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleMedium, color = TextPrimary)
            Text(detail, style = MaterialTheme.typography.bodySmall, color = detailColor)
        }
        action()
    }
}
