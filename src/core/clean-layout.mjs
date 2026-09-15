export const CLEAN_SPACING = Object.freeze({
  shapeToShape: 28,
  shapeGroupToArrow: 18,
  shapeGroupToText: 16,
  textBlockInternal: 10,
  section: 42,
});

export function computeCleanLayout(spacing = CLEAN_SPACING) {
  const values = Object.values(spacing);
  if (values.length !== 5 || values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error("All five Clean spacing categories must be non-negative numbers");
  }
  if (new Set(values).size === 1) throw new Error("Clean spacing categories must not all be equal");

  const titleBaseline = 44;
  const table = Object.freeze({ x: 65, y: titleBaseline + spacing.section, width: 225, height: 140 });
  const circle = Object.freeze({
    radius: 56,
    cx: table.x + table.width + spacing.shapeToShape + 56,
    cy: table.y + 56,
  });
  const shapeGroupBottom = Math.max(table.y + table.height, circle.cy + circle.radius);
  const arrow = Object.freeze({
    x: circle.cx,
    top: shapeGroupBottom + spacing.shapeGroupToArrow,
    bottom: shapeGroupBottom + spacing.shapeGroupToArrow + 42,
  });
  const text = Object.freeze({
    top: arrow.bottom + spacing.shapeGroupToText,
    fontSize: 20,
    secondBaseline: arrow.bottom + spacing.shapeGroupToText + 40 + spacing.textBlockInternal,
  });
  return Object.freeze({ titleBaseline, table, circle, shapeGroupBottom, arrow, text });
}

export function renderCleanSvg(spacing = CLEAN_SPACING) {
  const layout = computeCleanLayout(spacing);
  const { table, circle, arrow, text } = layout;
  const firstBaseline = text.top + text.fontSize;
  const column = table.width / 3;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420">
  <rect width="640" height="420" fill="#ffffff"/>
  <text x="40" y="${layout.titleBaseline}" font-family="sans-serif" font-size="24" font-weight="600" fill="#111">Synthetic project sketch</text>
  <rect x="${table.x}" y="${table.y}" width="${table.width}" height="${table.height}" rx="5" fill="none" stroke="#111" stroke-width="3"/>
  <path d="M${table.x + column} ${table.y} V${table.y + table.height} M${table.x + 2 * column} ${table.y} V${table.y + table.height}" stroke="#111" stroke-width="2"/>
  <text x="84" y="154" font-family="sans-serif" font-size="20">Idea</text>
  <text x="148" y="154" font-family="sans-serif" font-size="20">Review</text>
  <text x="230" y="154" font-family="sans-serif" font-size="20">Ship</text>
  <circle cx="${circle.cx}" cy="${circle.cy}" r="${circle.radius}" fill="none" stroke="#111" stroke-width="3"/>
  <circle cx="${circle.cx}" cy="${circle.cy}" r="7" fill="#111"/>
  <path d="M${arrow.x} ${arrow.top} V${arrow.bottom} M${arrow.x} ${arrow.top + 21} L${arrow.x - 30} ${arrow.bottom} M${arrow.x} ${arrow.top + 21} L${arrow.x + 30} ${arrow.bottom}" stroke="#111" stroke-width="3" fill="none"/>
  <text x="65" y="${firstBaseline}" font-family="sans-serif" font-size="20">Goal: review the sample</text>
  <text x="65" y="${text.secondBaseline}" font-family="sans-serif" font-size="20">before publishing</text>
</svg>
`;
}
