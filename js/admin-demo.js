// 관리자 화면 데모 스크립트
// 패널 전환 + 승인/발급 버튼의 화면상 동작을 시연합니다.
// 실제 저장은 Firebase 연동 단계에서 Firestore 업데이트로 대체됩니다.

(function () {
  const navButtons = document.querySelectorAll(".admin-nav button");
  const panels = document.querySelectorAll(".admin-panel");
  if (!navButtons.length) return;

  // 패널 전환
  navButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      navButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      panels.forEach((p) => p.classList.remove("active"));
      document.getElementById("panel-" + btn.dataset.panel).classList.add("active");
    });
  });

  const setStatus = (row, text, cls) => {
    const badge = row.querySelector(".status");
    badge.textContent = text;
    badge.className = "status " + cls;
    row.querySelector(".cell-actions").innerHTML = "";
  };

  // 회원 승인 / 거절
  document.querySelectorAll("#member-table .act-approve").forEach((btn) => {
    btn.addEventListener("click", () => setStatus(btn.closest("tr"), "멤버", "member"));
  });
  document.querySelectorAll("#member-table .act-reject, #cert-table .act-reject").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (confirm("정말 거절(반려)하시겠습니까?")) setStatus(btn.closest("tr"), "거절됨", "rejected");
    });
  });

  // 성과 승인
  document.querySelectorAll("#pub-table .act-approve").forEach((btn) => {
    btn.addEventListener("click", () => setStatus(btn.closest("tr"), "게시 중", "approved"));
  });

  // 확인서 발급 — 발급번호 채번 시연
  let certSeq = 19; // 데모용 시작 번호
  document.querySelectorAll("#cert-table .act-issue").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (window.__FB_ADMIN__) return;
      const row = btn.closest("tr");
      const no = "HJK-2026-" + String(certSeq++).padStart(4, "0");
      row.cells[0].textContent = no;
      setStatus(row, "발급 완료", "issued");
      const cell = row.querySelector(".cell-actions");
      const dl = document.createElement("button");
      dl.className = "btn-sm";
      dl.textContent = "PDF 다시 받기";
      cell.appendChild(dl);
      alert("발급 완료 (데모)\n발급번호: " + no + "\n\n실제 연동 시 이 시점에 한글 폰트가 임베드된 PDF가 생성되고 발급 대장(Firestore)에 기록됩니다.");
    });
  });
})();

// ===== 사이트 설정 (홈 문구 편집) =====
(function () {
  if (!window.ContentStore) return;
  const $ = (id) => document.getElementById(id);
  if (!$("site-save")) return;

  const msg = (el, text, type) => {
    el.textContent = text;
    el.className = "form-msg " + type;
    setTimeout(() => (el.className = "form-msg"), 3000);
  };

  function fillSiteForm() {
    const cfg = ContentStore.load();
    $("site-eyebrow").value = cfg.hero.eyebrow;
    $("site-title").value = cfg.hero.title;
    $("site-desc").value = cfg.hero.desc;
  }
  fillSiteForm();

  $("site-save").addEventListener("click", () => {
    const cfg = ContentStore.load();
    cfg.hero.eyebrow = $("site-eyebrow").value.trim();
    cfg.hero.title = $("site-title").value.trim();
    cfg.hero.desc = $("site-desc").value.trim();
    ContentStore.save(cfg);
    msg($("site-msg"), "저장되었습니다. 홈 화면을 새로고침하면 반영됩니다.", "ok");
  });

  $("site-reset").addEventListener("click", () => {
    if (!confirm("홈 문구를 기본값으로 되돌릴까요?")) return;
    const cfg = ContentStore.load();
    cfg.hero = structuredClone(ContentStore.DEFAULTS.hero);
    ContentStore.save(cfg);
    fillSiteForm();
    msg($("site-msg"), "기본값으로 되돌렸습니다.", "ok");
  });
})();

