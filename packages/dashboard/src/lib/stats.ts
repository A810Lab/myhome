export interface BoxPlotResult {
  min: number;
  max: number;
  q1: number;
  median: number;
  q3: number;
  mean: number;
}

/**
 * 수치 배열로부터 BoxPlot 핵심 통계 지표(최소, 최대, Q1, Median, Q3, 평균)를 계산하는 공통 함수
 */
export function calculateBoxPlot(numbers: number[], precision: number = 2): BoxPlotResult {
  if (!numbers || numbers.length === 0) {
    return {
      min: 0,
      max: 0,
      q1: 0,
      median: 0,
      q3: 0,
      mean: 0,
    };
  }

  const sorted = [...numbers].sort((a, b) => a - b);
  const count = sorted.length;
  const min = sorted[0];
  const max = sorted[count - 1];
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const mean = sum / count;

  const getPercentile = (p: number): number => {
    const idx = p * (count - 1);
    const low = Math.floor(idx);
    const high = Math.ceil(idx);
    if (low === high) return sorted[low];
    return sorted[low] + (idx - low) * (sorted[high] - sorted[low]);
  };

  const q1 = getPercentile(0.25);
  const median = getPercentile(0.5);
  const q3 = getPercentile(0.75);

  const format = (v: number) => Number(v.toFixed(precision));

  return {
    min: format(min),
    max: format(max),
    q1: format(q1),
    median: format(median),
    q3: format(q3),
    mean: format(mean),
  };
}
