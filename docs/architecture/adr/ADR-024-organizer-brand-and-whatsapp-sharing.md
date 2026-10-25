# ADR-024 — Marca del organizador visible para jugadores y centro para compartir por WhatsApp

- Estado: **Accepted para QA** (2026-10-24, pedido explícito del propietario). Migración `supabase/migrations/20261024000200_tenant_brand_name.sql`, aplicada en QA (30/30); reversión en `supabase/proposed/down/20261024000200_tenant_brand_name.down.sql`. Producción: nada aplicado.
- Relacionados: ADR-006 (entitlements y branding privado), ADR-007 (ciclo de vida de imágenes de marca), ADR-013 (auth), ADR-016 §7 (caché privada), ADR-023.
- Impacto AGENTS.md §12: añade una columna a `tenant_branding` y una RPC; añade una dependencia de ejecución (`uqr`) y una de desarrollo (`jsqr`).

## Contexto

El propietario pidió:

1. Que cada organizador tenga su propio logo y elija el nombre de su plataforma (por ejemplo, «Quinielas Silva»), y que ambos sean visibles para sus jugadores y aparezcan en lo que comparte.
2. Que el logo no se deforme al subirlo y que exista un ajuste inteligente que lo arregle.
3. Que compartir por WhatsApp sea avanzado: imágenes propias, avance de la tabla, quinielas por cerrar y resultados finales.

Hasta ahora el logo, el banner y los colores (PRO) solo se veían en `/admin`. Los flyers no tenían QR, ni marca de agua, ni la marca del organizador.

## Decisión

1. **Nombre de plataforma** en `tenant_branding.brand_name`, con 2–60 caracteres, sin caracteres de control, sin enlaces ni correos y con los espacios normalizados. Está disponible en **todos los planes**.
   - Lo escribe solo la RPC `set_tenant_brand_name` (administradores del tenant) y queda auditado con `audit_tenant_branding`.
   - Lo leen los miembros del tenant, con la política existente.
   - El logo, el banner y los colores siguen siendo PRO (ADR-006).
2. **Visible para jugadores**: `useTenantBranding` muestra en la quiniela el nombre (todos los planes) y, en PRO, el logo (`object-contain`, nunca estirado), el banner (`object-cover`) y el color.
   - El color solo se usa si contrasta al menos 3:1 sobre el fondo oscuro.
   - Las URL firmadas duran 10 minutos y no se refrescan en segundo plano.
3. **Logo sin deformar**: en la app y en los flyers el logo se encaja con su proporción real (`containRect`). El servidor ya convierte a WebP sin redimensionar.
4. **Ajuste inteligente del logo** (en el navegador, sin servicios externos):
   - detecta el fondo (transparente o color liso);
   - recorta los márgenes vacíos;
   - centra el dibujo en un cuadrado de 512–1024 px con un 10 % de aire;
   - conserva la transparencia y cumple 1 MiB (PNG, o WebP si el PNG pesa más).

   El organizador compara el antes y el después y elige: puede subir el original solo si cumple los límites. Nada se sube hasta que decide.
5. **Centro para compartir** (`ShareStudio`), pensado para WhatsApp:
   - plantillas con datos reales: avance de la tabla, por cerrar, resultados de la jornada, resultados finales/campeón, mi resultado e invitación (la invitación solo para quien puede leer el código de unión, es decir, administradores por RLS);
   - formato chat 4:5 o Estado 9:16;
   - foto de fondo elegida en el teléfono, recortada sin deformar y con un velo para que el texto se lea; **no se sube a ningún servidor**;
   - mensaje editable con el nombre de la plataforma y el enlace;
   - envío con Web Share de archivos (el usuario elige WhatsApp en el menú del sistema). Si no está disponible, se descarga la imagen y se abre `wa.me` con el mensaje.
6. **Growth del PRD en flyers**: QR de acceso (`/j/:code` para el organizador; `/p/:poolId` para jugadores), marca de agua en FREE y white-label en PRO (sin «SportLeagues», con logo y color).

## Dependencias

- `uqr@0.1.3` (MIT, sin dependencias, ESM, unos pocos KB): codifica el QR localmente. Alternativa descartada: escribir un codificador propio, con más riesgo de errores de escaneo.
- `jsqr@1.4.0` (Apache-2.0, solo desarrollo): un test decodifica el QR generado y comprueba que devuelve la URL exacta.
- `npm audit`: 0 vulnerabilidades tras `npm audit fix` (vite 8.3.5, vitest 5.0.5, undici 8.12.3, avisos previos a este cambio).

## Alternativas descartadas

- **Usar `tenants.name` como nombre visible:** es el nombre interno de la organización y hoy no tiene RPC de edición ni auditoría propia.
- **Recortar o ajustar el logo en el servidor:** añade carga a la Edge Function; el usuario debe ver y aprobar el resultado antes de subirlo.
- **Subir la foto de fondo:** guardaría datos personales (fotos) sin necesidad.

## Pendiente

- Mostrar el nombre en la pantalla de unión antes de unirse requiere una RPC pública de vista previa del código (hoy RLS solo deja ver la marca a miembros).
- Si el propietario quiere el logo también en FREE, basta con cambiar el entitlement en `update_tenant_branding`/`branding-asset`, pero es una decisión de producto.
