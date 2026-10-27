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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowBack
import androidx.compose.material.icons.outlined.FolderOpen
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
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
import androidx.compose.ui.unit.dp
import com.ts7.dshremote.data.AppState
import com.ts7.dshremote.data.BridgeRepository
import com.ts7.dshremote.ui.SectionLabel
import com.ts7.dshremote.ui.baseName
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
fun NewTaskScreen(
    repository: BridgeRepository,
    state: AppState,
    onBack: () -> Unit,
    onCreated: (String) -> Unit
) {
    val scope = rememberCoroutineScope()
    var prompt by remember { mutableStateOf("") }
    var plan by remember { mutableStateOf(true) }
    var permission by remember { mutableStateOf("workspace-write") }
    var workspaceId by remember { mutableStateOf(state.workspaces.firstOrNull()?.id) }
    var creating by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var images by remember { mutableStateOf<List<com.ts7.dshremote.data.PromptImage>>(emptyList()) }
    var imageError by remember { mutableStateOf<String?>(null) }
    val pickImages = com.ts7.dshremote.ui.rememberImagePicker(
        onImages = { picked ->
            images = (images + picked).take(com.ts7.dshremote.data.ImagePayload.MAX_IMAGES)
            imageError = null
        },
        onError = { imageError = it }
    )

    LaunchedEffect(Unit) { repository.refreshCatalog() }

    LaunchedEffect(state.workspaces) {
        if (workspaceId == null) workspaceId = state.workspaces.firstOrNull()?.id
    }

    val presets = state.presets.options.ifEmpty {
        listOf(
            com.ts7.dshremote.data.PresetOption("read-only", "只读", "不写入，最安全"),
            com.ts7.dshremote.data.PresetOption("workspace-write", "工作区写入", "写入工作区时审批"),
            com.ts7.dshremote.data.PresetOption("danger-full-access", "完全访问", "不再询问")
        )
    }

    Surface(color = Ink, modifier = Modifier.fillMaxSize()) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 18.dp)
        ) {
            Row(
                Modifier.fillMaxWidth().padding(vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                IconButton(onClick = onBack) {
                    Icon(Icons.Outlined.ArrowBack, contentDescription = "返回", tint = TextPrimary)
                }
                Column(Modifier.weight(1f)) {
                    Text("新建任务", style = MaterialTheme.typography.titleLarge, color = TextPrimary)
                    Text("在电脑的工作区里启动一轮 DSH", style = MaterialTheme.typography.bodySmall, color = TextMuted)
                }
            }

            SectionLabel("工作区")
            if (state.workspaces.isEmpty()) {
                Text("没有可用工作区，请先在电脑端打开一个目录。", style = MaterialTheme.typography.bodyMedium, color = TextMuted)
            } else {
                state.workspaces.forEach { workspace ->
                    val selected = workspace.id == workspaceId
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .padding(vertical = 3.dp)
                            .background(if (selected) Color(0xFFE8EDFF) else SurfaceRaised, RoundedCornerShape(14.dp))
                            .border(1.dp, if (selected) Amber.copy(alpha = 0.5f) else Outline, RoundedCornerShape(14.dp))
                            .clickable { workspaceId = workspace.id }
                            .padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(Icons.Outlined.FolderOpen, contentDescription = null, tint = if (selected) Amber else TextMuted)
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Text(
                                workspace.title?.takeIf { it.isNotBlank() } ?: baseName(workspace.path),
                                style = MaterialTheme.typography.titleMedium,
                                color = TextPrimary
                            )
                            Text(workspace.path, style = MonoText, color = TextMuted, maxLines = 1)
                        }
                    }
                }
            }

            SectionLabel("任务内容")
            OutlinedTextField(
                value = prompt,
                onValueChange = { prompt = it },
                placeholder = { Text("例如：审查 auth 模块并补上过期测试") },
                modifier = Modifier.fillMaxWidth().height(150.dp),
                textStyle = MaterialTheme.typography.bodyLarge,
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

            Row(
                Modifier.fillMaxWidth().padding(top = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                com.ts7.dshremote.ui.AttachImageButton(
                    onClick = {
                        imageError = null
                        pickImages()
                    },
                    enabled = images.size < com.ts7.dshremote.data.ImagePayload.MAX_IMAGES && !creating
                )
                Spacer(Modifier.width(8.dp))
                com.ts7.dshremote.ui.ImageCountBadge(images.size)
                Spacer(Modifier.weight(1f))
                imageError?.let {
                    Text(it, style = MaterialTheme.typography.labelSmall, color = Danger)
                }
            }
            if (images.isNotEmpty()) {
                com.ts7.dshremote.ui.AttachmentChips(
                    images = images,
                    onRemove = { index -> images = images.filterIndexed { i, _ -> i != index } },
                    modifier = Modifier.padding(top = 6.dp)
                )
            }

            SectionLabel("执行方式")
            Row(
                Modifier
                    .fillMaxWidth()
                    .background(SurfaceRaised, RoundedCornerShape(16.dp))
                    .padding(14.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(Modifier.weight(1f)) {
                    Text("计划模式", style = MaterialTheme.typography.titleMedium, color = TextPrimary)
                    Text("先审阅计划，批准后再执行", style = MaterialTheme.typography.bodySmall, color = TextMuted)
                }
                Switch(
                    checked = plan,
                    onCheckedChange = { plan = it },
                    colors = SwitchDefaults.colors(checkedThumbColor = Ink, checkedTrackColor = Amber)
                )
            }

            SectionLabel("权限")
            presets.forEach { option ->
                val selected = option.value == permission
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(vertical = 3.dp)
                        .background(if (selected) Color(0xFFF0F4FF) else SurfaceRaised, RoundedCornerShape(12.dp))
                        .border(1.dp, if (selected) Amber.copy(alpha = 0.4f) else Outline, RoundedCornerShape(12.dp))
                        .clickable { permission = option.value }
                        .padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(option.name ?: option.value, style = MaterialTheme.typography.titleMedium, color = TextPrimary)
                        if (!option.description.isNullOrBlank()) {
                            Text(option.description, style = MaterialTheme.typography.bodySmall, color = TextMuted)
                        }
                    }
                    if (selected) Text("已选", style = MaterialTheme.typography.labelSmall, color = Amber)
                }
            }
            if (permission == "danger-full-access") {
                Text(
                    "完全访问不会询问审批，适合临时任务；结束之后建议切回工作区写入。",
                    style = MaterialTheme.typography.bodySmall,
                    color = Danger,
                    modifier = Modifier.padding(top = 8.dp)
                )
            }

            if (error != null) {
                Text(error!!, style = MaterialTheme.typography.bodySmall, color = Danger, modifier = Modifier.padding(top = 10.dp))
            }

            Spacer(Modifier.height(18.dp))
            Button(
                onClick = {
                    val target = workspaceId
                    if (target == null) {
                        error = "请选择工作区"
                        return@Button
                    }
                    if (prompt.isBlank() && images.isEmpty()) {
                        error = "请输入任务内容或添加图片"
                        return@Button
                    }
                    scope.launch {
                        creating = true
                        error = null
                        repository.createSession(target, null, prompt, plan, permission, images)
                            .onSuccess { id -> onCreated(id) }
                            .onFailure { failure -> error = failure.message ?: "创建失败" }
                        creating = false
                    }
                },
                enabled = !creating,
                modifier = Modifier.fillMaxWidth().height(54.dp),
                shape = RoundedCornerShape(14.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Amber, contentColor = Color(0xFFFFFFFF))
            ) { Text(if (creating) "正在创建…" else "创建并开始", style = MaterialTheme.typography.titleMedium) }
            Spacer(Modifier.height(30.dp))
        }
    }
}
