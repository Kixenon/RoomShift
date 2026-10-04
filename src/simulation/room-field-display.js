export function temperatureDisplayRange(result) {
  return result.displayRanges?.temperature ?? { minimum: 10, maximum: 30 };
}
