package com.github.qivryn.qivrynintellijextension.actions

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindowManager

/**
 * Extend your action with [QivrynToolbarAction] if you need a visible, active toolbar.
 */
abstract class QivrynToolbarAction : AnAction() {

    abstract fun toolbarActionPerformed(project: Project)

    final override fun actionPerformed(event: AnActionEvent) {
        val project = event.project
            ?: return
        val tool = ToolWindowManager.getInstance(project).getToolWindow("Qivryn")
            ?: return
        tool.activate(null) // un-collapse toolbar
        toolbarActionPerformed(project)
    }

}