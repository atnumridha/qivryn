package com.github.qivryn.qivrynintellijextension.services

import com.github.qivryn.qivrynintellijextension.constants.getConfigJsonPath
import com.github.qivryn.qivrynintellijextension.constants.getConfigJsPath
import com.google.gson.Gson
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import com.intellij.openapi.components.service
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.options.Configurable
import com.intellij.openapi.project.DumbAware
import com.intellij.util.concurrency.AppExecutorUtil
import com.intellij.util.io.HttpRequests
import com.intellij.util.messages.Topic
import java.awt.GridBagConstraints
import java.awt.GridBagLayout
import java.io.File
import java.net.URL
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import javax.swing.*

class QivrynSettingsComponent : DumbAware {
    val panel: JPanel = JPanel(GridBagLayout())
    val remoteConfigServerUrl: JTextField = JTextField()
    val remoteConfigSyncPeriod: JTextField = JTextField()
    val userToken: JTextField = JTextField()
    val enableTabAutocomplete: JCheckBox = JCheckBox("Enable Tab Autocomplete")
    val displayEditorTooltip: JCheckBox = JCheckBox("Display Editor Tooltip")
    val showIDECompletionSideBySide: JCheckBox = JCheckBox("Show IDE completions side-by-side")

    init {
        val constraints = GridBagConstraints()

        constraints.fill = GridBagConstraints.HORIZONTAL
        constraints.weightx = 1.0
        constraints.weighty = 0.0
        constraints.gridx = 0
        constraints.gridy = GridBagConstraints.RELATIVE

        panel.add(JLabel("Remote Config Server URL:"), constraints)
        constraints.gridy++
        constraints.gridy++
        panel.add(remoteConfigServerUrl, constraints)
        constraints.gridy++
        panel.add(JLabel("Remote Config Sync Period (in minutes):"), constraints)
        constraints.gridy++
        panel.add(remoteConfigSyncPeriod, constraints)
        constraints.gridy++
        panel.add(JLabel("User Token:"), constraints)
        constraints.gridy++
        panel.add(userToken, constraints)
        constraints.gridy++
        panel.add(enableTabAutocomplete, constraints)
        constraints.gridy++
        panel.add(displayEditorTooltip, constraints)
        constraints.gridy++
        panel.add(showIDECompletionSideBySide, constraints)
        constraints.gridy++

        // Add a "filler" component that takes up all remaining vertical space
        constraints.weighty = 1.0
        val filler = JPanel()
        panel.add(filler, constraints)
    }
}

data class QivrynRemoteConfigSyncResponse(
    var configJson: String?,
    var configJs: String?
)

@State(
    name = "com.github.qivryn.qivrynintellijextension.services.QivrynExtensionSettings",
    storages = [Storage("QivrynExtensionSettings.xml")]
)
open class QivrynExtensionSettings : PersistentStateComponent<QivrynExtensionSettings.QivrynState> {

    class QivrynState {
        var lastSelectedInlineEditModel: String? = null
        var shownWelcomeDialog: Boolean = false
        var remoteConfigServerUrl: String? = null
        var remoteConfigSyncPeriod: Int = 60
        var userToken: String? = null
        var enableTabAutocomplete: Boolean = true
        var displayEditorTooltip: Boolean = true
        var showIDECompletionSideBySide: Boolean = false
        var qivrynTestEnvironment: String = "production"
    }

    var qivrynState: QivrynState = QivrynState()

    private var remoteSyncFuture: ScheduledFuture<*>? = null

    override fun getState(): QivrynState {
        return qivrynState
    }

    override fun loadState(state: QivrynState) {
        qivrynState = state
    }

    companion object {
        private val log = Logger.getInstance(QivrynExtensionSettings::class.java)

        val instance: QivrynExtensionSettings
            get() = service<QivrynExtensionSettings>()
    }

    private fun syncRemoteConfig() {
        val remoteServerUrl = state.remoteConfigServerUrl
        if (remoteServerUrl.isNullOrEmpty()) return

        val token = state.userToken
        val baseUrl = remoteServerUrl.removeSuffix("/")
        try {
            val url = "$baseUrl/sync"
            val responseBody = HttpRequests.request(url)
                .connectTimeout(5000)
                .readTimeout(5000)
                .tuner { connection ->
                    if (token != null)
                        connection.addRequestProperty("Authorization", "Bearer $token")
                }.readString()
            val response = Gson().fromJson(responseBody, QivrynRemoteConfigSyncResponse::class.java)
            val hostname = URL(url).host

            if (!response.configJson.isNullOrEmpty()) {
                File(getConfigJsonPath(hostname)).writeText(response.configJson!!)
            }

            if (!response.configJs.isNullOrEmpty()) {
                File(getConfigJsPath(hostname)).writeText(response.configJs!!)
            }
        } catch (e: Exception) {
            log.warn("Failed to sync remote config from $baseUrl", e)
        }
    }

