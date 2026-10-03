export function temperatureDisplayRange(result) {
  const ambient = result.ambientTemperature;
  const minimum = result.stats?.minTemperature ?? ambient;
  const maximum = result.stats?.maxTemperature ?? ambient;
  if (maximum - minimum >= 0.5) return { minimum, maximum };
  return {
    minimum: Math.min(minimum, ambient - 0.5),
    maximum: Math.max(maximum, ambient + 0.5),
  };
}
