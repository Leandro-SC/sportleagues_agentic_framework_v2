# Test Matrix — casos de alto riesgo

| Área | Caso mínimo |
|---|---|
| RLS | Tenant A no lee/escribe Tenant B |
| Roles | member no ejecuta acción admin |
| Join | código inválido/expirado no une |
| Predictions | antes del lock permite; después rechaza |
| Time | cambio de reloj del dispositivo no evita lock |
| Scoring | exacto / 1X2 / fallo / bonos |
| Recalc | corregir resultado no duplica puntos |
| Privacy | pronósticos ajenos ocultos antes del umbral |
| Entitlements | FREE no supera límites por llamada directa |
| Branding | upload inválido rechazado |
| Flyers | watermark FREE / sin watermark PRO |
| Mobile | deep link válido abre torneo correcto |
| Offline | no se pierde claridad del estado de envío |
