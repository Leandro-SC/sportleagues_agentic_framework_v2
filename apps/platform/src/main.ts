import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import './styles.css'
import { appLinkHosts, registerNativeDeepLinks, scheduleServiceWorkerRegistration } from './lib/pwa'
import { installGlobalErrorHandlers } from './lib/telemetry'

// Observabilidad mínima sin proveedor externo (Fase 12): errores no controlados, depurados de PII. El sumidero se define cuando un ADR apruebe un colector.
installGlobalErrorHandlers()
createApp(App).use(router).mount('#app')
scheduleServiceWorkerRegistration()
// En el wrapper nativo, un App Link verificado (/j/:code, /p/:poolId) abre la ruta interna; en web no hace nada.
void registerNativeDeepLinks((path) => { void router.push(path) }, appLinkHosts())
