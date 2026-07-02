package com.github.qivryn.qivrynintellijextension.qivryn.process

import java.io.InputStream
import java.io.OutputStream

interface QivrynProcess {

    val input: InputStream
    val output: OutputStream

    fun close()

}