    fun addRemoteSyncJob() {
        remoteSyncFuture?.cancel(false)
        remoteSyncFuture = null

        val remoteServerUrl = qivrynState.remoteConfigServerUrl
        if (remoteServerUrl.isNullOrEmpty()) return

        remoteSyncFuture = AppExecutorUtil.getAppScheduledExecutorService()
            .scheduleWithFixedDelay(
                ::syncRemoteConfig,
                0,
                qivrynState.remoteConfigSyncPeriod.toLong(),
                TimeUnit.MINUTES
            )
    }
}

interface SettingsListener {
    fun settingsUpdated(settings: QivrynExtensionSettings.QivrynState)

    companion object {
        val TOPIC = Topic.create("SettingsUpdate", SettingsListener::class.java)
    }
}

class QivrynExtensionConfigurable : Configurable {
    private var mySettingsComponent: QivrynSettingsComponent? = null

    override fun createComponent(): JComponent {
        mySettingsComponent = QivrynSettingsComponent()
        return mySettingsComponent!!.panel
    }

    override fun isModified(): Boolean {
        val settings = QivrynExtensionSettings.instance
        val modified =
            mySettingsComponent?.remoteConfigServerUrl?.text != settings.qivrynState.remoteConfigServerUrl ||
                    mySettingsComponent?.remoteConfigSyncPeriod?.text?.toInt() != settings.qivrynState.remoteConfigSyncPeriod ||
                    mySettingsComponent?.userToken?.text != settings.qivrynState.userToken ||
                    mySettingsComponent?.enableTabAutocomplete?.isSelected != settings.qivrynState.enableTabAutocomplete ||
                    mySettingsComponent?.displayEditorTooltip?.isSelected != settings.qivrynState.displayEditorTooltip ||
                    mySettingsComponent?.showIDECompletionSideBySide?.isSelected != settings.qivrynState.showIDECompletionSideBySide
        return modified
    }

    override fun apply() {
        val settings = QivrynExtensionSettings.instance
        settings.qivrynState.remoteConfigServerUrl = mySettingsComponent?.remoteConfigServerUrl?.text
        settings.qivrynState.remoteConfigSyncPeriod = mySettingsComponent?.remoteConfigSyncPeriod?.text?.toInt() ?: 60
        settings.qivrynState.userToken = mySettingsComponent?.userToken?.text
        settings.qivrynState.enableTabAutocomplete = mySettingsComponent?.enableTabAutocomplete?.isSelected ?: false
        settings.qivrynState.displayEditorTooltip = mySettingsComponent?.displayEditorTooltip?.isSelected ?: true
        settings.qivrynState.showIDECompletionSideBySide =
            mySettingsComponent?.showIDECompletionSideBySide?.isSelected ?: false

        ApplicationManager.getApplication().messageBus.syncPublisher(SettingsListener.TOPIC)
            .settingsUpdated(settings.qivrynState)
        QivrynExtensionSettings.instance.addRemoteSyncJob()
    }

    override fun reset() {
        val settings = QivrynExtensionSettings.instance
        mySettingsComponent?.remoteConfigServerUrl?.text = settings.qivrynState.remoteConfigServerUrl
        mySettingsComponent?.remoteConfigSyncPeriod?.text = settings.qivrynState.remoteConfigSyncPeriod.toString()
        mySettingsComponent?.userToken?.text = settings.qivrynState.userToken
        mySettingsComponent?.enableTabAutocomplete?.isSelected = settings.qivrynState.enableTabAutocomplete
        mySettingsComponent?.displayEditorTooltip?.isSelected = settings.qivrynState.displayEditorTooltip
        mySettingsComponent?.showIDECompletionSideBySide?.isSelected =
            settings.qivrynState.showIDECompletionSideBySide
    }

    override fun disposeUIResources() {
        mySettingsComponent = null
    }

    override fun getDisplayName(): String =
        "Qivryn Extension Settings"
}
