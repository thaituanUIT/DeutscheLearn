import type { Player } from "../api/types";

let currentPlayer: Player | null = null;

export function setPlayer(player: Player): void {
  currentPlayer = player;
}

export function getPlayer(): Player | null {
  return currentPlayer;
}
