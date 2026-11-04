import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

/**
 * The release signing key, read from apps/mobile/keystore.properties (never committed — see .gitignore).
 * Without that file the release build falls back to the debug key, so a fresh clone still builds; such an
 * APK will not install over one signed with the real key.
 */
val keystoreProperties = Properties().apply {
    val file = rootProject.file("keystore.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}
val hasReleaseKey = keystoreProperties.getProperty("storeFile")?.let { rootProject.file(it).exists() } == true

android {
    namespace = "in.voicetunesindia.os"
    compileSdk = 35

    defaultConfig {
        applicationId = "in.voicetunesindia.os"
        minSdk = 26
        targetSdk = 35
        versionCode = 16
        versionName = "1.6.6"
        // The CRM address pre-filled on the sign-in screen: ./gradlew assembleRelease -PcrmUrl=https://your-crm.vercel.app
        buildConfigField("String", "DEFAULT_SERVER_URL", "\"${(project.findProperty("crmUrl") as String?) ?: ""}\"")
    }

    signingConfigs {
        if (hasReleaseKey) {
            create("release") {
                storeFile = rootProject.file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
                // v2 and v3 cover Android 7 and up; v1 is not needed above minSdk 24
                enableV1Signing = false
                enableV2Signing = true
                enableV3Signing = true
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName(if (hasReleaseKey) "release" else "debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        buildConfig = true
    }
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    implementation("androidx.work:work-runtime-ktx:2.9.1")
}
