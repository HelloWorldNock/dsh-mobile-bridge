package com.ts7.dshremote.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material.icons.outlined.Terminal
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.ts7.dshremote.data.AnswerItem
import com.ts7.dshremote.data.PendingApproval
import com.ts7.dshremote.data.PendingQuestion
import com.ts7.dshremote.data.Question
import com.ts7.dshremote.ui.theme.Amber
import com.ts7.dshremote.ui.theme.Danger
import com.ts7.dshremote.ui.theme.Ink
import com.ts7.dshremote.ui.theme.MonoText
import com.ts7.dshremote.ui.theme.Outline
import com.ts7.dshremote.ui.theme.Success
import com.ts7.dshremote.ui.theme.SurfaceRaised
import com.ts7.dshremote.ui.theme.TextMuted
import com.ts7.dshremote.ui.theme.TextPrimary
import java.util.Locale

fun remainingText(expiresAt: Long?, now: Long = System.currentTimeMillis()): String {
    if (expiresAt == null) return ""
    val seconds = ((expiresAt - now) / 1000).coerceAtLeast(0)
    return if (seconds >= 60) "${seconds / 60} 分 ${seconds % 60} 秒后回退桌面" else "${seconds} 秒后回退桌面"
}

@Composable
fun CountdownText(expiresAt: Long?) {
    if (expiresAt == null) return
    var now by remember(expiresAt) { mutableStateOf(System.currentTimeMillis()) }
    LaunchedEffect(expiresAt) {
        while (true) {
            kotlinx.coroutines.delay(1000)
            now = System.currentTimeMillis()
        }
    }
    Text(remainingText(expiresAt, now), style = MaterialTheme.typography.labelSmall, color = TextMuted)
}

@Composable
fun ApprovalCard(
    approval: PendingApproval,
    onResolve: (String) -> Unit,
    busy: Boolean = false
) {
    Surface(
        color = Color(0xFFF0F4FF),
        shape = RoundedCornerShape(20.dp),
        modifier = Modifier
            .fillMaxWidth()
            .border(1.dp, Amber.copy(alpha = 0.5f), RoundedCornerShape(20.dp))
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.Shield, contentDescription = null, tint = Amber, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text("权限审批", style = MaterialTheme.typography.labelSmall, color = Amber)
                Spacer(Modifier.weight(1f))
                Text("ALLOW-ONCE", style = MaterialTheme.typography.labelSmall, color = TextMuted)
            }
            Spacer(Modifier.height(10.dp))
            Text(approval.toolName, style = MaterialTheme.typography.titleLarge, color = TextPrimary)
            if (!approval.displayReason.isNullOrBlank() || !approval.reason.isNullOrBlank()) {
                Spacer(Modifier.height(4.dp))
                Text(
                    approval.displayReason ?: approval.reason ?: "",
                    style = MaterialTheme.typography.bodySmall,
                    color = TextMuted
                )
            }
            val preview = approval.preview?.preview
            if (!preview.isNullOrBlank()) {
                Spacer(Modifier.height(12.dp))
                Row(
                    Modifier
                        .fillMaxWidth()
                        .background(Ink, RoundedCornerShape(12.dp))
                        .padding(12.dp),
                    verticalAlignment = Alignment.Top
                ) {
                    Icon(Icons.Outlined.Terminal, contentDescription = null, tint = TextMuted, modifier = Modifier.size(15.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(preview, style = MonoText, color = TextPrimary, maxLines = 8)
                }
            }
            Spacer(Modifier.height(10.dp))
            CountdownText(approval.expiresAt)
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedButton(
                    onClick = { onResolve("reject") },
                    enabled = !busy,
                    modifier = Modifier.weight(1f),
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = Danger)
                ) { Text("拒绝") }
                Button(
                    onClick = { onResolve("allow-once") },
                    enabled = !busy,
                    modifier = Modifier.weight(1f),
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Amber, contentColor = Color(0xFFFFFFFF))
                ) {
                    Icon(Icons.Outlined.CheckCircle, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("允许一次")
                }
            }
        }
    }
}

