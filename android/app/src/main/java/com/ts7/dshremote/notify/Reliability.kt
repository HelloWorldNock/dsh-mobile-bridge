package com.ts7.dshremote.notify

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings

/**
 * Device-level prerequisites for background delivery: the notification permission
 * (Android 13+) and the doze/battery optimisation exemption. Both are reported
 * honestly — when either is missing the app can still run, but the screen-off
 * connection will be killed by the system eventually.
 */
object Reliability {
    fun notificationsGranted(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < 33) return true
        return context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
    }

    fun batteryExempt(context: Context): Boolean {
        val power = context.getSystemService(PowerManager::class.java) ?: return false
        return power.isIgnoringBatteryOptimizations(context.packageName)
    }

    /**
     * Straight to the system's "allow this app to run in the background" prompt when
     * the platform supports it; the exemption list otherwise. Resolution via
     * `resolveActivity` is unreliable under package visibility rules and on OEM
     * ROMs, so the direct prompt is simply attempted first.
     */
    @SuppressLint("BatteryLife")
    fun openBatterySettings(context: Context): Boolean {
        val direct = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
            data = Uri.parse("package:${context.packageName}")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        if (runCatching { context.startActivity(direct) }.isSuccess) return true
        val list = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        return runCatching { context.startActivity(list) }.isSuccess
    }

    /** Best-effort UI automation hint: OEM task killers that ignore the exemption. */
    fun oemHint(): String? {
        val brand = Build.MANUFACTURER?.lowercase().orEmpty()
        return when {
            brand.contains("xiaomi") || brand.contains("redmi") ->
                "小米/Redmi：在「设置 → 应用设置 → 应用管理 → DSH Remote」中开启「自启动」，并把省电策略设为「无限制」。"
            brand.contains("huawei") || brand.contains("honor") ->
                "华为/荣耀：在「手机管家 → 应用启动管理」中把 DSH Remote 改为手动管理，允许后台活动。"
            brand.contains("oppo") || brand.contains("realme") || brand.contains("oneplus") ->
                "OPPO/一加/realme：在「设置 → 电池 → 应用耗电管理」中允许后台活动与自启动。"
            brand.contains("vivo") || brand.contains("iqoo") ->
                "vivo/iQOO：在「设置 → 电池 → 后台耗电管理」中允许后台高耗电，并在 i管家 中加入白名单。"
            brand.contains("samsung") ->
                "三星：在「设置 → 电池 → 后台使用限制」中把 DSH Remote 加入「永不休眠的应用」。"
            else -> null
        }
    }
}
