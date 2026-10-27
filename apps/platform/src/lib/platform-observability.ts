import { getSupabaseClient } from './supabase'
import type { TelemetryEvent } from './telemetry'

let started = false

function currentRoute(): string { return window.location.pathname }

async function touch(): Promise<void> {
  try { await getSupabaseClient().rpc('touch_platform_presence', { p_route: currentRoute() }) } catch { /* observability never blocks the app */ }
}

export function reportPlatformTelemetry(event: TelemetryEvent): void {
  if (event.kind === 'event') return
  void (async () => {
    try {
      await getSupabaseClient().rpc('record_platform_client_error', {
        p_kind: event.kind,
        p_name: event.name,
        p_message: event.message,
        p_route: event.route ?? null,
      })
    } catch { /* observability never blocks the app */ }
  })()
}

export function startPlatformPresence(): void {
  if (started || typeof window === 'undefined') return
  started = true
  void touch()
  window.setInterval(() => { if (document.visibilityState === 'visible') void touch() }, 60_000)
  window.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void touch() })
}
