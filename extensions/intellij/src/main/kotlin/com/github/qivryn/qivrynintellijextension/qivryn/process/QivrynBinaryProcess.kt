package com.github.qivryn.qivrynintellijextension.qivryn.process

import com.github.qivryn.qivrynintellijextension.proxy.ProxySettings
import com.github.qivryn.qivrynintellijextension.utils.OS
import com.github.qivryn.qivrynintellijextension.utils.getQivrynBinaryPath
import com.github.qivryn.qivrynintellijextension.utils.getOS
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.nio.file.Files
import java.nio.file.Paths
import java.nio.file.attribute.PosixFilePermission

class QivrynBinaryProcess(
    private val onUnexpectedExit: () -> Unit
) : QivrynProcess {

    private val process = startBinaryProcess()
    override val input: InputStream = process.inputStream
    override val output: OutputStream = process.outputStream

    override fun close() =
        process.destroy()

    private fun startBinaryProcess(): Process {
        val path = getQivrynBinaryPath()
        runBlocking(Dispatchers.IO) {
            setPermissions()
        }

        val builder = ProcessBuilder(path)
        builder.environment() += ProxySettings.getSettings().toQivrynEnvVars()
        return builder
            .directory(File(path).parentFile)
            .start()
            .apply { onExit().thenRun(onUnexpectedExit).thenRun(::reportErrorTelemetry) }
    }

    private fun reportErrorTelemetry() {
        var err = process.errorStream?.bufferedReader()?.readText()?.trim()
        if (err != null) {
            // There are often "⚡️Done in Xms" messages, and we want everything after the last one
            val delimiter = "⚡ Done in"
            val doneIndex = err.lastIndexOf(delimiter)
            if (doneIndex != -1) {
                err = err.substring(doneIndex + delimiter.length)
            }
        }

    }

    private companion object {

        private fun setPermissions() {
            val os = getOS()
            when (os) {
                OS.MAC -> setMacOsPermissions()
                OS.WINDOWS -> {}
                OS.LINUX -> elevatePermissions()
            }
        }

        private fun setMacOsPermissions() {
            ProcessBuilder("xattr", "-dr", "com.apple.quarantine", getQivrynBinaryPath()).start().waitFor()
            elevatePermissions()
        }

        // todo: consider setting permissions ahead-of-time during build/packaging, not at runtime
        private fun elevatePermissions() {
            val path = getQivrynBinaryPath()
            val permissions = setOf(
                PosixFilePermission.OWNER_READ,
                PosixFilePermission.OWNER_WRITE,
                PosixFilePermission.OWNER_EXECUTE
            )
            Files.setPosixFilePermissions(Paths.get(path), permissions)
        }
    }

}
