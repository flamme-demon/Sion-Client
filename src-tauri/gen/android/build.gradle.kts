buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath("com.android.tools.build:gradle:9.4.1")
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.4.21")
    }
}

allprojects {
    repositories {
        google()
        mavenCentral()
        // Composant Kotlin de `rustls-platform-verifier` (vérification TLS du
        // moteur Matrix Rust), publié par ses auteurs sur GitHub.
        maven {
            url = uri("https://github.com/rustls/rustls-platform-verifier/raw/maven-archive/android-release-support/maven/")
        }
    }
}

tasks.register("clean").configure {
    delete("build")
}

