/** Pixel geometry of a bar chart race frame, derived from the frame size and top N. */
export interface RaceLayout {
  width: number;
  height: number;
  vertical: boolean;
  /** 1 at the reference size (1920 wide landscape, 1080 wide portrait). */
  unit: number;
  padX: number;
  header: { top: number; titleSize: number; subtitleSize: number; metricSize: number };
  year: { top: number; right: number; size: number; left: number | null };
  chart: {
    /** Top of the axis labels. */
    top: number;
    /** Top of the first row. */
    rowsTop: number;
    left: number;
    width: number;
    height: number;
    rowHeight: number;
    barThickness: number;
  };
  columns: {
    rankWidth: number;
    logoSize: number;
    nameWidth: number;
    gap: number;
    trackLeft: number;
    trackWidth: number;
    valueReserve: number;
  };
  text: { name: number; value: number; rank: number; axis: number; small: number };
  progress: { top: number };
  footer: { bottom: number; size: number };
  annotation: { width: number; inset: number; verticalTop: number };
  /** Portrait only: the brand sits above the title instead of in the footer. */
  brandTop: number | null;
}

/**
 * Responsive layout: everything scales with the frame, and row height follows top N, so the
 * same component renders 720p to 4K, landscape and portrait.
 */
export function computeRaceLayout({
  width,
  height,
  topN,
}: {
  width: number;
  height: number;
  topN: number;
}): RaceLayout {
  const vertical = height > width;
  const unit = vertical ? width / 1080 : width / 1920;
  const u = (value: number) => Math.round(value * unit);

  const padX = vertical ? u(64) : u(96);
  const headerTop = vertical ? u(150) : u(60);
  const chartTop = vertical ? u(650) : u(236);
  const chartBottom = vertical ? height - u(390) : height - u(150);
  const axisHeight = u(34);
  const rowsTop = chartTop + axisHeight;
  const rowHeight = (chartBottom - rowsTop) / topN;
  const barThickness = Math.round(rowHeight * 0.72);

  const chartLeft = padX;
  const chartWidth = width - padX * 2;
  const rankWidth = u(vertical ? 64 : 72);
  const logoSize = Math.round(Math.min(rowHeight * 0.68, u(56)));
  const nameWidth = u(vertical ? 250 : 320);
  const gap = u(16);
  const valueReserve = u(vertical ? 210 : 230);
  const trackLeft = chartLeft + rankWidth + logoSize + gap + nameWidth + gap;
  const trackWidth = chartLeft + chartWidth - valueReserve - trackLeft;

  const nameSize = Math.round(Math.min(Math.max(rowHeight * 0.34, u(18)), u(vertical ? 34 : 32)));

  return {
    width,
    height,
    vertical,
    unit,
    padX,
    header: {
      top: headerTop,
      titleSize: u(vertical ? 64 : 54),
      subtitleSize: u(vertical ? 30 : 26),
      metricSize: u(vertical ? 26 : 22),
    },
    year: vertical
      ? { top: u(390), right: padX, size: u(140), left: padX }
      : { top: u(36), right: padX, size: u(150), left: null },
    chart: {
      top: chartTop,
      rowsTop,
      left: chartLeft,
      width: chartWidth,
      height: chartBottom - chartTop,
      rowHeight,
      barThickness,
    },
    columns: { rankWidth, logoSize, nameWidth, gap, trackLeft, trackWidth, valueReserve },
    text: {
      name: nameSize,
      value: nameSize,
      rank: Math.round(nameSize * 1.05),
      axis: u(vertical ? 20 : 18),
      small: u(vertical ? 22 : 18),
    },
    progress: { top: chartBottom + u(vertical ? 40 : 34) },
    footer: { bottom: vertical ? u(220) : u(36), size: u(vertical ? 22 : 18) },
    annotation: {
      width: u(vertical ? 760 : 560),
      inset: u(vertical ? 64 : 48),
      verticalTop: u(130),
    },
    brandTop: vertical ? u(72) : null,
  };
}
