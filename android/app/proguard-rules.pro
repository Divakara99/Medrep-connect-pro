# R8 / ProGuard rules for MedRep Pro (Capacitor 8 + AdMob + Play Billing).
#
# R8 is ON for release builds (see android/app/build.gradle) because Google Play
# reports "DEX code optimization below your threshold — Obfuscation (0%)" and
# throttles publishing when a bundle has no obfuscation at all.
#
# Everything below protects code that is only reachable by REFLECTION or by name
# from JavaScript/Android, so shrinking must never rename or delete it. If a new
# Capacitor plugin is added later, add its package to the plugin block; otherwise
# the plugin silently fails at runtime in the release build while working in
# debug (the classic symptom: "plugin not implemented on Android").

# Keep line numbers so Play Console crash reports stay readable.
-keepattributes SourceFile,LineNumberTable
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod
-renamesourcefileattribute SourceFile

# ---------------------------------------------------------------- Capacitor ---
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keep class * extends com.getcapacitor.Plugin { *; }
-keepclassmembers class * {
    @com.getcapacitor.PluginMethod public <methods>;
}
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class com.getcapacitor.BridgeActivity { *; }
-keep class com.getcapacitor.BridgeWebViewClient { *; }

# ------------------------------------------------------------ Capacitor plugins ---
# AdMob (banner + rewarded + UMP consent). The class Capacitor looks up by name
# in capacitor.plugins.json is com.getcapacitor.community.admob.AdMob — the rule
# here used to name ee.forgr.capacitor.admob, a package that does not exist, so
# the plugin was only protected by the generic "extends com.getcapacitor.Plugin"
# rule below. Kept by its real name now.
-keep class com.getcapacitor.community.admob.** { *; }
# Native Purchases (Google Play Billing wrapper).
-keep class ee.forgr.** { *; }
# App plugin (back button / app state).
-keep class com.capacitorjs.plugins.app.** { *; }

# --------------------------------------------------------------- Google Mobile Ads ---
-keep class com.google.android.gms.ads.** { *; }
-keep class com.google.android.gms.internal.ads.** { *; }
-dontwarn com.google.android.gms.ads.**
# UMP consent SDK (AdMob consent form) — reflectively constructed.
-keep class com.google.android.ump.** { *; }
-dontwarn com.google.android.ump.**

# ------------------------------------------------------------------ Play Billing ---
-keep class com.android.billingclient.** { *; }
-keepclassmembers class com.android.billingclient.** {
    *** onBillingServiceDisconnected(...);
    *** onBillingSetupFinished(...);
    *** onPurchasesUpdated(...);
}
-dontwarn com.android.billingclient.**

# ----------------------------------------------------------- Kotlin / coroutines ---
# Plugins are written in Kotlin; R8 must keep the metadata Kotlin reflection reads.
-keep class kotlin.Metadata { *; }
-keepclassmembers class **$WhenMappings {
    <fields>;
}
-dontwarn kotlin.**
-dontwarn kotlinx.**

# Optional annotations that libraries reference but do not ship.
-dontwarn org.jetbrains.annotations.**
-dontwarn javax.annotation.**
-dontwarn org.apache.commons.**
-dontwarn org.json.**

# The bundled web app is loaded from assets/ by file name; never strip it.
-keep class in.medrepconnect.app.** { *; }
