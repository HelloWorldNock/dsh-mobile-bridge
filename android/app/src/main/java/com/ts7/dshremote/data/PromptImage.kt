package com.ts7.dshremote.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import kotlinx.serialization.Serializable

@Serializable
data class PromptImage(
    val data: String,
    val mediaType: String = "image/jpeg",
    val name: String? = null
)

/**
 * Turns content:// images into the compact base64 payload the bridge accepts.
 * The bridge validates and forwards the parts; this only keeps phone uploads small.
 */
object ImagePayload {
    const val MAX_IMAGES = 4
    const val MAX_LONG_EDGE = 1_600
    const val MAX_BYTES = 3_500_000

    fun load(context: Context, uris: List<Uri>): List<PromptImage> =
        uris.take(MAX_IMAGES).mapNotNull { uri ->
            runCatching { loadOne(context, uri) }.getOrNull()
        }

    private fun loadOne(context: Context, uri: Uri): PromptImage {
        val resolver = context.contentResolver
        val source = resolver.openInputStream(uri)?.use { it.readBytes() }
            ?: error("无法读取图片")
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(source, 0, source.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) error("不支持的图片格式")

        var sample = 1
        while (maxOf(bounds.outWidth / sample, bounds.outHeight / sample) > MAX_LONG_EDGE * 2) {
            sample *= 2
        }
        val decoded = BitmapFactory.decodeByteArray(
            source,
            0,
            source.size,
            BitmapFactory.Options().apply { inSampleSize = sample }
        ) ?: error("无法解码图片")

        val rotated = rotate(decoded, orientation(source))
        val scaled = scaleDown(rotated)
        val encoded = compress(scaled)
        scaled.recycle()

        val name = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
            ?.use { cursor ->
                if (cursor.moveToFirst()) cursor.getString(0) else null
            }
            ?.takeIf { it.isNotBlank() }
            ?: "image-${System.currentTimeMillis()}.jpg"

        return PromptImage(
            data = Base64.encodeToString(encoded, Base64.NO_WRAP),
            mediaType = "image/jpeg",
            name = name.take(120)
        )
    }

    private fun orientation(bytes: ByteArray): Int = runCatching {
        val exif = ExifInterface(ByteArrayInputStream(bytes))
        exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
    }.getOrDefault(ExifInterface.ORIENTATION_NORMAL)

    private fun rotate(bitmap: Bitmap, orientation: Int): Bitmap {
        val degrees = when (orientation) {
            ExifInterface.ORIENTATION_ROTATE_90 -> 90f
            ExifInterface.ORIENTATION_ROTATE_180 -> 180f
            ExifInterface.ORIENTATION_ROTATE_270 -> 270f
            else -> 0f
        }
        if (degrees == 0f) return bitmap
        val matrix = Matrix().apply { postRotate(degrees) }
        val result = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
        if (result !== bitmap) bitmap.recycle()
        return result
    }

    private fun scaleDown(bitmap: Bitmap): Bitmap {
        val longEdge = maxOf(bitmap.width, bitmap.height)
        if (longEdge <= MAX_LONG_EDGE) return bitmap
        val ratio = MAX_LONG_EDGE.toFloat() / longEdge
        val result = Bitmap.createScaledBitmap(
            bitmap,
            (bitmap.width * ratio).toInt().coerceAtLeast(1),
            (bitmap.height * ratio).toInt().coerceAtLeast(1),
            true
        )
        if (result !== bitmap) bitmap.recycle()
        return result
    }

    private fun compress(bitmap: Bitmap): ByteArray {
        var quality = 88
        while (true) {
            val out = ByteArrayOutputStream()
            bitmap.compress(Bitmap.CompressFormat.JPEG, quality, out)
            val bytes = out.toByteArray()
            if (bytes.size <= MAX_BYTES || quality <= 45) return bytes
            quality -= 12
        }
    }
}
