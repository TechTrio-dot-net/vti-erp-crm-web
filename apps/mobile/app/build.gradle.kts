plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "in.voicetunesindia.os"
    compileSdk = 35

    defaultConfig {
        applicationId = "in.voicetunesindia.os"
        minSdk = 26
        targetSdk = 35
        versionCode = 14
        versionName = "1.6.4"
        // The CRM address pre-filled on the sign-in screen: ./gradlew assembleRelease -PcrmUrl=https://your-crm.vercel.app
        buildConfigField("String", "DEFAULT_SERVER_URL", "\"${(project.findProperty("crmUrl") as String?) ?: ""}\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Signed with the debug key so the APK installs directly; use your own keystore for wider distribution
            signingConfig = signingConfigs.getByName("debug")
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
