export interface VolumeAnalysis {
  currentVolume: number;
  averageVolume: number;
  volumeRatio: number;
}

/**
 * Volume Analysis
 * Computes current volume, moving average volume over `period`, and volume ratio.
 */
export function analyzeVolume(volumes: number[], period: number = 20): VolumeAnalysis {
  if (volumes.length === 0) {
    throw new Error('Volumes array is empty');
  }

  const currentVolume = volumes[volumes.length - 1];

  // We calculate average of the preceding `period` candles to evaluate volume surge
  // If we have enough history, take the previous `period` candles before the current one
  let subset: number[];
  if (volumes.length > period) {
    subset = volumes.slice(-period - 1, -1);
  } else {
    // If fewer candles available, take all except the current one, or all
    subset = volumes.length > 1 ? volumes.slice(0, -1) : volumes;
  }

  const sum = subset.reduce((acc, v) => acc + v, 0);
  const averageVolume = sum / subset.length;
  const volumeRatio = averageVolume > 0 ? currentVolume / averageVolume : 1;

  return {
    currentVolume,
    averageVolume,
    volumeRatio
  };
}
