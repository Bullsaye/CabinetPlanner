// Adds a release signing config to the generated Android project
// (gen/android/app/build.gradle.kts), reading keystore.properties next to
// the Gradle root. Used by the Android workflow when a keystore is set.
// Usage: node tools/android-signing.mjs <path to app/build.gradle.kts>
import { readFileSync, writeFileSync } from "node:fs";

const file = process.argv[2];
let s = readFileSync(file, "utf8");
if (s.includes("keystore.properties")) process.exit(0);
if (!s.includes("import java.util.Properties")) s = `import java.util.Properties\nimport java.io.FileInputStream\n${s}`;
else if (!s.includes("import java.io.FileInputStream")) s = `import java.io.FileInputStream\n${s}`;
const signing = `    signingConfigs {
        create("release") {
            val keystoreProperties = Properties()
            val keystorePropertiesFile = rootProject.file("keystore.properties")
            if (keystorePropertiesFile.exists()) keystoreProperties.load(FileInputStream(keystorePropertiesFile))
            keyAlias = keystoreProperties["keyAlias"] as String
            keyPassword = keystoreProperties["keyPassword"] as String
            storeFile = file(keystoreProperties["storeFile"] as String)
            storePassword = keystoreProperties["password"] as String
        }
    }
`;
if (!/\n\s*buildTypes\s*\{/.test(s)) throw new Error("buildTypes block not found");
s = s.replace(/\n(\s*)buildTypes\s*\{/, `\n${signing}$1buildTypes {`);
if (!/getByName\("release"\)\s*\{/.test(s)) throw new Error("release build type not found");
s = s.replace(/getByName\("release"\)\s*\{/, `getByName("release") {\n            signingConfig = signingConfigs.getByName("release")`);
writeFileSync(file, s);
console.log(`signing config added to ${file}`);
