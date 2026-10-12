import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import './styles.css'
import { scheduleServiceWorkerRegistration } from './lib/pwa'
import { installGlobalErrorHandlers } from './lib/telemetry'

// Observabilidad mínima sin proveedor externo (Fase 12): errores no controlados, depurados de PII. El sumidero se define cuando un ADR apruebe un colector.
installGlobalErrorHandlers()
createApp(App).use(router).mount('#app')
scheduleServiceWorkerRegistration()
