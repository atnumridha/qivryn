package com.github.qivryn.qivrynintellijextension.utils

import com.intellij.ide.plugins.PluginManagerCore
import com.intellij.openapi.extensions.PluginId
import com.github.qivryn.qivrynintellijextension.constants.QivrynConstants
import java.nio.file.Path
import java.nio.file.Paths

/**
 * Gets the path to the Qivryn plugin directory
 *
 * @return Path to the plugin directory
 * @throws Exception if the plugin is not found
 */
fun getQivrynPluginPath(): Path {
    val pluginDescriptor =
        PluginManagerCore.getPlugin(PluginId.getId(QivrynConstants.PLUGIN_ID)) ?: throw Exception("Plugin not found")
    return pluginDescriptor.pluginPath
}

/**
 * Gets the path to the Qivryn core directory with target platform
 *
 * @return Path to the Qivryn core directory with target platform
 * @throws Exception if the plugin is not found
 */
fun getQivrynCorePath(): String {
    val pluginPath = getQivrynPluginPath()
    val corePath = Paths.get(pluginPath.toString(), "core").toString()
    val target = getOsAndArchTarget()
    return Paths.get(corePath, target).toString()
}

/**
 * Gets the path to the Qivryn binary executable
 *
 * @return Path to the Qivryn binary executable
 * @throws Exception if the plugin is not found
 */
fun getQivrynBinaryPath(): String {
    val targetPath = getQivrynCorePath()
    val os = getOS()
    val exeSuffix = if (os == OS.WINDOWS) ".exe" else ""
    return Paths.get(targetPath, "qivryn-binary$exeSuffix").toString()
}

/**
 * Gets the path to the Ripgrep executable
 *
 * @return Path to the Ripgrep executable
 * @throws Exception if the plugin is not found
 */
fun getRipgrepPath(): String {
    val targetPath = getQivrynCorePath()
    val os = getOS()
    val exeSuffix = if (os == OS.WINDOWS) ".exe" else ""
    return Paths.get(targetPath, "rg$exeSuffix").toString()
}