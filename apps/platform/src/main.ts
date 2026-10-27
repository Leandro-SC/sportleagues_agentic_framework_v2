import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import './styles.css'
import { appLinkHosts, registerNativeDeepLinks, scheduleServiceWorkerRegistration } from './lib/pwa'
import { hasSupabaseConfiguration } from './lib/supabase'
import { reportPlatformTelemetry } from './lib/platform-observability'
import { installGlobalErrorHandlers, setTelemetrySink } from './lib/telemetry'

// Observabilidad mínima sin proveedor externo (Fase 12): errores no controlados, depurados de PII. El sumidero se define cuando un ADR apruebe un colector.
installGlobalErrorHandlers()
if (hasSupabaseConfiguration()) setTelemetrySink(reportPlatformTelemetry)
createApp(App).use(router).mount('#app')
scheduleServiceWorkerRegistration()
// En el wrapper nativo, un App Link verificado (/j/:code, /p/:poolId) abre la ruta interna; en web no hace nada.
void registerNativeDeepLinks((path) => { void router.push(path) }, appLinkHosts())