// ===== 메뉴 관리 =====
(function () {
  if (!window.ContentStore) return;
  const $ = (id) => document.getElementById(id);
  const editor = $("menu-editor");
  if (!editor) return;

  let nav = ContentStore.load().nav;
  $("menu-login-label").value = ContentStore.load().loginLabel;

  const msg = (text, type) => {
    const el = $("menu-msg");
    el.textContent = text;
    el.className = "form-msg " + type;
    setTimeout(() => (el.className = "form-msg"), 3000);
  };

  function render() {
    editor.innerHTML = "";
    nav.forEach((item, i) => {
      const row = document.createElement("div");
      row.className = "menu-row";
      row.innerHTML = `
        <input type="text" value="${item.label.replace(/"/g, "&quot;")}" placeholder="메뉴 이름" data-field="label" />
        <input type="text" value="${item.href.replace(/"/g, "&quot;")}" placeholder="링크 (예: gallery.html)" data-field="href" />
        <label class="visible-toggle"><input type="checkbox" ${item.visible !== false ? "checked" : ""} data-field="visible" /> 표시</label>
        <div class="row-btns">
          <button type="button" data-act="up" title="위로">↑</button>
          <button type="button" data-act="down" title="아래로">↓</button>
          <button type="button" data-act="del" title="삭제">✕</button>
        </div>`;

      row.querySelector('[data-field="label"]').addEventListener("input", (e) => (nav[i].label = e.target.value));
      row.querySelector('[data-field="href"]').addEventListener("input", (e) => (nav[i].href = e.target.value));
      row.querySelector('[data-field="visible"]').addEventListener("change", (e) => (nav[i].visible = e.target.checked));
      row.querySelector('[data-act="up"]').addEventListener("click", () => {
        if (i === 0) return;
        [nav[i - 1], nav[i]] = [nav[i], nav[i - 1]];
        render();
      });
      row.querySelector('[data-act="down"]').addEventListener("click", () => {
        if (i === nav.length - 1) return;
        [nav[i + 1], nav[i]] = [nav[i], nav[i + 1]];
        render();
      });
      row.querySelector('[data-act="del"]').addEventListener("click", () => {
        if (confirm('"' + nav[i].label + '" 메뉴를 삭제할까요?')) {
          nav.splice(i, 1);
          render();
        }
      });
      editor.appendChild(row);
    });
  }
  render();

  $("menu-add").addEventListener("click", () => {
    nav.push({ label: "새 메뉴", href: "", visible: true });
    render();
  });

  $("menu-save").addEventListener("click", () => {
    const invalid = nav.find((n) => n.visible !== false && (!n.label.trim() || !n.href.trim()));
    if (invalid) {
      msg("표시 중인 메뉴에는 이름과 링크를 모두 입력해야 합니다.", "error");
      return;
    }
    const cfg = ContentStore.load();
    cfg.nav = nav;
    cfg.loginLabel = $("menu-login-label").value.trim() || "멤버 로그인";
    ContentStore.save(cfg);
    msg("저장되었습니다. 공개 페이지를 새로고침하면 메뉴에 반영됩니다.", "ok");
  });

  $("menu-reset").addEventListener("click", () => {
    if (!confirm("메뉴 구성을 기본값으로 되돌릴까요?")) return;
    nav = structuredClone(ContentStore.DEFAULTS.nav);
    const cfg = ContentStore.load();
    cfg.nav = nav;
    cfg.loginLabel = ContentStore.DEFAULTS.loginLabel;
    ContentStore.save(cfg);
    $("menu-login-label").value = cfg.loginLabel;
    render();
    msg("기본값으로 되돌렸습니다.", "ok");
  });
})();

// ===== 게시글 수정 모달 (공지 관리 데모) =====
(function () {
  const modal = document.getElementById("edit-modal");
  if (!modal) return;

  let targetRow = null;

  const open = (row) => {
    targetRow = row;
    document.getElementById("edit-title").value = row.cells[0].textContent.trim();
    document.getElementById("edit-date").value = row.cells[1].textContent.trim();
    const scope = row.cells[2].textContent.trim();
    document.getElementById("edit-scope").value = scope.includes("멤버") ? "멤버 전용" : "공개";
    modal.classList.add("open");
  };
  const close = () => {
    modal.classList.remove("open");
    targetRow = null;
  };

  document.querySelectorAll("#panel-notices .act-edit").forEach((btn) => {
    btn.addEventListener("click", () => open(btn.closest("tr")));
  });

  document.getElementById("edit-cancel").addEventListener("click", close);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

  document.getElementById("edit-save").addEventListener("click", () => {
    if (window.__FB_ADMIN__) return;
    if (!targetRow) return;
    targetRow.cells[0].textContent = document.getElementById("edit-title").value.trim();
    targetRow.cells[1].textContent = document.getElementById("edit-date").value.trim();
    const scope = document.getElementById("edit-scope").value;
    const badge = targetRow.cells[2].querySelector(".status");
    if (badge) {
      badge.textContent = scope === "공개" ? "공개" : "멤버 전용";
      badge.className = "status " + (scope === "공개" ? "approved" : "member");
    }
    close();
    alert("수정 완료 (데모)\n실제 연동 시 Firestore posts 문서가 업데이트되고 공개 사이트에 즉시 반영됩니다.");
  });
})();

