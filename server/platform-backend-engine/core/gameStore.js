const gamesByNamespace = new WeakMap();

export function getGamesStore(nsp) {
  if (!nsp) return new Map();
  if (!gamesByNamespace.has(nsp)) {
    gamesByNamespace.set(nsp, new Map());
  }
  return gamesByNamespace.get(nsp);
}
