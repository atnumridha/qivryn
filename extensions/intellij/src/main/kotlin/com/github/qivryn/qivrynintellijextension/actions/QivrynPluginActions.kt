package com.github.qivryn.qivrynintellijextension.actions

import com.github.qivryn.qivrynintellijextension.HighlightedCodePayload
import com.github.qivryn.qivrynintellijextension.RangeInFileWithContents
import com.github.qivryn.qivrynintellijextension.browser.QivrynBrowserService
import com.github.qivryn.qivrynintellijextension.browser.QivrynBrowserService.Companion.getBrowser
import com.github.qivryn.qivrynintellijextension.editor.DiffStreamService
import com.github.qivryn.qivrynintellijextension.editor.EditorUtils
import com.github.qivryn.qivrynintellijextension.services.QivrynPluginService
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.PlatformDataKeys
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.service
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindowManager
import java.io.File

class RestartQivrynProcess : AnAction() {
    override fun actionPerformed(e: AnActionEvent) {
        e.project?.service<QivrynPluginService>()?.coreMessenger?.restart()
    }
}

class AcceptDiffAction : AnAction() {
    override fun actionPerformed(e: AnActionEvent) {
        acceptHorizontalDiff(e)
        acceptVerticalDiff(e)
    }

    private fun acceptHorizontalDiff(e: AnActionEvent) {
        val qivrynPluginService = e.project?.service<QivrynPluginService>() ?: return
        qivrynPluginService.diffManager?.acceptDiff(null)
    }

    private fun acceptVerticalDiff(e: AnActionEvent) {
        val project = e.project ?: return
        val editor =
            e.getData(PlatformDataKeys.EDITOR) ?: FileEditorManager.getInstance(project).selectedTextEditor ?: return
        val diffStreamService = project.service<DiffStreamService>()
        diffStreamService.accept(editor)
    }
}

class RejectDiffAction : AnAction() {
    override fun actionPerformed(e: AnActionEvent) {
        rejectHorizontalDiff(e)
        rejectVerticalDiff(e)
    }

    private fun rejectHorizontalDiff(e: AnActionEvent) {
        e.project?.service<QivrynPluginService>()?.diffManager?.rejectDiff(null)
    }

    private fun rejectVerticalDiff(e: AnActionEvent) {
        val project = e.project ?: return
        val editor =
            e.getData(PlatformDataKeys.EDITOR) ?: FileEditorManager.getInstance(project).selectedTextEditor ?: return
        val diffStreamService = project.service<DiffStreamService>()
        diffStreamService.reject(editor)
    }
}

class FocusQivrynInputWithoutClearAction : QivrynToolbarAction() {
    override fun toolbarActionPerformed(project: Project) {
        FocusActionUtil.sendHighlightedCodeWithMessageToWebview(project, "focusQivrynInputWithoutClear")
    }
}

class FocusQivrynInputAction : QivrynToolbarAction() {
    override fun toolbarActionPerformed(project: Project) {
        FocusActionUtil.sendHighlightedCodeWithMessageToWebview(project, "focusQivrynInputWithNewSession")
    }
}

class NewQivrynSessionAction : QivrynToolbarAction() {
    override fun toolbarActionPerformed(project: Project) {
        project.getBrowser()?.sendToWebview("focusQivrynInputWithNewSession")
    }
}

class ViewHistoryAction : QivrynToolbarAction() {
    override fun toolbarActionPerformed(project: Project) {
        project.getBrowser()?.sendToWebview("navigateTo", mapOf("path" to "/history", "toggle" to true))
    }
}

class OpenConfigAction : QivrynToolbarAction() {
    override fun toolbarActionPerformed(project: Project)  {
        project.getBrowser()?.sendToWebview("navigateTo", mapOf("path" to "/config", "toggle" to true))
    }
}

class ReloadBrowserAction: QivrynToolbarAction() {
    override fun toolbarActionPerformed(project: Project) {
        val toolWindow = ToolWindowManager.getInstance(project).getToolWindow("Qivryn")
            ?: return
        val browserService = project.service<QivrynBrowserService>()

        // Perform the reload and UI update on the Event Dispatch Thread
        ApplicationManager.getApplication().invokeLater {
            // Reload the browser service to get a new browser instance
            browserService.reload()

            val newBrowser = project.getBrowser() ?: return@invokeLater
            val newBrowserComponent = newBrowser.getComponent()

            val contentManager = toolWindow.contentManager
            contentManager.removeAllContents(true)

            val newContent = contentManager.factory.createContent(
                newBrowserComponent,
                null,
                false
            )
            contentManager.addContent(newContent)
            contentManager.setSelectedContent(newContent, true) // Request focus

            toolWindow.activate({
                // After activation, ensure the browser's input field gets focus
                newBrowser.focusOnInput()
            }, true)
        }
    }
}

class OpenLogsAction : AnAction() {
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val logFile = File(System.getProperty("user.home") + "/.qivryn/logs/core.log")
        if (logFile.exists()) {
            val virtualFile = com.intellij.openapi.vfs.LocalFileSystem.getInstance().findFileByIoFile(logFile)
            if (virtualFile != null) {
                FileEditorManager.getInstance(project).openFile(virtualFile, true)
            }
        }
    }
}

object FocusActionUtil {
    fun sendHighlightedCodeWithMessageToWebview(project: Project?, messageType: String) {
        val browser = project?.getBrowser()
            ?: return
        browser.sendToWebview(messageType)
        browser.focusOnInput()
        val rif = EditorUtils.getEditor(project)?.getHighlightedRIF()
            ?: return
        val code = HighlightedCodePayload(RangeInFileWithContents(rif.filepath, rif.range, rif.contents))
        browser.sendToWebview("highlightedCode", code)
    }
}

