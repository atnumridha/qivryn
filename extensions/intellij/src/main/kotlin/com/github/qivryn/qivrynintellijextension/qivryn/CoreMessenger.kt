package com.github.qivryn.qivrynintellijextension.qivryn

import com.github.qivryn.qivrynintellijextension.browser.QivrynBrowserService.Companion.getBrowser
import com.github.qivryn.qivrynintellijextension.constants.MessageTypes
import com.github.qivryn.qivrynintellijextension.qivryn.process.QivrynBinaryProcess
import com.github.qivryn.qivrynintellijextension.qivryn.process.QivrynProcessHandler
import com.github.qivryn.qivrynintellijextension.qivryn.process.QivrynSocketProcess
import com.github.qivryn.qivrynintellijextension.services.QivrynPluginService
import com.github.qivryn.qivrynintellijextension.services.GsonService
import com.github.qivryn.qivrynintellijextension.utils.uuid
import com.google.gson.JsonSyntaxException
import com.intellij.openapi.components.service
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import kotlinx.coroutines.CoroutineScope

class CoreMessenger(
    private val project: Project,
    private val ideProtocolClient: IdeProtocolClient,
    val coroutineScope: CoroutineScope,
    private val onUnexpectedExit: () -> Unit,
    private val gsonService: GsonService = service<GsonService>(),
) {
    private val gson = gsonService.gson
    private val responseListeners = mutableMapOf<String, (Any?) -> Unit>()
    private var process = startQivrynProcess()
    private val log = Logger.getInstance(CoreMessenger::class.java.simpleName)

    fun request(messageType: String, data: Any?, messageId: String?, onResponse: (Any?) -> Unit) {
        val id = messageId ?: uuid()
        val message = gson.toJson(mapOf("messageId" to id, "messageType" to messageType, "data" to data))
        responseListeners[id] = onResponse
        process.write(message)
    }

    private fun startQivrynProcess(): QivrynProcessHandler {
        val isTcp = System.getenv("USE_TCP")?.toBoolean() ?: false
        val process = if (isTcp)
            QivrynSocketProcess()
        else
            QivrynBinaryProcess(onUnexpectedExit)
        return QivrynProcessHandler(coroutineScope, process, ::handleMessage)
    }

    private fun handleMessage(json: String) {
        val responseMap = tryToParse(json) ?: return
        val messageId = responseMap["messageId"].toString()
        val messageType = responseMap["messageType"].toString()
        val data = responseMap["data"]

        // IDE listeners
        if (messageType in MessageTypes.IDE_MESSAGE_TYPES) {
            ideProtocolClient.handleMessage(json) { data ->
                val message = gson.toJson(mapOf("messageId" to messageId, "messageType" to messageType, "data" to data))
                process.write(message)
            }
        }

        // Forward to webview
        if (messageType in MessageTypes.PASS_THROUGH_TO_WEBVIEW) {
            project.getBrowser()?.sendToWebview(messageType, responseMap["data"], messageId)
        }

        // Responses for messageId
        responseListeners[messageId]?.let { listener ->
            listener(data)
            @Suppress("UNCHECKED_CAST")
            val done = (data as? Map<String, Any>)?.get("done") as? Boolean

            // Remove unless explicitly streaming (done == false)
            if (done != false) {
                responseListeners.remove(messageId)
            }
        }
    }

    // todo: map<*, *> = code smell
    private fun tryToParse(json: String): Map<*, *>? =
        try {
            gson.fromJson(json, Map::class.java)
        } catch (_: JsonSyntaxException) {
            log.warn("Invalid message JSON: $json") // example: NODE_ENV undefined
            null
        }

    fun restart() {
        log.warn("Restarting Qivryn process")
        responseListeners.clear()
        process.close()
        process = startQivrynProcess()
    }

    fun close() {
        log.warn("Closing Qivryn process")
        process.close()
    }
}