package com.ts7.dshremote.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AddPhotoAlternate
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.ts7.dshremote.data.ImagePayload
import com.ts7.dshremote.data.PromptImage
import com.ts7.dshremote.ui.theme.Amber
import com.ts7.dshremote.ui.theme.Ink
import com.ts7.dshremote.ui.theme.Outline
import com.ts7.dshremote.ui.theme.SurfaceRaised
import com.ts7.dshremote.ui.theme.TextMuted
import com.ts7.dshremote.ui.theme.TextPrimary
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun rememberImagePicker(
    onImages: (List<PromptImage>) -> Unit,
    onError: (String) -> Unit
): () -> Unit {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris ->
        if (uris.isNullOrEmpty()) return@rememberLauncherForActivityResult
        scope.launch {
            val result = withContext(Dispatchers.IO) {
                runCatching { ImagePayload.load(context, uris) }
            }
            result.onSuccess { images ->
                if (images.isEmpty()) onError("没有可用的图片") else onImages(images)
            }.onFailure { onError(it.message ?: "读取图片失败") }
        }
    }
    return remember(launcher) { { launcher.launch("image/*") } }
}

@Composable
fun AttachmentChips(
    images: List<PromptImage>,
    onRemove: (Int) -> Unit,
    modifier: Modifier = Modifier
) {
    if (images.isEmpty()) return
    Row(
        modifier
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 2.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        images.forEachIndexed { index, image ->
            Row(
                Modifier
                    .clip(RoundedCornerShape(12.dp))
                    .background(SurfaceRaised)
                    .padding(start = 10.dp, top = 4.dp, bottom = 4.dp, end = 2.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(Icons.Outlined.Image, contentDescription = null, tint = Amber, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(6.dp))
                Text(
                    image.name ?: "图片 ${index + 1}",
                    style = MaterialTheme.typography.labelMedium,
                    color = TextPrimary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.width(120.dp)
                )
                IconButton(onClick = { onRemove(index) }, modifier = Modifier.size(28.dp)) {
                    Icon(Icons.Outlined.Close, contentDescription = "移除图片", tint = TextMuted, modifier = Modifier.size(15.dp))
                }
            }
        }
    }
}

@Composable
fun AttachImageButton(
    onClick: () -> Unit,
    enabled: Boolean,
    modifier: Modifier = Modifier
) {
    IconButton(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier
            .size(44.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(if (enabled) Ink else Outline.copy(alpha = 0.4f))
    ) {
        Icon(
            Icons.Outlined.AddPhotoAlternate,
            contentDescription = "添加图片",
            tint = if (enabled) Amber else TextMuted
        )
    }
}

@Composable
fun ImageCountBadge(count: Int) {
    if (count <= 0) return
    Box(
        Modifier
            .clip(RoundedCornerShape(8.dp))
            .background(Amber.copy(alpha = 0.12f))
            .padding(horizontal = 6.dp, vertical = 2.dp)
    ) {
        Text("$count/${ImagePayload.MAX_IMAGES}", style = MaterialTheme.typography.labelSmall, color = Amber)
    }
}
