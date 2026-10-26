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
import com.ts7.dshremote.data.DiscoveredHost
import com.ts7.dshremote.data.Discovery
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
fun ConnectScreen(repository: BridgeRepository, connection: com.ts7.dshremote.data.ConnectionState) {
    val scope = rememberCoroutineScope()
    var baseUrl by remember { mutableStateOf(repository.savedBaseUrl) }
    var code by remember { mutableStateOf("") }
    var scanning by remember { mutableStateOf(false) }
    var pairing by remember { mutableStateOf(false) }
    var hosts by remember { mutableStateOf<List<DiscoveredHost>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }

    suspend fun scan() {
        scanning = true
        error = null
        hosts = runCatching { Discovery.scan() }.getOrDefault(emptyList())
        scanning = false
    }

    LaunchedEffect(Unit) { scan() }

    Surface(color = Ink, modifier = Modifier.fillMaxSize()) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 22.dp, vertical = 28.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("TS7", style = MaterialTheme.typography.labelSmall, color = Amber, fontWeight = FontWeight.Bold)
                Spacer(Modifier.width(8.dp))
                Text("/ DSH REMOTE", style = MaterialTheme.typography.labelSmall, color = TextMuted)
                Spacer(Modifier.weight(1f))
                ConnectionPill(connection)
            }
            Spacer(Modifier.height(22.dp))
            Text("把桌面上的 DSH\n装进口袋", style = MaterialTheme.typography.displaySmall, color = TextPrimary)
            Spacer(Modifier.height(10.dp))
            Text(
                "与电脑处于同一局域网，配对后即可查看任务、批准权限、回答提问和接收完成通知。",
                style = MaterialTheme.typography.bodyMedium,
                color = TextMuted
            )

            SectionLabel("发现附近主机", if (scanning) "扫描中" else "同一 Wi-Fi")
            if (hosts.isEmpty()) {
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
                hosts.forEach { host ->
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .padding(vertical = 4.dp)
                            .clipCard()
                            .clickable { baseUrl = host.baseUrl }
                            .padding(14.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        StatusDot(Amber, 8)
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(host.label, style = MaterialTheme.typography.titleMedium, color = TextPrimary)
                            Text(host.baseUrl, style = MonoText, color = TextMuted)
                        }
                        Text("选择", style = MaterialTheme.typography.labelLarge, color = Amber)
                    }
                }
            }

            SectionLabel("手动连接")
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
                        repository.pair(baseUrl, code).onFailure { failure ->
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
                    Step("3", "保持同一 Wi-Fi，点按连接")
                }
            }
        }
    }
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
