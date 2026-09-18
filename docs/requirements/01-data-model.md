# Requisitos — Modelo de datos

Entidades mínimas sugeridas:

- profiles
- tenants
- tenant_memberships
- plans / tenant_entitlements
- pools (quinielas)
- pool_rules
- tournaments
- rounds
- teams
- matches
- pool_matches
- participants
- participant_payment_status
- predictions
- official_results
- scoring_events o scoring_snapshots
- leaderboard_snapshots (solo si el rendimiento lo justifica)
- team_ratings
- model_predictions
- branding_assets
- audit_log

La forma final se decide en Fase 03 y se documenta con ERD/ADR. Evitar tablas derivadas prematuras si una vista/RPC es suficiente.
