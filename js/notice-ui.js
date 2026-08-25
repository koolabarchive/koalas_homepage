// 공지 작성 모달의 UI 위젯 모음 — Firebase 의존성이 없는 순수 UI 모듈
// (notice-form.js가 사용합니다. 분리해 둔 덕분에 단독 페이지에서도 테스트할 수 있습니다.)
//
// - createDropdown      : 애플 메뉴 스타일의 말머리 드롭다운 (키보드 접근성 포함)
// - setupScopeToggle    : 자물쇠 아이콘 공개 범위 토글 (열림/닫힘 모션)
// - setupMarkdownPreview: 쓰기 ↔ 미리보기 세그먼트 전환

import { renderMarkdown } from "./markdown-lite.js";

export const BADGE_OPTIONS = ["중요", "안내", "모집", "세미나", "행사"];

export const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const fmtSize = (b) => {
  if (b == null) return "";
  if (b < 1024) return b + "B";
  if (b < 1024 * 1024) return (b / 1024).toFixed(0) + "KB";
  return (b / (1024 * 1024)).toFixed(1) + "MB";
};

// ---------- 첨부 칩 (게시판·상세 공용) ----------
export function attachmentChips(atts, key) {
  if (!atts || !atts.length) return "";
  return `<div class="att-list">` + atts.map((a, i) => {
    const isImg = (a.type || "").startsWith("image/");
    return `<span class="att-chip">
      <button type="button" class="att-dl" data-att="${key}:${i}" title="다운로드">📎 ${esc(a.name)} <small>${fmtSize(a.size)}</small></button>
      ${isImg ? `<button type="button" class="att-view" data-view="${key}:${i}">미리보기</button>` : ""}
    </span>`;
  }).join("") + `</div><div class="att-previews" data-previews="${key}"></div>`;
}

// ---------- 공지 게시판 뷰 빌더 (목록 / 상세) ----------
// 데이터만 받아 HTML 문자열을 돌려줍니다. 이벤트 바인딩은 호출부 몫입니다.

const postMeta = (p) => [p.authorName, p.date].filter(Boolean).map(esc).join(" · ");
const badgeBits = (p) =>
  `${p.badge ? `<span class="badge">${esc(p.badge)}</span>` : ""}` +
  `${p.scope === "member" ? `<span class="scope-chip">멤버 전용</span>` : ""}`;

// 목록: 행을 누르면 상세로 이동합니다 (data-open에 글 id).
export function buildNoticeList(posts) {
  if (!posts.length) return '<p class="board-empty">등록된 공지가 없습니다.</p>';
  return posts.map((p) => `<div class="board-item">
    <button type="button" class="b-row" data-open="${p.id}">
      <span class="b-title">${badgeBits(p)}${esc(p.title)}${(p.attachments || []).length ? ` <span class="b-att">📎 ${(p.attachments || []).length}</span>` : ""}</span>
      <span class="b-meta">${postMeta(p)}</span>
    </button>
  </div>`).join("");
}

// 상세: 본문(마크다운) + 첨부 + (관리자) 수정·삭제 + 하단 다른 공지 5개 + 목록 버튼
export function buildNoticeDetail(p, others, { isAdmin = false } = {}) {
  return `
  <div class="nd-top">
    <button type="button" class="btn-sm nd-back" data-back>← 목록으로</button>
  </div>
  <article class="notice-detail">
    <header class="nd-head">
      <div class="nd-badges">${badgeBits(p)}</div>
      <h2 class="nd-title">${esc(p.title)}</h2>
      <div class="nd-meta">${postMeta(p)}</div>
    </header>
    ${p.content ? `<div class="nd-body md-body">${renderMarkdown(p.content)}</div>` : ""}
    ${attachmentChips(p.attachments, p.id)}
    ${isAdmin ? `<div class="nd-actions">
      <button class="btn-sm" data-edit="${p.id}">수정</button>
      <button class="btn-sm danger" data-del="${p.id}">삭제</button>
    </div>` : ""}
  </article>
  ${others.length ? `<section class="nd-more">
    <h3>다른 공지</h3>
    <div class="board-list">${buildNoticeList(others)}</div>
  </section>` : ""}
  <div class="nd-bottom">
    <button type="button" class="btn-sm nd-back" data-back>목록으로</button>
  </div>`;
}

