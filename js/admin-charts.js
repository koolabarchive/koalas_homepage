// 관리자 대시보드 활동 그래프 (외부 라이브러리 없이 인라인 SVG)
//
// 하나의 누적 영역 차트에 멤버·프로젝트·성과·확인서 네 계열을 쌓아
// 연구실 활동이 시간에 따라 어떻게 늘어왔는지 보여 줍니다.
// 선 위에 마우스를 올리면 그 달의 세부 구성이 작은 팝업으로 뜹니다.
//
// 색 결정 근거
// - 계열이 4개인 "정체성" 인코딩이므로 범주형 팔레트를 씁니다.
// - 슬롯 순서(파랑→주황→아쿠아→노랑)는 색각 이상 판별 간격을 통과한 순서로,
//   임의로 섞지 않습니다. (검증: 인접쌍 CVD ΔE 9.1 라이트 / 8.4 다크)
// - 라이트 모드에서 아쿠아·노랑은 표면 대비가 3:1 미만이라 범례와 값 라벨을
//   반드시 함께 제공합니다(색만으로 구분하게 두지 않음).

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// 계열 정의 — 아래에서 위로 쌓이는 순서
export const SERIES = [
  { key: "members", label: "구성원", cls: "s1" },
  { key: "pubs", label: "연구 성과", cls: "s2" },
  { key: "projects", label: "프로젝트", cls: "s3" },
  { key: "certs", label: "확인서 발급", cls: "s4" },
];

// 최근 n개월의 { y, m, label } 목록 (오래된 → 최근)
export function recentMonths(n = 12, now = new Date()) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({
      y: d.getFullYear(),
      m: d.getMonth(),
      label: (d.getMonth() === 0 || i === n - 1) ? `${d.getFullYear()}.${d.getMonth() + 1}` : `${d.getMonth() + 1}`,
      full: `${d.getFullYear()}년 ${d.getMonth() + 1}월`,
    });
  }
  return out;
}

// Firestore Timestamp | Date | 문자열 → 해당 월 이하이면 true (누적 집계용)
function atOrBefore(ts, y, m) {
  let d = null;
  if (ts && typeof ts.toDate === "function") d = ts.toDate();
  else if (ts instanceof Date) d = ts;
  else if (typeof ts === "string") { const p = new Date(ts.replace(/\./g, "-")); if (!isNaN(p)) d = p; }
  if (!d) return true;   // 날짜를 모르는 예전 데이터는 이미 있던 것으로 취급
  return d.getFullYear() < y || (d.getFullYear() === y && d.getMonth() <= m);
}

// 월별 누적 건수 배열
export function cumulativeByMonth(list, months, dateOf = (x) => x.createdAt) {
  return months.map(({ y, m }) => list.filter((x) => atOrBefore(dateOf(x), y, m)).length);
}

// 부드러운 선 (Catmull-Rom → 베지어). 값이 급변해도 과장되지 않게 장력을 낮춥니다.
function smoothPath(pts) {
  if (pts.length < 2) return pts.length ? `M${pts[0][0]} ${pts[0][1]}` : "";
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const t = 0.18;
    d += ` C${p1[0] + (p2[0] - p0[0]) * t} ${p1[1] + (p2[1] - p0[1]) * t},`
      + ` ${p2[0] - (p3[0] - p1[0]) * t} ${p2[1] - (p3[1] - p1[1]) * t},`
      + ` ${p2[0]} ${p2[1]}`;
  }
  return d;
}

