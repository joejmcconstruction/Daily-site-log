// Pure Canvas 2D chart rendering — no chart library. Used to embed chart
// images into the auto-generated Excel workbook's Dashboard sheet, since no
// browser-safe library can write native, cell-reactive Excel chart objects.
// Charts are redrawn from live data and re-embedded every time the workbook
// regenerates (every report submit/delete), so they stay current with the
// data even though they aren't literally reactive to manual edits in Excel.

export const CHART_COLORS = ["#e8621a", "#f0b429", "#4a90d9", "#4c9a6a", "#8a6fd8", "#c1443a"];

const FONT = "system-ui, -apple-system, 'Segoe UI', Arial, sans-serif";

function makeCanvas(width, height, background) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  return { canvas, ctx };
}

function toPngBase64(canvas) {
  return canvas.toDataURL("image/png").split(",")[1];
}

// data: [{ label, value }]
export function renderPieChart({ data, width = 480, height = 320, colors = CHART_COLORS, background = "#ffffff" }) {
  const { canvas, ctx } = makeCanvas(width, height, background);
  const total = data.reduce((sum, d) => sum + d.value, 0);
  const cx = width * 0.32;
  const cy = height / 2;
  const r = Math.min(width * 0.3, height * 0.42);

  let startAngle = -Math.PI / 2;
  data.forEach((d, i) => {
    const value = total > 0 ? d.value : 0;
    const sliceAngle = total > 0 ? (value / total) * Math.PI * 2 : 0;
    const endAngle = startAngle + sliceAngle;
    if (sliceAngle > 0) {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, startAngle, endAngle);
      ctx.closePath();
      ctx.fillStyle = colors[i % colors.length];
      ctx.fill();

      const pct = value / total;
      if (pct >= 0.08) {
        const midAngle = startAngle + sliceAngle / 2;
        const lx = cx + r * 0.62 * Math.cos(midAngle);
        const ly = cy + r * 0.62 * Math.sin(midAngle);
        ctx.fillStyle = "#ffffff";
        ctx.font = `bold 17px ${FONT}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(`${Math.round(pct * 100)}%`, lx, ly);
      }
    }
    startAngle = endAngle;
  });

  const legendX = width * 0.62;
  let legendY = cy - (data.length - 1) * 13;
  ctx.font = `600 13px ${FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  data.forEach((d, i) => {
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(legendX, legendY - 6, 12, 12);
    ctx.fillStyle = "#211f1a";
    ctx.fillText(`${d.label} (${d.value})`, legendX + 18, legendY);
    legendY += 26;
  });

  return toPngBase64(canvas);
}

function drawAxesAndGrid(ctx, padL, padT, plotW, plotH, maxVal, steps, valueFormatter) {
  ctx.strokeStyle = "#e6ded0";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#8a8578";
  ctx.font = `12px ${FONT}`;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let i = 0; i <= steps; i++) {
    const v = (maxVal / steps) * i;
    const y = padT + plotH - (v / maxVal) * plotH;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + plotW, y);
    ctx.stroke();
    ctx.fillText(valueFormatter(v), padL - 8, y);
  }
}

// series: [{ label, values: [v per category] }]
export function renderGroupedBarChart({ categories, series, width = 640, height = 360, colors = CHART_COLORS, unit = "", background = "#ffffff" }) {
  const { canvas, ctx } = makeCanvas(width, height, background);
  const padL = 56;
  const padR = 20;
  const padT = 34;
  const padB = 46;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const allValues = series.flatMap((s) => s.values);
  const maxVal = Math.max(1, ...allValues) * 1.2;

  drawAxesAndGrid(ctx, padL, padT, plotW, plotH, maxVal, 4, (v) => Math.round(v) + unit);

  const groupW = plotW / categories.length;
  const barGap = 6;
  const barW = (groupW - barGap * (series.length + 1)) / series.length;

  categories.forEach((cat, ci) => {
    series.forEach((s, si) => {
      const val = s.values[ci] || 0;
      const barH = (val / maxVal) * plotH;
      const x = padL + ci * groupW + barGap + si * (barW + barGap);
      const y = padT + plotH - barH;
      ctx.fillStyle = colors[si % colors.length];
      ctx.fillRect(x, y, barW, Math.max(barH, val > 0 ? 1 : 0));
      if (val > 0) {
        ctx.fillStyle = "#211f1a";
        ctx.font = `bold 11px ${FONT}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText(String(val), x + barW / 2, y - 3);
      }
    });
    ctx.fillStyle = "#5a5548";
    ctx.font = `600 11px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(cat, padL + ci * groupW + groupW / 2, padT + plotH + 8);
  });

  ctx.strokeStyle = "#948d7e";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(padL, padT + plotH);
  ctx.lineTo(padL + plotW, padT + plotH);
  ctx.stroke();

  let lx = padL;
  const ly = 14;
  ctx.font = `600 12px ${FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  series.forEach((s, si) => {
    ctx.fillStyle = colors[si % colors.length];
    ctx.fillRect(lx, ly - 6, 12, 12);
    ctx.fillStyle = "#211f1a";
    ctx.fillText(s.label, lx + 18, ly);
    lx += ctx.measureText(s.label).width + 40;
  });

  return toPngBase64(canvas);
}

// segments: [{ label, values: [v per category] }] stacked bottom-up in order given
export function renderStackedBarChart({ categories, segments, width = 640, height = 360, colors = CHART_COLORS, prefix = "", background = "#ffffff" }) {
  const { canvas, ctx } = makeCanvas(width, height, background);
  const padL = 64;
  const padR = 20;
  const padT = 34;
  const padB = 46;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const totals = categories.map((_, ci) => segments.reduce((sum, s) => sum + (s.values[ci] || 0), 0));
  const maxVal = Math.max(1, ...totals) * 1.2;

  drawAxesAndGrid(ctx, padL, padT, plotW, plotH, maxVal, 4, (v) => prefix + Math.round(v));

  const groupW = plotW / categories.length;
  const barW = groupW * 0.5;

  categories.forEach((cat, ci) => {
    let cumulative = 0;
    const x = padL + ci * groupW + (groupW - barW) / 2;
    segments.forEach((s, si) => {
      const val = s.values[ci] || 0;
      const barH = (val / maxVal) * plotH;
      const y = padT + plotH - ((cumulative + val) / maxVal) * plotH;
      ctx.fillStyle = colors[si % colors.length];
      ctx.fillRect(x, y, barW, Math.max(barH, val > 0 ? 1 : 0));
      cumulative += val;
    });
    if (totals[ci] > 0) {
      const topY = padT + plotH - (totals[ci] / maxVal) * plotH;
      ctx.fillStyle = "#211f1a";
      ctx.font = `bold 11px ${FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(prefix + Math.round(totals[ci]), x + barW / 2, topY - 3);
    }
    ctx.fillStyle = "#5a5548";
    ctx.font = `600 11px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(cat, padL + ci * groupW + groupW / 2, padT + plotH + 8);
  });

  ctx.strokeStyle = "#948d7e";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(padL, padT + plotH);
  ctx.lineTo(padL + plotW, padT + plotH);
  ctx.stroke();

  let lx = padL;
  const ly = 14;
  ctx.font = `600 12px ${FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  segments.forEach((s, si) => {
    ctx.fillStyle = colors[si % colors.length];
    ctx.fillRect(lx, ly - 6, 12, 12);
    ctx.fillStyle = "#211f1a";
    ctx.fillText(s.label, lx + 18, ly);
    lx += ctx.measureText(s.label).width + 40;
  });

  return toPngBase64(canvas);
}