// 팝오버를 스크롤 컨테이너(.modal-body)에 잘리지 않게 fixed로 띄웁니다.
// 앵커 폭에 맞추고, 아래 공간이 부족하면 위로 뒤집습니다. gap: 앵커와의 간격(px).
function placePopover(anchor, pop, gap = 8) {
  const r = anchor.getBoundingClientRect();
  pop.style.position = "fixed";
  pop.style.left = r.left + "px";
  pop.style.width = r.width + "px";
  pop.style.zIndex = "300";
  // 높이를 재기 위해 일단 보이게 한 뒤 위치 결정
  const h = pop.offsetHeight;
  const below = window.innerHeight - r.bottom;
  if (below < h + gap + 12 && r.top > h + gap + 12) {
    pop.style.top = (r.top - h - gap) + "px";
    pop.classList.add("above");
  } else {
    pop.style.top = (r.bottom + gap) + "px";
    pop.classList.remove("above");
  }
}
// 스크롤·리사이즈 시 팝오버를 닫습니다 (fixed 배치라 따라가지 못하므로).
// 단, 팝오버 자신의 내부 스크롤은 닫힘 사유가 아닙니다.
function closeOnScroll(closeFn, pop) {
  const h = (e) => { if (e && e.target instanceof Node && pop.contains(e.target)) return; closeFn(); };
  window.addEventListener("resize", h);
  document.addEventListener("scroll", h, true);
  return () => { window.removeEventListener("resize", h); document.removeEventListener("scroll", h, true); };
}

// 중요: 팝오버는 body로 옮겨(portal) 띄웁니다.
// 모달의 backdrop-filter가 fixed 요소의 기준 박스를 모달로 바꿔버려,
// 모달 안에 두면 좌표가 모달 위치만큼 밀립니다.
function portal(el) { document.body.appendChild(el); return el; }

const CHECK_SVG =
  '<svg class="dd-check" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5l3 3 6-6.5"/></svg>';
const CHEVRON_SVG =
  '<svg class="dd-chevron" viewBox="0 0 12 8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 1.5L6 6l4.5-4.5"/></svg>';

