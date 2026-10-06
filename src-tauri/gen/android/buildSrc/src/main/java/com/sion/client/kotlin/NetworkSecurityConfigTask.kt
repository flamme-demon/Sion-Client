import org.gradle.api.DefaultTask
import org.gradle.api.file.ConfigurableFileCollection
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.tasks.InputFiles
import org.gradle.api.tasks.OutputDirectory
import org.gradle.api.tasks.TaskAction
import java.util.zip.ZipFile

/** Conserve les exceptions CRL du vérificateur TLS et autorise le serveur média local. */
abstract class NetworkSecurityConfigTask : DefaultTask() {
    @get:InputFiles
    abstract val verifierArchive: ConfigurableFileCollection

    @get:OutputDirectory
    abstract val outputDirectory: DirectoryProperty

    @TaskAction
    fun generate() {
        val original = ZipFile(verifierArchive.singleFile).use { archive ->
            val entry = requireNotNull(archive.getEntry("res/xml/network_security_config.xml")) {
                "Configuration réseau de rustls-platform-verifier introuvable"
            }
            archive.getInputStream(entry).bufferedReader().use { it.readText() }
        }
        val closingTag = "</network-security-config>"
        require(original.contains(closingTag)) { "Configuration réseau TLS invalide" }
        val localMedia = """
            <domain-config cleartextTrafficPermitted="true">
                <domain includeSubdomains="false">127.0.0.1</domain>
                <domain includeSubdomains="false">localhost</domain>
            </domain-config>
        """.trimIndent()
        val target = outputDirectory.file("xml/network_security_config.xml").get().asFile
        target.parentFile.mkdirs()
        target.writeText(original.replace(closingTag, "$localMedia\n$closingTag"))
    }
}
