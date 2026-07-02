package com.github.qivryn.qivrynintellijextension.editor

import com.intellij.openapi.editor.EditorLinePainter
import com.intellij.openapi.editor.LineExtensionInfo
import com.intellij.openapi.editor.colors.EditorColorsManager
import com.intellij.openapi.editor.colors.TextAttributesKey
import com.intellij.openapi.editor.markup.EffectType
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.ui.JBColor
import java.awt.Color
import java.awt.Font

class QivrynEditorLinePainter : EditorLinePainter() {
    override fun getLineExtensions(project: Project, file: VirtualFile, lineNumber: Int): MutableCollection<LineExtensionInfo>? {
        return null
//        return mutableListOf(LineExtensionInfo("Line $lineNumber", null, EffectType.BOLD_DOTTED_LINE, JBColor.BLUE, Font.PLAIN ))
    }
}