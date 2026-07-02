package com.github.qivryn.qivrynintellijextension.qivryn

import com.github.qivryn.qivrynintellijextension.activities.QivrynPluginStartupActivity
import com.github.qivryn.qivrynintellijextension.constants.getQivrynGlobalPath
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.io.StreamUtil
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.vfs.VirtualFile
import com.jetbrains.jsonSchema.extension.JsonSchemaFileProvider
import com.jetbrains.jsonSchema.extension.JsonSchemaProviderFactory
import com.jetbrains.jsonSchema.extension.SchemaType
import java.io.File
import java.io.IOException
import java.nio.charset.StandardCharsets
import java.nio.file.Paths

class ConfigJsonSchemaProviderFactory : JsonSchemaProviderFactory {
    override fun getProviders(project: Project): MutableList<JsonSchemaFileProvider> {
        return mutableListOf(ConfigJsonSchemaFileProvider())
    }
}

class ConfigJsonSchemaFileProvider : JsonSchemaFileProvider {
    override fun isAvailable(file: VirtualFile): Boolean {
        return file.path.endsWith("/.qivryn/config.json") || file.path.endsWith("\\.qivryn\\config.json")
    }

    override fun getName(): String {
        return "config.json"
    }

    override fun getSchemaFile(): VirtualFile? {
        QivrynPluginStartupActivity::class.java.getClassLoader().getResourceAsStream("config_schema.json")
            .use { `is` ->
                if (`is` == null) {
                    throw IOException("Resource not found: config_schema.json")
                }
                val content = `is`.bufferedReader(StandardCharsets.UTF_8).use { it.readText() }
                val filepath = Paths.get(getQivrynGlobalPath(), "config_schema.json").toString()
                File(filepath).writeText(content)
                return LocalFileSystem.getInstance().findFileByPath(filepath)
            }
    }

    override fun getSchemaType(): SchemaType {
        return SchemaType.embeddedSchema
    }

}