// 누적 영역 차트
// box: 컨테이너, months: recentMonths(), data: { members:[], pubs:[], projects:[], certs:[] }
export function activityChart(box, months, data) {
  if (!box) return;
  const total = SERIES.reduce((s, ser) => s + (data[ser.key] || []).reduce((a, b) => a + b, 0), 0);
  if (!months.length || !total) {
    box.innerHTML = '<p class="chart-empty">표시할 활동 데이터가 아직 없습니다.</p>';
    return;
  }

  const W = 760, H = 300;
  const PAD_L = 42, PAD_R = 16, PAD_T = 16, PAD_B = 34;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const n = months.length;
  const x = (i) => PAD_L + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);

  // 합계(팝업 표시용)와 y 스케일 (눈금은 깔끔한 수로 올림)
  // 선은 쌓지 않고 각 계열의 누적값을 그대로 그립니다.
  const stackTops = months.map((_, i) => SERIES.reduce((s, ser) => s + (data[ser.key]?.[i] || 0), 0));
  const rawMax = Math.max(1, ...SERIES.map((ser) => Math.max(...months.map((_, i) => data[ser.key]?.[i] || 0))));
  const step = Math.max(1, Math.ceil(rawMax / 4 / 5) * 5);
  const yMax = step * 4;
  const y = (v) => PAD_T + plotH - (v / yMax) * plotH;

  // 각 계열의 좌표
  const bands = SERIES.map((ser) => {
    const values = months.map((_, i) => data[ser.key]?.[i] || 0);
    return { ...ser, values, upperPts: values.map((v, i) => [x(i), y(v)]) };
  });

  const gridLines = Array.from({ length: 5 }, (_, k) => {
    const v = step * k;
    return `<g><line class="ch-grid" x1="${PAD_L}" y1="${y(v)}" x2="${W - PAD_R}" y2="${y(v)}"></line>
      <text class="ch-tick" x="${PAD_L - 8}" y="${y(v)}" text-anchor="end" dominant-baseline="central">${v}</text></g>`;
  }).join("");

  // 월 라벨은 2개월 간격으로만 (겹침 방지)
  const xLabels = months.map((mo, i) =>
    (i % 2 === 0 || i === n - 1)
      ? `<text class="ch-tick" x="${x(i)}" y="${H - PAD_B + 16}" text-anchor="middle">${esc(mo.label)}</text>` : ""
  ).join("");

  // 계열별 선 (면 채움 없음)
  const lines = bands.map((b) =>
    `<path class="ch-line ${b.cls}" d="${smoothPath(b.upperPts)}"></path>`).join("");

  // 마우스 위치용 히트 영역 + 크로스헤어 + 각 계열의 점
  const dots = bands.map((b) => `<circle class="ch-dot ${b.cls}" r="4.5" cx="0" cy="0" style="display:none;"></circle>`).join("");

  box.innerHTML = `
    <div class="ch-wrap">
      <svg class="ch-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img"
           aria-label="최근 ${n}개월 구성원·연구 성과·프로젝트·확인서 누적 추이">
        ${gridLines}
        ${lines}
        <line class="ch-cross" x1="0" y1="${PAD_T}" x2="0" y2="${PAD_T + plotH}" style="display:none;"></line>
        ${dots}
        ${xLabels}
        <rect class="ch-hit" x="${PAD_L}" y="${PAD_T}" width="${plotW}" height="${plotH}" fill="transparent"></rect>
      </svg>
      <div class="ch-tip" hidden></div>
    </div>
    <ul class="ch-legend">
      ${bands.map((b) => `<li><span class="ch-key ${b.cls}"></span>${esc(b.label)}
        <strong>${b.values[n - 1]}</strong></li>`).join("")}
    </ul>`;

  // ---------- 상호작용: 가까운 달을 찾아 크로스헤어·팝업 표시 ----------
  const svg = box.querySelector(".ch-svg");
  const wrap = box.querySelector(".ch-wrap");
  const tip = box.querySelector(".ch-tip");
  const cross = box.querySelector(".ch-cross");
  const dotEls = [...box.querySelectorAll(".ch-dot")];

  function show(i, clientX) {
    const mo = months[i];
    cross.setAttribute("x1", x(i));
    cross.setAttribute("x2", x(i));
    cross.style.display = "";
    bands.forEach((b, k) => {
      dotEls[k].setAttribute("cx", x(i));
      dotEls[k].setAttribute("cy", b.upperPts[i][1]);
      dotEls[k].style.display = "";
    });
    tip.innerHTML = `<div class="ch-tip-head">${esc(mo.full)}</div>` +
      bands.map((b) =>
        `<div class="ch-tip-row"><span class="ch-key ${b.cls}"></span>${esc(b.label)}<strong>${b.values[i]}</strong></div>`).join("") +
      `<div class="ch-tip-total">합계<strong>${stackTops[i]}</strong></div>`;
    tip.hidden = false;
    // 팝업은 커서를 따라가되 컨테이너 밖으로 나가지 않게
    const wrapBox = wrap.getBoundingClientRect();
    const tipW = tip.offsetWidth;
    let left = (clientX - wrapBox.left) + 14;
    if (left + tipW > wrapBox.width) left = (clientX - wrapBox.left) - tipW - 14;
    tip.style.left = Math.max(4, left) + "px";
  }
  function hide() {
    cross.style.display = "none";
    dotEls.forEach((d) => (d.style.display = "none"));
    tip.hidden = true;
  }

  const nearestIndex = (clientX) => {
    const r = svg.getBoundingClientRect();
    const vx = ((clientX - r.left) / r.width) * W;
    let best = 0, bestD = Infinity;
    months.forEach((_, i) => {
      const d = Math.abs(x(i) - vx);
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  };

  svg.addEventListener("pointermove", (e) => show(nearestIndex(e.clientX), e.clientX));
  svg.addEventListener("pointerleave", hide);
  svg.addEventListener("pointerdown", (e) => show(nearestIndex(e.clientX), e.clientX));
}
