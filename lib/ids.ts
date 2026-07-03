export function genPlantId(): string {
  return `pl-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}
