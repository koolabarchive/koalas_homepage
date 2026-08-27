// 회원 관리 표: 처리 버튼을 평소엔 접어 두고, 행을 왼쪽으로 드래그(마우스)
// 하거나 스와이프(터치)하면 유리 트레이로 나타나는 모바일식 UI.
// 데스크톱·모바일 공통 동작이며, 행 오른쪽 끝의 ⋯ 버튼으로도 열 수 있습니다.
// 행이 다시 그려져도(실시간 갱신) MutationObserver가 자동으로 다시 감쌉니다.

(function () {
  const table = document.getElementById("member-table");
  if (!table) return;
  table.classList.add("swipe-actions");
  const tbody = table.querySelector("tbody");

  // 처리 셀의 버튼들을 트레이로 감싸고 ⋯ 손잡이를 추가
  function wrapCells() {
    tbody.querySelectorAll("td.cell-actions").forEach((td) => {
      if (td.querySelector(".row-tray") || !td.querySelector("button")) return;
      const tray = document.createElement("div");
      tray.className = "row-tray";
      while (td.firstChild) tray.appendChild(td.firstChild);
      const more = document.createElement("button");
      more.type = "button";
      more.className = "row-more";
      more.setAttribute("aria-label", "처리 메뉴 열기");
      more.textContent = "⋯";
      td.appendChild(more);
      td.appendChild(tray);
    });
  }
  wrapCells();
  new MutationObserver(wrapCells).observe(tbody, { childList: true, subtree: true });

  const closeAll = (except) =>
    tbody.querySelectorAll("tr.swiped").forEach((r) => { if (r !== except) r.classList.remove("swiped"); });

  // ⋯ 버튼으로 열고 닫기 (드래그가 익숙하지 않은 사용자용 보조 수단)
  tbody.addEventListener("click", (e) => {
    const more = e.target.closest(".row-more");
    if (!more) return;
    e.stopPropagation();
    const tr = more.closest("tr");
    const wasOpen = tr.classList.contains("swiped");
    closeAll();
    tr.classList.toggle("swiped", !wasOpen);
  });

  // 왼쪽 드래그·스와이프 → 열기 / 오른쪽 → 닫기
  let start = null;
  tbody.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;
    const tr = e.target.closest("tr");
    if (!tr || !tr.querySelector(".row-tray")) return;
    start = { x: e.clientX, y: e.clientY, tr, done: false };
  });
  tbody.addEventListener("pointermove", (e) => {
    if (!start || start.done) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dy) > 24) { start.done = true; return; }   // 세로 스크롤 의도는 무시
    if (dx < -28) { closeAll(start.tr); start.tr.classList.add("swiped"); start.done = true; }
    else if (dx > 28) { start.tr.classList.remove("swiped"); start.done = true; }
    // 드래그로 생긴 텍스트 선택 잔상 제거
    if (start.done) { try { window.getSelection().removeAllRanges(); } catch (_) {} }
  });
  ["pointerup", "pointercancel"].forEach((t) => tbody.addEventListener(t, () => { start = null; }));

  // 표 밖을 클릭하면 닫기
  document.addEventListener("click", (e) => { if (!tbody.contains(e.target)) closeAll(); });
})();
