export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }

  const kilometers = meters / 1000;
  const formattedKm = kilometers.toLocaleString('de-DE', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return `${formattedKm} km`;
}