// ---------- 애플 스타일 드롭다운 ----------
// host(빈 div)에 버튼 + 리스트박스를 만들어 넣습니다.
// values: 문자열 배열. 빈 문자열("")은 "없음"으로 표시됩니다.
export function createDropdown(host, { values = [], emptyLabel = "없음", onChange } = {}) {
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const label = (v) => (v === "" ? emptyLabel : v);

  let opts = ["", ...values.filter((v) => v !== "")];
  let value = "";
  let activeIdx = 0; // 키보드 탐색 위치

  host.classList.add("dd");
  host.innerHTML = `
    <button type="button" class="dd-btn" aria-haspopup="listbox" aria-expanded="false">
      <span class="dd-value"></span>${CHEVRON_SVG}
    </button>
    <ul class="dd-menu" role="listbox" tabindex="-1" hidden></ul>`;
  const btn = host.querySelector(".dd-btn");
  const menu = portal(host.querySelector(".dd-menu"));
  const valueEl = host.querySelector(".dd-value");

  function renderMenu() {
    menu.innerHTML = opts.map((v, i) =>
      `<li role="option" data-i="${i}" aria-selected="${v === value}">${CHECK_SVG}<span>${esc(label(v))}</span></li>`
    ).join("");
    menu.querySelectorAll("li").forEach((li) => {
      li.addEventListener("click", () => select(Number(li.dataset.i)));
      li.addEventListener("mousemove", () => setActive(Number(li.dataset.i)));
    });
    valueEl.textContent = label(value);
    host.classList.toggle("dd-empty", value === "");
  }

  function setActive(i) {
    activeIdx = Math.max(0, Math.min(opts.length - 1, i));
    const items = menu.querySelectorAll("li");
    items.forEach((li, j) => li.classList.toggle("active", j === activeIdx));
    // scrollIntoView는 조상(.modal-body)까지 스크롤시켜 메뉴가 닫히므로 메뉴 내부만 조정
    const li = items[activeIdx];
    if (li) {
      if (li.offsetTop < menu.scrollTop) menu.scrollTop = li.offsetTop;
      else if (li.offsetTop + li.offsetHeight > menu.scrollTop + menu.clientHeight)
        menu.scrollTop = li.offsetTop + li.offsetHeight - menu.clientHeight;
    }
  }

  let stopScroll = null;
  function openMenu() {
    menu.hidden = false;
    placePopover(btn, menu, 6);
    btn.setAttribute("aria-expanded", "true");
    host.classList.add("open");
    menu.classList.add("open");
    setActive(Math.max(0, opts.indexOf(value)));
    stopScroll = closeOnScroll(closeMenu, menu);
  }
  function closeMenu() {
    host.classList.remove("open");
    menu.classList.remove("open");
    btn.setAttribute("aria-expanded", "false");
    if (stopScroll) { stopScroll(); stopScroll = null; }
    // 닫힘 트랜지션이 끝난 뒤 hidden 처리 (모션 유지)
    setTimeout(() => { if (!host.classList.contains("open")) menu.hidden = true; }, 160);
  }
  const isOpen = () => host.classList.contains("open");

  function select(i) {
    value = opts[i] ?? "";
    renderMenu();
    closeMenu();
    btn.focus();
    onChange && onChange(value);
  }

  btn.addEventListener("click", () => (isOpen() ? closeMenu() : openMenu()));
  btn.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (!isOpen()) openMenu(); else setActive(activeIdx + (e.key === "ArrowDown" ? 1 : -1)); }
    else if ((e.key === "Enter" || e.key === " ") && isOpen()) { e.preventDefault(); select(activeIdx); }
    else if (e.key === "Escape" && isOpen()) { e.preventDefault(); closeMenu(); }
  });
  document.addEventListener("click", (e) => {
    if (isOpen() && !host.contains(e.target) && !menu.contains(e.target)) closeMenu();
  });

  renderMenu();

  return {
    get: () => value,
    // 목록에 없는 값(과거 글의 자유 입력 말머리)은 옵션으로 추가해 잃지 않습니다.
    set: (v) => {
      value = String(v ?? "").trim();
      if (value && !opts.includes(value)) opts = ["", value, ...opts.slice(1)];
      renderMenu();
    },
  };
}

// ---------- 물음표(?) 도움말 팝오버 ----------
// 원형 ? 버튼을 누르면 설명 팝오버가 뜨고, 바깥 클릭·Esc·재클릭·스크롤로 닫힙니다.
// 팝오버는 body로 portal (모달 backdrop-filter의 fixed 기준 박스 문제 회피).
export function attachHelpTip(btn, html) {
  const pop = portal(document.createElement("div"));
  pop.className = "help-pop";
  pop.setAttribute("role", "tooltip");
  pop.innerHTML = html;
  pop.hidden = true;
  btn.setAttribute("aria-expanded", "false");

  let stopScroll = null;
  const isOpen = () => !pop.hidden;

  function open() {
    pop.hidden = false;
    pop.style.position = "fixed";
    pop.style.zIndex = "300";
    const w = Math.min(300, window.innerWidth - 24);
    pop.style.width = w + "px";
    const r = btn.getBoundingClientRect();
    // 버튼 중앙 정렬 후 화면 안으로 클램프
    const left = Math.min(Math.max(12, r.left + r.width / 2 - w / 2), window.innerWidth - w - 12);
    pop.style.left = left + "px";
    const h = pop.offsetHeight;
    if (window.innerHeight - r.bottom < h + 20 && r.top > h + 20) {
      pop.style.top = (r.top - h - 8) + "px";
      pop.classList.add("above");
    } else {
      pop.style.top = (r.bottom + 8) + "px";
      pop.classList.remove("above");
    }
    pop.classList.add("open");
    btn.setAttribute("aria-expanded", "true");
    stopScroll = closeOnScroll(close, pop);
  }
  function close() {
    pop.classList.remove("open");
    btn.setAttribute("aria-expanded", "false");
    if (stopScroll) { stopScroll(); stopScroll = null; }
    setTimeout(() => { if (!pop.classList.contains("open")) pop.hidden = true; }, 160);
  }

  btn.addEventListener("click", (e) => { e.stopPropagation(); isOpen() ? close() : open(); });
  btn.addEventListener("keydown", (e) => { if (e.key === "Escape" && isOpen()) { e.preventDefault(); close(); } });
  document.addEventListener("click", (e) => {
    if (isOpen() && !pop.contains(e.target) && e.target !== btn) close();
  });

  return { close };
}

