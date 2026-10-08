import type { Player } from "./types";

// Keep the existing polyvalence ranking, excluding only ceremony winners.
export function ceremonyPolyvalents(players: Player[], winners: string[]): Player[] {
  const used = new Set(winners);
  return players.filter((player) => player.operationTypes >= 2 && !used.has(player.name))
    .sort((a, b) => b.polyvalence - a.polyvalence || b.operations - a.operations);
}
