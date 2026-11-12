# Navigation reads enum route arguments with Class.forName(serialName), the enum's class name. Without this, R8
# renames or unboxes them and the first route with an enum argument crashes the app at launch.
-keep enum me.rxresu.core.navigation.** { *; }
