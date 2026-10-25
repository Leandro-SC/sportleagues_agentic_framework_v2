// Compila un APK debug de Android a partir del build web. No firma ni publica.
// Uso: npm run build:android  (desde mobile/, tras `npm install` y `npm run add:android`).
// Si falta toolchain nativo, termina con código 2 y lista exactamente qué falta (BLOCKED_EXTERNAL).
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const mobileDir = fileURLToPath(new URL('..', import.meta.url))
const androidDir = join(mobileDir, 'android')
const isWindows = process.platform === 'win32'
const problems = []

if (!existsSync(join(mobileDir, 'node_modules', '@capacitor', 'cli'))) problems.push('Dependencias sin instalar: ejecuta `npm install` dentro de mobile/.')
if (!existsSync(androidDir)) problems.push('Falta la plataforma Android: ejecuta `npm run add:android` dentro de mobile/.')
if (!process.env.ANDROID_HOME && !process.env.ANDROID_SDK_ROOT) problems.push('Falta Android SDK: instala Android Studio / cmdline-tools y define ANDROID_HOME (o ANDROID_SDK_ROOT).')
const java = spawnSync('java', ['-version'], { encoding: 'utf8', shell: isWindows })
if (java.status !== 0) {
  problems.push('Falta JDK en el PATH (Capacitor 8 requiere JDK 21).')
} else {
  // `java -version` escribe en stderr: «openjdk version "21.0.12.1" ...».
  const major = Number(/version "(\d+)/.exec(`${java.stderr}${java.stdout}`)?.[1])
  if (major !== 21) problems.push(`JDK ${Number.isFinite(major) ? major : 'desconocido'} en el PATH: el proyecto Android generado compila con Java 21 (JavaVersion.VERSION_21). Apunta JAVA_HOME/PATH a un JDK 21 (solo por proceso).`)
}

if (problems.length) {
  console.error('BLOCKED_EXTERNAL: no se puede compilar Android en este equipo.')
  for (const problem of problems) console.error(`- ${problem}`)
  process.exit(2)
}

const run = (command, args, cwd) => {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: isWindows })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

// `--skip-web`: reutiliza el `apps/platform/dist` existente (solo `cap sync`); sin la bandera se regenera el build web.
if (process.argv.includes('--skip-web')) run('npx', ['cap', 'sync', 'android'], mobileDir)
else run('npm', ['run', 'sync'], mobileDir)
run(isWindows ? '.\\gradlew.bat' : './gradlew', ['assembleDebug'], androidDir)
console.log('APK debug: mobile/android/app/build/outputs/apk/debug/app-debug.apk (sin firma de release).')
