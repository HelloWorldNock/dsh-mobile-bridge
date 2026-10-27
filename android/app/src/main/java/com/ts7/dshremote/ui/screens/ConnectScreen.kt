package com.ts7.dshremote.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Wifi
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.ts7.dshremote.data.BridgeRepository
import com.ts7.dshremote.data.ConnectionState
import com.ts7.dshremote.data.DiscoveredHost
import com.ts7.dshremote.data.Discovery
import com.ts7.dshremote.data.HostStore
import com.ts7.dshremote.data.HostSummary
import com.ts7.dshremote.data.normalizeBaseUrl
import com.ts7.dshremote.ui.ConnectionPill
import com.ts7.dshremote.ui.SectionLabel
import com.ts7.dshremote.ui.StatusDot
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
fun ConnectScreen(
    repository: BridgeRepository,
    hosts: List<HostSummary>,
    onConnected: () -> Unit,
    onBack: () -> Unit
) {
    val scope = rememberCoroutineScope()
    var baseUrl by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var scanning by remember { mutableStateOf(false) }
    var pairing by remember { mutableStateOf(false) }
    var discovered by remember { mutableStateOf<List<DiscoveredHost>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }

    suspend fun scan() {
        scanning = true
        error = null
        discovered = runCatching { Discovery.scan() }.getOrDefault(emptyList())
        scanning = false
    }

    LaunchedEffect(Unit) { scan() }

    fun matchingHost(host: DiscoveredHost): HostSummary? {
        val base = normalizeBaseUrl(host.baseUrl)
        return hosts.firstOrNull { normalizeBaseUrl(it.baseUrl) == base }
            ?: hosts.firstOrNull {
                host.deviceId != null &&
                    it.deviceId == host.deviceId &&
                    HostStore.portOf(it.baseUrl) == HostStore.portOf(base)
            }
    }
    fun isPaired(host: DiscoveredHost): Boolean = matchingHost(host) != null

    Surface(color = Ink, modifier = Modifier.fillMaxSize()) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 22.dp, vertical = 20.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "返回", tint = TextMuted)
                }
                Text("TS7", style = MaterialTheme.typography.labelSmall, color = Amber, fontWeight = FontWeight.Bold)
                Spacer(Modifier.width(8.dp))
                Text("/ DSH REMOTE", style = MaterialTheme.typography.labelSmall, color = TextMuted)
                Spacer(Modifier.weight(1f))
                ConnectionPill(
                    if (hosts.any { it.connected }) ConnectionState.Connected else ConnectionState.Disconnected
                )
            }
            Spacer(Modifier.height(18.dp))
            Text("多台电脑，\n一个口袋", style = MaterialTheme.typography.displaySmall, color = TextPrimary)
            Spacer(Modifier.height(10.dp))
            Text(
                "在同一局域网内配对安装了 DSH 插件的电脑。手机可同时连接多台，并在离开局域网后自动改走 Tailscale（需要手机和电脑登录同一个 tailnet）。",
                style = MaterialTheme.typography.bodyMedium,
                color = TextMuted
            )

            if (hosts.isNotEmpty()) {
                SectionLabel("已配对", "${hosts.size} 台")
                hosts.forEach { host ->
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .padding(vertical = 4.dp)
                            .clipCard()
                            .clickable {
                                repository.selectHost(host.id)
                                onConnected()
                            }
                            .padding(14.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        StatusDot(connectionColor(host.connection), 8)
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(
                                    host.label,
                                    style = MaterialTheme.typography.titleMedium,
                                    color = TextPrimary
                                )
                                if (host.active) {
                                    Spacer(Modifier.width(8.dp))
                                    Text("当前", style = MaterialTheme.typography.labelSmall, color = Amber)
                                }
                            }
                            Text(
                                "${host.baseUrl} · ${connectionLabel(host.connection)}",
                                style = MonoText,
                                color = TextMuted
                            )
                        }
                        Text(
                            if (host.active) "进入" else "使用",
                            style = MaterialTheme.typography.labelLarge,
                            color = Amber
                        )
                    }
                }
            }

            SectionLabel("发现附近主机", if (scanning) "扫描中" else "同一 Wi-Fi")
            if (discovered.isEmpty()) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clipCard()
                        .clickable { scope.launch { scan() } }
                        .padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(Icons.Outlined.Wifi, contentDescription = null, tint = TextMuted)
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text("未发现主机", style = MaterialTheme.typography.titleMedium, color = TextPrimary)
                        Text("确认电脑端桥接已启动，并允许防火墙访问", style = MaterialTheme.typography.bodySmall, color = TextMuted)
                    }
                    if (scanning) CircularProgressIndicator(Modifier.size(18.dp), color = Amber, strokeWidth = 2.dp)
                    else IconButton(onClick = { scope.launch { scan() } }) {
                        Icon(Icons.Outlined.Refresh, contentDescription = "重新扫描", tint = Amber)
                    }
                }
            } else {
                discovered.forEach { host ->
                    val paired = isPaired(host)
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .padding(vertical = 4.dp)
                            .clipCard()
                            .clickable {
                                if (paired) {
                                    matchingHost(host)?.let { existing ->
                                        repository.selectHost(existing.id)
                                        onConnected()
                                    }
                                } else {
                                    baseUrl = host.baseUrl
                                }
                            }
                            .padding(14.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        StatusDot(if (paired) TextMuted else Amber, 8)
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(host.label, style = MaterialTheme.typography.titleMedium, color = TextPrimary)
                                if (paired) {
                                    Spacer(Modifier.width(8.dp))
                                    Text("已配对", style = MaterialTheme.typography.labelSmall, color = TextMuted)
                                }
                                host.routeLabel?.let { route ->
                                    Spacer(Modifier.width(8.dp))
                                    Text(route, style = MaterialTheme.typography.labelSmall, color = Amber)
                                }
                            }
                            Text(host.baseUrl, style = MonoText, color = TextMuted)
                        }
                        Text(
                            if (paired) "使用" else "选择",
                            style = MaterialTheme.typography.labelLarge,
                            color = if (paired) TextMuted else Amber
                        )
                    }
                }
            }

            SectionLabel("添加新主机")
            OutlinedTextField(
                value = baseUrl,
                onValueChange = { baseUrl = it },
                label = { Text("主机地址") },
                placeholder = { Text("192.0.2.10:48123") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                textStyle = MonoText,
                colors = fieldColors()
            )
            Text(
                "外网配对时填电脑的 Tailscale 地址，例如 100.x.x.x:48123。",
                style = MaterialTheme.typography.bodySmall,
                color = TextMuted,
                modifier = Modifier.padding(top = 6.dp, start = 2.dp)
            )
            Spacer(Modifier.height(10.dp))
            OutlinedTextField(
                value = code,
                onValueChange = { value -> code = value.filter { it.isDigit() }.take(6) },
                label = { Text("6 位配对码") },
                placeholder = { Text("在电脑设置页查看") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Done),
                modifier = Modifier.fillMaxWidth(),
                textStyle = MonoText.copy(letterSpacing = MaterialTheme.typography.titleLarge.letterSpacing),
                colors = fieldColors()
            )

            if (error != null) {
                Spacer(Modifier.height(10.dp))
                Text(error!!, style = MaterialTheme.typography.bodySmall, color = Danger)
            }

            Spacer(Modifier.height(16.dp))
            Button(
                onClick = {
                    if (baseUrl.isBlank() || code.length != 6) {
                        error = "请输入主机地址和 6 位配对码"
                        return@Button
                    }
                    scope.launch {
                        pairing = true
                        error = null
                        val known = discovered.firstOrNull {
                            normalizeBaseUrl(it.baseUrl) == normalizeBaseUrl(baseUrl)
                        }
                        repository.pair(
                            baseUrl = baseUrl,
                            code = code,
                            knownHostName = known?.hostName,
                            knownDeviceId = known?.deviceId
                        ).onSuccess {
                            code = ""
                            onConnected()
                        }.onFailure { failure ->
                            error = failure.message ?: "配对失败"
                        }
                        pairing = false
                    }
                },
                enabled = !pairing,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(54.dp),
                shape = RoundedCornerShape(14.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Amber, contentColor = Color(0xFFFFFFFF))
            ) {
                if (pairing) {
                    CircularProgressIndicator(Modifier.size(18.dp), color = Color(0xFFFFFFFF), strokeWidth = 2.dp)
                    Spacer(Modifier.width(10.dp))
                }
                Text(if (pairing) "正在配对…" else "连接并配对", style = MaterialTheme.typography.titleMedium)
            }

            Spacer(Modifier.height(22.dp))
            Surface(color = SurfaceRaised, shape = RoundedCornerShape(18.dp)) {
                Column(Modifier.padding(16.dp)) {
                    Text("配对步骤", style = MaterialTheme.typography.titleMedium, color = TextPrimary)
                    Spacer(Modifier.height(8.dp))
                    Step("1", "在电脑端 DSH 打开手机远控设置页")
                    Step("2", "输入设置页显示的 6 位配对码")
                    Step("3", "对每台电脑重复一次，即可同时连接")
                }
            }
        }
    }
}

