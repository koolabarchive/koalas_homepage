// 관리자 대시보드 차트 (외부 라이브러리 없이 인라인 SVG로 그립니다)
// 요약 카드 4개(멤버·프로젝트·성과·확인서)가 가리키는 내용을 각각
// 분포·추이 차트로 펼쳐 보여 줍니다.
//
// 설계 원칙
// - 단일 계열이므로 범례 없이 제목이 무엇을 그린 것인지 말합니다.
// - 크기 비교가 목적이므로 색은 한 가지 색조(사이트 강조색)만 씁니다.
//   막대 색은 정체성이 아니라 값의 크기를 나타냅니다.
// - 값 라벨은 막대 끝에 직접 붙이고, 눈금선은 가늘게 뒤로 물립니다.
// - 막대 두께 ≤ 22px, 값이 커지는 쪽 끝만 둥글게(4px), 기준선 쪽은 각지게.

const BAR_MAX = 22;      // 막대 최대 두께
const RADIUS = 4;        // 값 쪽 끝 라운드

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// 값이 커지는 쪽 끝만 둥근 막대 path (가로: 오른쪽 끝 / 세로: 위쪽 끝)
function barPath(x, y, w, h, dir) {
  const r = Math.min(RADIUS, dir === "h" ? w : h, dir === "h" ? h / 2 : w / 2);
  if (r <= 0.5) return `M${x} ${y}h${w}v${h}h${-w}z`;
  return dir === "h"
    ? `M${x} ${y}h${w - r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - r)}z`
    : `M${x} ${y + r}a${r} ${r} 0 0 1 ${r} ${-r}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - r}h${-w}z`;
}

const emptyHtml = (msg) =>
  `<p class="chart-empty">${esc(msg)}</p>`;

// ---------- 가로 막대 (분포 비교) ----------
// data: [{ label, value }]  — 위에서 아래로 나열, 값 라벨은 막대 끝에
export function barChart(box, data, { empty = "표시할 데이터가 없습니다.", unit = "" } = {}) {
  if (!box) return;
  const items = data.filter((d) => d.value > 0);
  if (!items.length) { box.innerHTML = emptyHtml(empty); return; }

  const W = 420, PAD_L = 96, PAD_R = 44, PAD_T = 6, PAD_B = 6;
  const rowH = 30;
  const H = PAD_T + PAD_B + rowH * items.length;
  const max = Math.max(...items.map((d) => d.value));
  const plotW = W - PAD_L - PAD_R;
  const barH = Math.min(BAR_MAX, rowH - 10);

  const marks = items.map((d, i) => {
    const y = PAD_T + i * rowH + (rowH - barH) / 2;
    const w = Math.max(2, (d.value / max) * plotW);
    return `<g class="ch-mark" tabindex="0" role="listitem"
        aria-label="${esc(d.label)} ${d.value}${esc(unit)}">
      <title>${esc(d.label)}: ${d.value}${esc(unit)}</title>
      <rect class="ch-hit" x="0" y="${PAD_T + i * rowH}" width="${W}" height="${rowH}" fill="transparent"></rect>
      <text class="ch-cat" x="${PAD_L - 10}" y="${y + barH / 2}" text-anchor="end" dominant-baseline="central">${esc(d.label)}</text>
      <path class="ch-bar" d="${barPath(PAD_L, y, w, barH, "h")}"></path>
      <text class="ch-val" x="${PAD_L + w + 8}" y="${y + barH / 2}" dominant-baseline="central">${d.value}${esc(unit)}</text>
    </g>`;
  }).join("");

  box.innerHTML = `<svg class="ch-svg" viewBox="0 0 ${W} ${H}" role="list" preserveAspectRatio="xMidYMid meet">
    <line class="ch-axis" x1="${PAD_L}" y1="${PAD_T}" x2="${PAD_L}" y2="${H - PAD_B}"></line>
    ${marks}
  </svg>`;
}

// ---------- 세로 막대 (연도별 추이) ----------
// data: [{ label, value }] — 왼쪽(과거) → 오른쪽(최근)
export function columnChart(box, data, { empty = "표시할 데이터가 없습니다.", unit = "" } = {}) {
  if (!box) return;
  if (!data.length || data.every((d) => !d.value)) { box.innerHTML = emptyHtml(empty); return; }

  const W = 420, H = 190, PAD_L = 8, PAD_R = 8, PAD_T = 24, PAD_B = 26;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const max = Math.max(...data.map((d) => d.value), 1);
  const slot = plotW / data.length;
  const barW = Math.min(BAR_MAX, slot - 12);
  const baseY = H - PAD_B;

  const marks = data.map((d, i) => {
    const h = d.value ? Math.max(2, (d.value / max) * plotH) : 0;
    const x = PAD_L + i * slot + (slot - barW) / 2;
    const y = baseY - h;
    return `<g class="ch-mark" tabindex="0" role="listitem" aria-label="${esc(d.label)} ${d.value}${esc(unit)}">
      <title>${esc(d.label)}: ${d.value}${esc(unit)}</title>
      <rect class="ch-hit" x="${PAD_L + i * slot}" y="${PAD_T}" width="${slot}" height="${plotH + PAD_B}" fill="transparent"></rect>
      ${h ? `<path class="ch-bar" d="${barPath(x, y, barW, h, "v")}"></path>` : ""}
      ${d.value ? `<text class="ch-val" x="${x + barW / 2}" y="${y - 7}" text-anchor="middle">${d.value}</text>` : ""}
      <text class="ch-cat" x="${x + barW / 2}" y="${baseY + 15}" text-anchor="middle">${esc(d.label)}</text>
    </g>`;
  }).join("");

  box.innerHTML = `<svg class="ch-svg" viewBox="0 0 ${W} ${H}" role="list" preserveAspectRatio="xMidYMid meet">
    <line class="ch-axis" x1="${PAD_L}" y1="${baseY}" x2="${W - PAD_R}" y2="${baseY}"></line>
    ${marks}
  </svg>`;
}

// 값 내림차순 + 0 제외로 집계 (라벨 순서를 지정하면 그 순서를 유지)
export function countBy(list, keyFn, order) {
  const counts = new Map();
  list.forEach((x) => {
    const k = keyFn(x);
    if (!k) return;
    counts.set(k, (counts.get(k) || 0) + 1);
  });
  if (order) {
    return order.filter((k) => counts.has(k)).map((k) => ({ label: k, value: counts.get(k) }));
  }
  return [...counts.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}