// ===== 회원 직접 등록 =====
(function () {
  const modal = document.getElementById("member-modal");
  const openBtn = document.getElementById("btn-add-member");
  if (!modal || !openBtn) return;

  const escHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const $ = (id) => document.getElementById(id);
  const today = () => {
    const d = new Date();
    return d.getFullYear() + "." + String(d.getMonth() + 1).padStart(2, "0") + "." + String(d.getDate()).padStart(2, "0");
  };

  const open = () => {
    $("m-name").value = "";
    $("m-email").value = "";
    $("m-affil").selectedIndex = 0;
    $("m-role").value = "member";
    $("member-modal-msg").className = "form-msg";
    modal.classList.add("open");
    $("m-name").focus();
  };
  const close = () => modal.classList.remove("open");

  openBtn.addEventListener("click", open);
  $("member-cancel").addEventListener("click", close);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });

  $("member-save").addEventListener("click", () => {
    if (window.__FB_ADMIN__) return;
    const name = $("m-name").value.trim();
    const email = $("m-email").value.trim();
    const msg = $("member-modal-msg");
    if (!name || !email) {
      msg.textContent = "이름과 이메일을 입력해 주세요.";
      msg.className = "form-msg error";
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      msg.textContent = "이메일 형식을 확인해 주세요.";
      msg.className = "form-msg error";
      return;
    }

    const isAdmin = $("m-role").value === "admin";
    const tbody = document.querySelector("#member-table tbody");
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escHtml(name)}</td>
      <td>${$("m-affil").value}</td>
      <td>${escHtml(email)}</td>
      <td>${today()}</td>
      <td><span class="status ${isAdmin ? "issued" : "member"}">${isAdmin ? "관리자" : "멤버"}</span></td>
      <td class="cell-actions"><button class="btn-sm">권한 변경</button></td>`;
    tbody.prepend(tr);
    close();
    alert("등록 완료 (데모)\n실제 연동 시 Firestore users에 사전 등록되며, 본인이 이 이메일로 가입하면 자동 승인됩니다.");
  });
})();

// ===== 성과 직접 등록 =====
(function () {
  const modal = document.getElementById("pub-modal");
  const openBtn = document.getElementById("btn-add-pub");
  if (!modal || !openBtn) return;

  const $ = (id) => document.getElementById(id);
  const escHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");


  const open = () => {
    $("p-title").value = "";
    ["p-authors", "p-venue", "p-volume", "p-link"].forEach((i) => { const el = $(i); if (el) el.value = ""; });
    const pf = $("p-file"); if (pf) pf.value = "";
    $("p-year").value = String(new Date().getFullYear());
    $("p-type").selectedIndex = 0;
    $("p-visible").value = "게시";
    $("pub-modal-msg").className = "form-msg";
    modal.classList.add("open");
    $("p-title").focus();
  };
  const close = () => modal.classList.remove("open");

  openBtn.addEventListener("click", open);
  $("pub-cancel").addEventListener("click", close);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });

  $("pub-save").addEventListener("click", () => {
    if (window.__FB_ADMIN__) return; // 실연동 활성 시 양보 (없으면 실제 저장 + 데모 알림이 이중 실행됨)
    const title = $("p-title").value.trim();
    const msg = $("pub-modal-msg");
    if (!title) {
      msg.textContent = "제목을 입력해 주세요.";
      msg.className = "form-msg error";
      return;
    }

    const visible = $("p-visible").value === "게시";
    const meta = [$("p-authors"), $("p-venue"), $("p-volume")].map((el) => (el ? el.value.trim() : "")).filter(Boolean).join(" · ");
    const tbody = document.querySelector("#pub-table tbody");
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${$("p-type").value}</td>
      <td>${escHtml(title)}${meta ? ' <span class="sub">' + escHtml(meta) + "</span>" : ""}</td>
      <td>관리자 등록</td>
      <td><span class="status ${visible ? "approved" : "member"}">${visible ? "게시 중" : "비공개"}</span></td>
      <td class="cell-actions"><button class="btn-sm">${visible ? "비공개 전환" : "게시하기"}</button></td>`;
    tbody.prepend(tr);
    close();
    alert("등록 완료 (데모)\n실제 연동 시 Firestore publications에 저장되고" + (visible ? " 공개 사이트 성과 페이지에 즉시 게시됩니다." : " 내부 기록으로만 보관됩니다."));
  });
})();