@Composable
fun QuestionCard(
    pending: PendingQuestion,
    onSubmit: (List<AnswerItem>) -> Unit,
    busy: Boolean = false
) {
    val selections = remember(pending.id) { mutableStateOf<Map<String, Set<String>>>(emptyMap()) }
    val customs = remember(pending.id) { mutableStateOf<Map<String, String>>(emptyMap()) }

    Surface(
        color = SurfaceRaised,
        shape = RoundedCornerShape(20.dp),
        modifier = Modifier
            .fillMaxWidth()
            .border(1.dp, Outline, RoundedCornerShape(20.dp))
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    if (pending.planReview) "计划审阅" else "需要你的选择",
                    style = MaterialTheme.typography.labelSmall,
                    color = if (pending.planReview) Amber else TextMuted
                )
                Spacer(Modifier.weight(1f))
                Text("${pending.questions.size} 个问题", style = MaterialTheme.typography.labelSmall, color = TextMuted)
            }
            if (!pending.plan.isNullOrBlank()) {
                Spacer(Modifier.height(10.dp))
                Column(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(max = 260.dp)
                        .background(Ink, RoundedCornerShape(12.dp))
                        .padding(12.dp)
                        .verticalScroll(rememberScrollState())
                ) {
                    Text(pending.plan, style = MonoText, color = TextPrimary)
                }
            }
            pending.questions.forEach { question ->
                Spacer(Modifier.height(14.dp))
                Text(question.question, style = MaterialTheme.typography.titleMedium, color = TextPrimary)
                if (!question.detail.isNullOrBlank() && !pending.planReview) {
                    Spacer(Modifier.height(4.dp))
                    Text(question.detail, style = MaterialTheme.typography.bodySmall, color = TextMuted)
                }
                Spacer(Modifier.height(6.dp))
                if (question.options.isEmpty()) {
                    OutlinedTextField(
                        value = customs.value[question.id].orEmpty(),
                        onValueChange = { value -> customs.value = customs.value + (question.id to value) },
                        placeholder = { Text("输入回答") },
                        modifier = Modifier.fillMaxWidth(),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = Amber,
                            unfocusedBorderColor = Outline,
                            focusedContainerColor = Ink,
                            unfocusedContainerColor = Ink,
                            focusedTextColor = TextPrimary,
                            unfocusedTextColor = TextPrimary
                        )
                    )
                } else {
                    question.options.forEach { option ->
                        val selected = selections.value[question.id].orEmpty().contains(option.label)
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .clickable {
                                    val current = selections.value[question.id].orEmpty()
                                    val next = if (question.multiSelect) {
                                        if (selected) current - option.label else current + option.label
                                    } else {
                                        setOf(option.label)
                                    }
                                    selections.value = selections.value + (question.id to next)
                                }
                                .padding(vertical = 3.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            if (question.multiSelect) {
                                Checkbox(
                                    checked = selected,
                                    onCheckedChange = null,
                                    colors = CheckboxDefaults.colors(checkedColor = Amber, uncheckedColor = Outline)
                                )
                            } else {
                                RadioButton(
                                    selected = selected,
                                    onClick = null,
                                    colors = RadioButtonDefaults.colors(selectedColor = Amber, unselectedColor = Outline)
                                )
                            }
                            Spacer(Modifier.width(4.dp))
                            Column {
                                Text(option.label, style = MaterialTheme.typography.bodyMedium, color = TextPrimary)
                                if (!option.description.isNullOrBlank()) {
                                    Text(option.description, style = MaterialTheme.typography.bodySmall, color = TextMuted)
                                }
                            }
                        }
                    }
                }
            }
            Spacer(Modifier.height(14.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                CountdownText(pending.expiresAt)
                Spacer(Modifier.weight(1f))
                Button(
                    onClick = {
                        val answers = pending.questions.map { question ->
                            AnswerItem(
                                id = question.id,
                                selected = selections.value[question.id].orEmpty().toList(),
                                custom = customs.value[question.id]?.takeIf { it.isNotBlank() }
                            )
                        }
                        onSubmit(answers)
                    },
                    enabled = !busy && pending.questions.all { question ->
                        selections.value[question.id].orEmpty().isNotEmpty() ||
                            !customs.value[question.id].isNullOrBlank()
                    },
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Amber, contentColor = Color(0xFFFFFFFF))
                ) { Text(if (pending.planReview) "提交决定" else "提交回答") }
            }
        }
    }
}

@Composable
fun AnswerSummary(text: String) {
    Text(text, style = MaterialTheme.typography.bodySmall, color = Success)
}

fun questionLabel(question: Question): String =
    question.header?.takeIf { it.isNotBlank() } ?: question.question.take(40).replace('\n', ' ')

fun percentOrDash(value: Int, total: Int): String =
    if (total <= 0) "—" else String.format(Locale.US, "%d%%", value * 100 / total)