// ---------- 자물쇠 공개 범위 토글 ----------
// btn 안의 .lock-shackle이 열리고 닫히는 모션과 함께
// 라벨(전체공개/멤버공개)과 hidden input 값("공개"/"멤버 전용")을 동기화합니다.
export function setupScopeToggle(btn, labelEl, hiddenInput, { onChange } = {}) {
  function set(memberOnly, { animate = true } = {}) {
    if (!animate) btn.classList.add("no-motion");
    btn.classList.toggle("locked", memberOnly);
    btn.setAttribute("aria-pressed", memberOnly ? "true" : "false");
    btn.setAttribute("aria-label", memberOnly ? "멤버공개 — 누르면 전체공개로 전환" : "전체공개 — 누르면 멤버공개로 전환");
    labelEl.textContent = memberOnly ? "멤버공개" : "전체공개";
    hiddenInput.value = memberOnly ? "멤버 전용" : "공개";
    if (!animate) requestAnimationFrame(() => btn.classList.remove("no-motion"));
  }
  btn.addEventListener("click", () => {
    const next = !btn.classList.contains("locked");
    set(next);
    onChange && onChange(next);
  });
  set(false, { animate: false });
  return { set, get: () => btn.classList.contains("locked") };
}

// ---------- 쓰기 ↔ 미리보기 ----------
export function setupMarkdownPreview({ writeBtn, previewBtn, textarea, preview }) {
  function mode(showPreview) {
    writeBtn.classList.toggle("active", !showPreview);
    previewBtn.classList.toggle("active", showPreview);
    writeBtn.setAttribute("aria-selected", String(!showPreview));
    previewBtn.setAttribute("aria-selected", String(showPreview));
    textarea.hidden = showPreview;
    preview.hidden = !showPreview;
    if (showPreview) {
      const src = textarea.value.trim();
      preview.innerHTML = src
        ? renderMarkdown(src)
        : '<p class="preview-empty">미리볼 내용이 없습니다. 쓰기 탭에서 내용을 입력해 주세요.</p>';
    }
  }
  writeBtn.addEventListener("click", () => mode(false));
  previewBtn.addEventListener("click", () => mode(true));
  return { reset: () => mode(false) };
}

