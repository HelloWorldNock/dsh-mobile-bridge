package com.ts7.dshremote.data

import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.channelFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

class ApiException(
    val code: String,
    override val message: String,
    val status: Int = 0
) : IOException(message)

object JsonConfig {
    val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        encodeDefaults = true
        isLenient = true
    }
}

fun normalizeBaseUrl(raw: String): String {
    var value = raw.trim()
    if (value.isEmpty()) return value
    if (!value.startsWith("http://") && !value.startsWith("https://")) value = "http://$value"
    while (value.endsWith("/")) value = value.dropLast(1)
    return value
}

class BridgeClient(
    rawBaseUrl: String,
    private val token: String = ""
) {
    val baseUrl: String = normalizeBaseUrl(rawBaseUrl)

    private val client = OkHttpClient.Builder()
        .connectTimeout(6, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .writeTimeout(20, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    private val jsonType = "application/json; charset=utf-8".toMediaType()
    private val json = JsonConfig.json

    suspend fun info(): BridgeInfo = decode(request("GET", "/api/info"))

    suspend fun workspaces(): List<Workspace> = decode<WorkspaceList>(request("GET", "/api/workspaces")).workspaces

    suspend fun sessions(query: String = ""): List<SessionSummary> {
        val suffix = if (query.isBlank()) "" else "?q=${java.net.URLEncoder.encode(query, "UTF-8")}"
        return decode<SessionListResponse>(request("GET", "/api/sessions$suffix")).sessions
    }

    suspend fun session(id: String): SessionDetail =
        decode(request("GET", "/api/sessions/${java.net.URLEncoder.encode(id, "UTF-8")}"))

    suspend fun history(id: String, beforeSeq: Long?, maxMessages: Int = 80): HistoryResponse {
        val parts = mutableListOf("maxMessages=$maxMessages")
        if (beforeSeq != null) parts += "beforeSeq=$beforeSeq"
        return decode(request("GET", "/api/sessions/${java.net.URLEncoder.encode(id, "UTF-8")}/history?${parts.joinToString("&")}"))
    }

    suspend fun prompt(id: String, text: String, mode: String = "queue") {
        request(
            "POST",
            "/api/sessions/${java.net.URLEncoder.encode(id, "UTF-8")}/prompt",
            """{"text":${json.encodeToString(String.serializer(), text)},"mode":"$mode"}"""
        )
    }

    suspend fun cancel(id: String) {
        request("POST", "/api/sessions/${java.net.URLEncoder.encode(id, "UTF-8")}/cancel", "{}")
    }

    suspend fun deleteSession(id: String) {
        request("DELETE", "/api/sessions/${java.net.URLEncoder.encode(id, "UTF-8")}")
    }

    suspend fun rename(id: String, title: String) {
        request(
            "POST",
            "/api/sessions/${java.net.URLEncoder.encode(id, "UTF-8")}/rename",
            """{"title":${json.encodeToString(String.serializer(), title)}}"""
        )
    }

    suspend fun setPermission(id: String, preset: String) {
        request(
            "POST",
            "/api/sessions/${java.net.URLEncoder.encode(id, "UTF-8")}/permission",
            """{"preset":${json.encodeToString(String.serializer(), preset)}}"""
        )
    }

    suspend fun setPlan(id: String, active: Boolean) {
        request(
            "POST",
            "/api/sessions/${java.net.URLEncoder.encode(id, "UTF-8")}/plan",
            """{"active":$active}"""
        )
    }

    suspend fun presets(): PresetCatalog = decode(request("GET", "/api/permission-presets"))

    suspend fun createSession(
        workspaceId: String?,
        cwd: String?,
        prompt: String,
        plan: Boolean,
        permission: String?,
        mode: String = "queue"
    ): CreateSessionResult {
        val body = buildString {
            append('{')
            if (workspaceId != null) append("\"workspaceId\":${json.encodeToString(String.serializer(), workspaceId)},")
            if (cwd != null) append("\"cwd\":${json.encodeToString(String.serializer(), cwd)},")
            append("\"prompt\":${json.encodeToString(String.serializer(), prompt)},")
            append("\"plan\":$plan,")
            if (permission != null) append("\"permission\":${json.encodeToString(String.serializer(), permission)},")
            append("\"mode\":\"$mode\"")
            append('}')
        }
        return decode(request("POST", "/api/sessions", body))
    }

    suspend fun pending(): PendingState = decode(request("GET", "/api/pending"))

    suspend fun subscribe(id: String) {
        request("POST", "/api/subscribe", """{"sessionId":${json.encodeToString(String.serializer(), id)}}""")
    }

    suspend fun unsubscribe(id: String) {
        request("POST", "/api/unsubscribe", """{"sessionId":${json.encodeToString(String.serializer(), id)}}""")
    }

    suspend fun approve(id: String, action: String) {
        request("POST", "/api/approvals/${java.net.URLEncoder.encode(id, "UTF-8")}", """{"action":"$action"}""")
    }

    suspend fun answer(id: String, answers: List<AnswerItem>) {
        val body = buildString {
            append("{\"answers\":[")
            answers.forEachIndexed { index, answer ->
                if (index > 0) append(',')
                append('{')
                append("\"id\":${json.encodeToString(String.serializer(), answer.id)},")
                append("\"selected\":[")
                answer.selected.forEachIndexed { itemIndex, selected ->
                    if (itemIndex > 0) append(',')
                    append(json.encodeToString(String.serializer(), selected))
                }
                append(']')
                if (!answer.custom.isNullOrBlank()) {
                    append(",\"custom\":${json.encodeToString(String.serializer(), answer.custom)}")
                }
                append('}')
            }
            append("]}")
        }
        request("POST", "/api/questions/${java.net.URLEncoder.encode(id, "UTF-8")}", body)
    }

    fun events(): Flow<SseEvent> = channelFlow {
        val request = Request.Builder()
            .url("$baseUrl/api/events")
            .header("Authorization", "Bearer $token")
            .header("Accept", "text/event-stream")
            .build()
        val call = client.newCall(request)
        val worker = launch(Dispatchers.IO) {
            try {
                call.execute().use { response ->
                    if (!response.isSuccessful) {
                        throw ApiException("auth/unauthorized", "事件流连接被拒绝（${response.code}）", response.code)
                    }
                    val source = response.body?.source() ?: throw IOException("empty SSE body")
                    var name = "message"
                    val data = StringBuilder()
                    while (isActive) {
                        val line = source.readUtf8Line() ?: break
                        when {
                            line.isEmpty() -> {
                                if (data.isNotEmpty()) {
                                    send(SseEvent(name, data.toString()))
                                    data.setLength(0)
                                }
                                name = "message"
                            }
                            line.startsWith("event:") -> name = line.removePrefix("event:").trim()
                            line.startsWith("data:") -> {
                                if (data.isNotEmpty()) data.append('\n')
                                data.append(line.removePrefix("data:").trimStart())
                            }
                        }
                    }
                    close()
                }
            } catch (error: Throwable) {
                close(error)
            }
        }
        awaitClose {
            call.cancel()
            worker.cancel()
        }
    }

    private suspend fun request(method: String, path: String, body: String? = null): String =
        withContext(Dispatchers.IO) {
            val builder = Request.Builder()
                .url(baseUrl + path)
                .header("Authorization", "Bearer $token")
                .header("Accept", "application/json")
            when {
                body != null -> builder.method(method, body.toRequestBody(jsonType))
                method == "GET" -> builder.get()
                else -> builder.method(method, ByteArray(0).toRequestBody(null))
            }
            client.newCall(builder.build()).execute().use { response ->
                val text = response.body?.string().orEmpty()
                if (!response.isSuccessful) throw parseError(response.code, text)
                text
            }
        }

    private fun parseError(status: Int, text: String): ApiException {
        val body = runCatching { json.decodeFromString(ApiErrorBody.serializer(), text) }.getOrNull()
        return ApiException(body?.error?.code ?: "http/$status", body?.error?.message ?: "请求失败（$status）", status)
    }

    private inline fun <reified T> decode(text: String): T = json.decodeFromString(text)

    companion object {
        suspend fun pair(
            rawBaseUrl: String,
            code: String,
            installId: String,
            deviceName: String,
            model: String,
            appVersion: String
        ): PairResult = withContext(Dispatchers.IO) {
            val base = normalizeBaseUrl(rawBaseUrl)
            val client = OkHttpClient.Builder().connectTimeout(8, TimeUnit.SECONDS).readTimeout(15, TimeUnit.SECONDS).build()
            val json = JsonConfig.json
            val body = """{"code":${json.encodeToString(String.serializer(), code.trim())},"installId":${json.encodeToString(String.serializer(), installId)},"deviceName":${json.encodeToString(String.serializer(), deviceName)},"model":${json.encodeToString(String.serializer(), model)},"appVersion":${json.encodeToString(String.serializer(), appVersion)}}"""
            val request = Request.Builder()
                .url("$base/api/pair")
                .post(body.toRequestBody("application/json; charset=utf-8".toMediaType()))
                .build()
            client.newCall(request).execute().use { response ->
                val text = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    val parsed = runCatching { json.decodeFromString(ApiErrorBody.serializer(), text) }.getOrNull()
                    throw ApiException(parsed?.error?.code ?: "pair/failed", parsed?.error?.message ?: "配对失败（${response.code}）", response.code)
                }
                json.decodeFromString(PairResult.serializer(), text)
            }
        }
    }
}