private fun connectionColor(state: ConnectionState) = when (state) {
    ConnectionState.Connected -> Amber
    ConnectionState.Connecting -> Amber
    ConnectionState.Error -> Danger
    ConnectionState.Disconnected -> TextMuted
}

private fun connectionLabel(state: ConnectionState) = when (state) {
    ConnectionState.Connected -> "在线"
    ConnectionState.Connecting -> "连接中"
    ConnectionState.Error -> "连接失败"
    ConnectionState.Disconnected -> "离线"
}

@Composable
private fun Step(index: String, text: String) {
    Row(Modifier.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(
            index,
            style = MaterialTheme.typography.labelSmall,
            color = Amber,
            modifier = Modifier
                .size(22.dp)
                .background(Amber.copy(alpha = 0.12f), RoundedCornerShape(7.dp))
                .padding(top = 4.dp),
            textAlign = androidx.compose.ui.text.style.TextAlign.Center
        )
        Spacer(Modifier.width(10.dp))
        Text(text, style = MaterialTheme.typography.bodyMedium, color = TextMuted)
    }
}

@Composable
private fun fieldColors() = OutlinedTextFieldDefaults.colors(
    focusedBorderColor = Amber,
    unfocusedBorderColor = Outline,
    focusedContainerColor = SurfaceRaised,
    unfocusedContainerColor = SurfaceRaised,
    cursorColor = Amber,
    focusedTextColor = TextPrimary,
    unfocusedTextColor = TextPrimary,
    focusedLabelColor = Amber,
    unfocusedLabelColor = TextMuted
)

private fun Modifier.clipCard(): Modifier = this
    .border(1.dp, Outline, RoundedCornerShape(18.dp))
    .background(SurfaceRaised, RoundedCornerShape(18.dp))