// ---------- 애플 스타일 데이트피커 ----------
// host(빈 div)에 버튼 + 글래스 달력 팝오버를 만들고,
// hiddenInput에는 항상 ISO("2026-08-25") 값을 유지합니다 (저장 로직 호환).
export function createDatePicker(host, hiddenInput) {
  const pad = (n) => String(n).padStart(2, "0");
  const toIso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
  const fmt = (iso) => {
    const [y, m, d] = iso.split("-").map(Number);
    return `${y}. ${pad(m)}. ${pad(d)}.`;
  };
  const todayIso = () => { const t = new Date(); return toIso(t.getFullYear(), t.getMonth(), t.getDate()); };

  let value = todayIso();
  let view = { y: 0, m: 0 };   // 팝오버에 보이는 연·월

  host.classList.add("dp");
  host.innerHTML = `
    <button type="button" class="dp-btn" aria-haspopup="dialog" aria-expanded="false">
      <span class="dp-value"></span>
      <svg class="dp-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
        <rect x="2.75" y="4" width="14.5" height="13" rx="2.5"/>
        <path d="M2.75 8.4h14.5M6.6 2.4v3.2M13.4 2.4v3.2" stroke-linecap="round"/>
      </svg>
    </button>
    <div class="dp-pop" role="dialog" aria-label="날짜 선택" hidden>
      <div class="dp-head">
        <span class="dp-title"></span>
        <span class="dp-nav">
          <button type="button" class="dp-prev" aria-label="이전 달"><svg viewBox="0 0 8 12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6.2 1.5L1.8 6l4.4 4.5"/></svg></button>
          <button type="button" class="dp-next" aria-label="다음 달"><svg viewBox="0 0 8 12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M1.8 1.5L6.2 6l-4.4 4.5"/></svg></button>
        </span>
      </div>
      <div class="dp-week">${["일","월","화","수","목","금","토"].map((w, i) => `<span${i === 0 ? ' class="sun"' : ""}>${w}</span>`).join("")}</div>
      <div class="dp-grid"></div>
    </div>`;

  const btn = host.querySelector(".dp-btn");
  const pop = portal(host.querySelector(".dp-pop"));
  const valueEl = host.querySelector(".dp-value");
  const titleEl = pop.querySelector(".dp-title");
  const grid = pop.querySelector(".dp-grid");
  let stopScroll = null;

  function renderGrid() {
    titleEl.textContent = `${view.y}년 ${view.m + 1}월`;
    const first = new Date(view.y, view.m, 1);
    const start = new Date(view.y, view.m, 1 - first.getDay());   // 그 주의 일요일부터
    const today = todayIso();
    let html = "";
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const iso = toIso(d.getFullYear(), d.getMonth(), d.getDate());
      const cls = [
        d.getMonth() !== view.m ? "out" : "",
        iso === value ? "sel" : "",
        iso === today ? "today" : "",
        d.getDay() === 0 ? "sun" : "",
      ].filter(Boolean).join(" ");
      html += `<button type="button" data-iso="${iso}"${cls ? ` class="${cls}"` : ""}>${d.getDate()}</button>`;
    }
    grid.innerHTML = html;
    grid.querySelectorAll("button").forEach((b) => {
      b.addEventListener("click", () => { setValue(b.dataset.iso); close(); btn.focus(); });
    });
  }

  function setValue(iso) {
    value = /^\d{4}-\d{2}-\d{2}$/.test(iso || "") ? iso : todayIso();
    hiddenInput.value = value;
    valueEl.textContent = fmt(value);
    const [y, m] = value.split("-").map(Number);
    view = { y, m: m - 1 };
  }

  const isOpen = () => host.classList.contains("open");
  function open() {
    renderGrid();
    pop.hidden = false;
    placePopover(btn, pop, 8);
    host.classList.add("open");
    pop.classList.add("open");
    btn.setAttribute("aria-expanded", "true");
    stopScroll = closeOnScroll(close, pop);
  }
  function close() {
    host.classList.remove("open");
    pop.classList.remove("open");
    btn.setAttribute("aria-expanded", "false");
    if (stopScroll) { stopScroll(); stopScroll = null; }
    setTimeout(() => { if (!isOpen()) pop.hidden = true; }, 160);
  }

  btn.addEventListener("click", () => (isOpen() ? close() : open()));
  btn.addEventListener("keydown", (e) => { if (e.key === "Escape" && isOpen()) close(); });
  pop.addEventListener("keydown", (e) => { if (e.key === "Escape") { close(); btn.focus(); } });
  pop.querySelector(".dp-prev").addEventListener("click", () => { view.m--; if (view.m < 0) { view.m = 11; view.y--; } renderGrid(); });
  pop.querySelector(".dp-next").addEventListener("click", () => { view.m++; if (view.m > 11) { view.m = 0; view.y++; } renderGrid(); });
  document.addEventListener("click", (e) => {
    if (isOpen() && !host.contains(e.target) && !pop.contains(e.target)) close();
  });

  setValue(todayIso());
  return { get: () => value, set: setValue };
}
