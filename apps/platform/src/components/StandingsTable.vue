<script setup lang="ts">
import { RouterLink } from 'vue-router'
import type { RankedStanding, Team } from '../lib/sports-catalog'
import TeamCrest from './TeamCrest.vue'

withDefaults(defineProps<{ rows: RankedStanding[]; team: (id: string) => Team | undefined; detailed?: boolean; caption: string }>(), { detailed: false })
</script>

<template>
  <div class="overflow-hidden">
    <table class="w-full border-separate border-spacing-y-1 text-sm">
      <caption class="sr-only">{{ caption }}</caption>
      <thead>
        <tr class="text-[11px] font-semibold text-text-muted">
          <th scope="col" class="w-8 py-1.5 pl-3 text-left font-semibold">#</th>
          <th scope="col" class="py-1.5 text-left font-semibold">Equipo</th>
          <th scope="col" class="w-9 py-1.5 text-center font-semibold" title="Partidos jugados">PJ</th>
          <template v-if="detailed">
            <th scope="col" class="w-7 py-1.5 text-center font-semibold" title="Ganados">G</th>
            <th scope="col" class="w-7 py-1.5 text-center font-semibold" title="Empatados">E</th>
            <th scope="col" class="w-7 py-1.5 text-center font-semibold" title="Perdidos">P</th>
            <th scope="col" class="w-9 py-1.5 text-center font-semibold" title="Diferencia de goles">DG</th>
          </template>
          <th scope="col" class="w-11 py-1.5 pr-3 text-center font-semibold" title="Puntos">PTS</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="row.team_id"
          :class="row.position === 1 ? 'bg-primary-100/70' : 'bg-surface/60'"
        >
          <td class="relative rounded-l-xl py-2.5 pl-3 font-semibold text-text" :class="row.position === 1 ? 'before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-pill before:bg-primary' : ''">{{ row.position }}</td>
          <td class="max-w-0 py-2.5">
            <RouterLink :to="{ name: 'team', params: { teamId: row.team_id } }" class="flex min-w-0 items-center gap-2.5 hover:underline">
              <TeamCrest :name="team(row.team_id)?.name ?? row.team_id" :short-name="team(row.team_id)?.short_name" :colors="team(row.team_id)?.colors" size="xs" />
              <span class="truncate font-medium text-text">{{ team(row.team_id)?.name ?? row.team_id }}</span>
            </RouterLink>
          </td>
          <td class="py-2.5 text-center text-text-muted">{{ row.played }}</td>
          <template v-if="detailed">
            <td class="py-2.5 text-center text-text-muted">{{ row.won }}</td>
            <td class="py-2.5 text-center text-text-muted">{{ row.drawn }}</td>
            <td class="py-2.5 text-center text-text-muted">{{ row.lost }}</td>
            <td class="py-2.5 text-center text-text-muted">{{ row.goal_difference > 0 ? `+${row.goal_difference}` : row.goal_difference }}</td>
          </template>
          <td class="rounded-r-xl py-2.5 pr-3 text-center font-display font-extrabold text-text">{{ row.points }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