// ===== 연구분야 관리 =====
(function () {
  if (!window.ContentStore) return;
  const $ = (id) => document.getElementById(id);
  const editor = $("research-editor");
  if (!editor) return;

  let areas = ContentStore.load().research;

  const msg = (text, type) => {
    const el = $("research-msg");
    el.textContent = text;
    el.className = "form-msg " + type;
    setTimeout(() => (el.className = "form-msg"), 3000);
  };

  const attr = (v) => String(v || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

  function render() {
    editor.innerHTML = "";
    areas.forEach((a, i) => {
      const row = document.createElement("div");
      row.className = "area-row";
      row.innerHTML = `
        <div class="area-head">
          <input type="text" value="${attr(a.tag)}" placeholder="태그 (예: CBT)" data-field="tag" />
          <input type="text" value="${attr(a.title)}" placeholder="연구분야 제목" data-field="title" />
          <div class="row-btns">
            <button type="button" data-act="up" title="위로">↑</button>
            <button type="button" data-act="down" title="아래로">↓</button>
            <button type="button" data-act="del" title="삭제">✕</button>
          </div>
        </div>
        <textarea rows="2" placeholder="설명" data-field="desc">${String(a.desc || "").replace(/</g, "&lt;")}</textarea>`;

      row.querySelector('[data-field="tag"]').addEventListener("input", (e) => (areas[i].tag = e.target.value));
      row.querySelector('[data-field="title"]').addEventListener("input", (e) => (areas[i].title = e.target.value));
      row.querySelector('[data-field="desc"]').addEventListener("input", (e) => (areas[i].desc = e.target.value));
      row.querySelector('[data-act="up"]').addEventListener("click", () => {
        if (i === 0) return;
        [areas[i - 1], areas[i]] = [areas[i], areas[i - 1]];
        render();
      });
      row.querySelector('[data-act="down"]').addEventListener("click", () => {
        if (i === areas.length - 1) return;
        [areas[i + 1], areas[i]] = [areas[i], areas[i + 1]];
        render();
      });
      row.querySelector('[data-act="del"]').addEventListener("click", () => {
        if (confirm('"' + (areas[i].title || "제목 없음") + '" 연구분야를 삭제할까요?')) {
          areas.splice(i, 1);
          render();
        }
      });
      editor.appendChild(row);
    });
  }
  render();

  $("research-add").addEventListener("click", () => {
    areas.push({ tag: "", title: "", desc: "" });
    render();
  });

  $("research-save").addEventListener("click", () => {
    if (areas.some((a) => !a.title.trim())) {
      msg("모든 연구분야에 제목을 입력해 주세요.", "error");
      return;
    }
    const cfg = ContentStore.load();
    cfg.research = areas;
    ContentStore.save(cfg);
    msg("저장되었습니다. 연구 페이지와 홈 화면에 반영됩니다.", "ok");
  });

  $("research-reset").addEventListener("click", () => {
    if (!confirm("연구분야를 기본값으로 되돌릴까요?")) return;
    areas = structuredClone(ContentStore.DEFAULTS.research);
    const cfg = ContentStore.load();
    cfg.research = areas;
    ContentStore.save(cfg);
    render();
    msg("기본값으로 되돌렸습니다.", "ok");
  });
})();
