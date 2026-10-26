package com.ts7.dshremote.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

private val DshColors = lightColorScheme(
    primary = Amber,
    onPrimary = OnAmber,
    primaryContainer = BrandPale,
    onPrimaryContainer = TextPrimary,
    secondary = Info,
    onSecondary = OnAmber,
    tertiary = Success,
    onTertiary = OnAmber,
    background = Ink,
    onBackground = TextPrimary,
    surface = Surface,
    onSurface = TextPrimary,
    surfaceVariant = SurfaceRaised,
    onSurfaceVariant = TextMuted,
    outline = Outline,
    outlineVariant = Color(0xFFE7ECF3),
    error = Danger,
    onError = OnAmber,
    inverseSurface = TextPrimary,
    inverseOnSurface = Surface
)

private val DshShapes = Shapes(
    extraSmall = RoundedCornerShape(8.dp),
    small = RoundedCornerShape(12.dp),
    medium = RoundedCornerShape(16.dp),
    large = RoundedCornerShape(20.dp),
    extraLarge = RoundedCornerShape(28.dp)
)

@Composable
fun DshTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = DshColors,
        typography = AppTypography,
        shapes = DshShapes,
        content = content
    )
}
