plugins {
    `kotlin-dsl`
}

gradlePlugin {
    plugins {
        create("pluginsForCoolKids") {
            id = "rust"
            implementationClass = "RustPlugin"
        }
    }
}

repositories {
    google()
    mavenCentral()
}

dependencies {
    compileOnly(gradleApi())
    implementation("com.android.tools.build:gradle:9.4.1")
    // Keep AGP’s transitive Kotlin plugin from shadowing the project version.
    implementation("org.jetbrains.kotlin:kotlin-gradle-plugin:2.4.21")
}

