// 관리자 메뉴 관리 (2단계 메뉴 트리 + 커스텀 페이지 만들기)
// - 주메뉴/하위메뉴를 드래그앤드롭으로 재배치 (⠿ 핸들, 화살표 버튼은 보조 수단)
//   · 행의 위/아래 가장자리에 놓으면 그 위치로 이동
//   · 주메뉴 행의 가운데에 놓으면 그 메뉴의 하위로 이동
// - 새 페이지 만들기: 게시판/앨범 형태 선택 → cfg.pages 등록 + 메뉴 항목 추가
//   페이지 내용은 page.html?p=<id> 에서 posts 컬렉션(pageId 필드)으로 관리
// 저장: ContentStore(localStorage) + Firestore siteConfig/main (merge)

import { createDropdown, setupScopeToggle, esc } from "./notice-ui.js";

// Firestore는 동적으로 불러옵니다 — CDN을 못 불러오는 환경(오프라인 등)에서도
// 메뉴 편집기 자체는 동작하고, 저장은 localStorage에만 반영됩니다.
let FB = null;
const fbReady = (async () => {
  try {
    const cfgMod = await import("./firebase-config.js");
    if (!cfgMod.isConfigured) return;
    const fs = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
    FB = { db: cfgMod.db, doc: fs.doc, setDoc: fs.setDoc };
  } catch (_) {}
})();

if (window.ContentStore && document.getElementById("menu-editor")) {
  const $ = (id) => document.getElementById(id);
  const editor = $("menu-editor");

  const PEN_KINDS = { board: "게시판", album: "앨범" };

  let cfg = ContentStore.load();
  let nav2 = cfg.nav2 ? structuredClone(cfg.nav2) : structuredClone(ContentStore.DEFAULTS.nav2);
  let pages = structuredClone(cfg.pages || []);
  $("menu-login-label").value = cfg.loginLabel;

  const msg = (text, type) => {
    const el = $("menu-msg");
    el.textContent = text;
    el.className = "form-msg " + type;
    setTimeout(() => (el.className = "form-msg"), 4000);
  };

  // ---------- 저장 ----------
  async function persist(okText) {
    const saved = ContentStore.load();
    saved.nav2 = nav2;
    saved.pages = pages;
    saved.loginLabel = $("menu-login-label").value.trim() || "멤버 로그인";
    ContentStore.save(saved);
    await fbReady;
    if (FB) {
      try {
        await FB.setDoc(FB.doc(FB.db, "siteConfig", "main"),
          { nav2, pages, loginLabel: saved.loginLabel }, { merge: true });
      } catch (err) {
        msg("서버 반영 실패: " + err.message, "error");
        return false;
      }
    }
    if (okText) msg(okText, "ok");
    return true;
  }

  // ---------- 트리 렌더링 ----------
  const HANDLE = '<span class="drag-handle" title="끌어서 이동">⠿</span>';
  const ICON = {
    up: "↑", down: "↓", indent: "→", outdent: "←", del: "✕",
  };

  let drag = null;   // { i, j }  (j=null이면 주메뉴)

  function btn(act, title, disabled) {
    return `<button type="button" data-act="${act}" title="${title}"${disabled ? " disabled" : ""}>${ICON[act]}</button>`;
  }

  function render() {
    editor.innerHTML = "";
    nav2.forEach((item, i) => {
      editor.appendChild(row(item, i, null));
      (item.children || []).forEach((child, j) => editor.appendChild(row(child, i, j)));
    });
    renderPages();
  }

  function row(item, i, j) {
    const isChild = j !== null;
    const el = document.createElement("div");
    el.className = "menu-row" + (isChild ? " child" : "");
    el.draggable = true;
    el.dataset.i = i;
    if (isChild) el.dataset.j = j;
    const hasKids = !isChild && (item.children || []).length > 0;
    el.innerHTML = `
      ${HANDLE}
      <input type="text" value="${esc(item.label)}" placeholder="메뉴 이름" data-field="label" />
      <input type="text" value="${esc(item.href)}" placeholder="링크 (예: gallery.html)" data-field="href" />
      <label class="visible-toggle"><input type="checkbox" ${item.visible !== false ? "checked" : ""} data-field="visible" /> 표시</label>
      <div class="row-btns">
        ${btn("up", "위로")}
        ${btn("down", "아래로")}
        ${isChild ? btn("outdent", "주메뉴로 올리기") : btn("indent", "이전 메뉴의 하위로", i === 0 || hasKids)}
        ${btn("del", "삭제")}
      </div>`;

    const target = () => (j === null ? nav2[i] : nav2[i].children[j]);
    el.querySelector('[data-field="label"]').addEventListener("input", (e) => (target().label = e.target.value));
    el.querySelector('[data-field="href"]').addEventListener("input", (e) => (target().href = e.target.value));
    el.querySelector('[data-field="visible"]').addEventListener("change", (e) => (target().visible = e.target.checked));

    el.querySelector('[data-act="up"]').addEventListener("click", () => move(i, j, -1));
    el.querySelector('[data-act="down"]').addEventListener("click", () => move(i, j, +1));
    const ind = el.querySelector('[data-act="indent"]');
    if (ind) ind.addEventListener("click", () => {
      if (i === 0 || (nav2[i].children || []).length) return;
      const [it] = nav2.splice(i, 1);
      (nav2[i - 1].children = nav2[i - 1].children || []).push({ label: it.label, href: it.href, visible: it.visible !== false });
      render();
    });
    const out = el.querySelector('[data-act="outdent"]');
    if (out) out.addEventListener("click", () => {
      const [it] = nav2[i].children.splice(j, 1);
      nav2.splice(i + 1, 0, { ...it, children: [] });
      render();
    });
    el.querySelector('[data-act="del"]').addEventListener("click", () => {
      const label = target().label || "(이름 없음)";
      const kids = j === null ? (nav2[i].children || []).length : 0;
      if (!confirm(`"${label}" 메뉴를 삭제할까요?` + (kids ? `\n하위 메뉴 ${kids}개도 함께 삭제됩니다.` : ""))) return;
      if (j === null) nav2.splice(i, 1);
      else nav2[i].children.splice(j, 1);
      render();
    });

    // ----- 드래그 앤 드롭 -----
    el.addEventListener("dragstart", (e) => {
      drag = { i, j };
      el.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      try { e.dataTransfer.setData("text/plain", ""); } catch (_) {}
    });
    el.addEventListener("dragend", () => { drag = null; clearDropMarks(); editor.querySelectorAll(".dragging").forEach((x) => x.classList.remove("dragging")); });

    el.addEventListener("dragover", (e) => {
      if (!drag || (drag.i === i && drag.j === j)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      clearDropMarks();
      el.classList.add(zoneOf(e, el, i, j));
    });
    el.addEventListener("dragleave", () => el.classList.remove("drop-before", "drop-after", "drop-into"));
    el.addEventListener("drop", (e) => {
      if (!drag) return;
      e.preventDefault();
      const zone = zoneOf(e, el, i, j);
      clearDropMarks();
      performDrop(zone, i, j);
    });

    return el;
  }

  function clearDropMarks() {
    editor.querySelectorAll(".drop-before, .drop-after, .drop-into").forEach((x) =>
      x.classList.remove("drop-before", "drop-after", "drop-into"));
  }

  // 마우스 위치로 드롭 위치 결정: 위 1/3=앞, 아래 1/3=뒤, 가운데(주메뉴 행)=하위로
  function zoneOf(e, el, i, j) {
    const rect = el.getBoundingClientRect();
    const y = (e.clientY - rect.top) / rect.height;
    const canNest = j === null                             // 주메뉴 행 위에서만
      && !(drag.j === null && (nav2[drag.i].children || []).length) // 하위를 가진 주메뉴는 중첩 불가
      && !(drag.j === null && drag.i === i);
    if (canNest && y > 0.33 && y < 0.67) return "drop-into";
    return y < 0.5 ? "drop-before" : "drop-after";
  }

  // 끌던 항목을 빼내고 대상 위치에 삽입
  function performDrop(zone, ti, tj) {
    // 1) 끌던 항목 제거
    let item;
    if (drag.j === null) {
      [item] = nav2.splice(drag.i, 1);
      if (ti > drag.i) ti -= 1;                 // 앞이 빠졌으니 대상 인덱스 보정
    } else {
      [item] = nav2[drag.i].children.splice(drag.j, 1);
      item = { ...item };
      if (drag.i === ti && tj !== null && tj > drag.j) tj -= 1;
    }

    // 2) 삽입
    if (zone === "drop-into") {
      (nav2[ti].children = nav2[ti].children || []).push({ label: item.label, href: item.href, visible: item.visible !== false });
    } else if (tj === null) {
      // 주메뉴 행 기준 앞/뒤 → 주메뉴로 삽입
      const at = zone === "drop-before" ? ti : ti + 1;
      nav2.splice(at, 0, { label: item.label, href: item.href, visible: item.visible !== false, children: item.children || [] });
    } else {
      // 하위 행 기준 앞/뒤 → 그 부모의 하위로 삽입 (하위를 가진 주메뉴는 하위로 못 들어감)
      if (item.children && item.children.length) {
        nav2.splice(ti + 1, 0, item);           // 안전하게 주메뉴로 배치
      } else {
        const at = zone === "drop-before" ? tj : tj + 1;
        nav2[ti].children.splice(at, 0, { label: item.label, href: item.href, visible: item.visible !== false });
      }
    }
    drag = null;
    render();
  }

  function move(i, j, dir) {
    if (j === null) {
      const n = i + dir;
      if (n < 0 || n >= nav2.length) return;
      [nav2[i], nav2[n]] = [nav2[n], nav2[i]];
    } else {
      const arr = nav2[i].children;
      const n = j + dir;
      if (n < 0 || n >= arr.length) return;
      [arr[j], arr[n]] = [arr[n], arr[j]];
    }
    render();
  }

  render();

  // ---------- 툴바 ----------
  $("menu-add").addEventListener("click", () => {
    nav2.push({ label: "새 메뉴", href: "", visible: true, children: [] });
    render();
  });

  $("menu-save").addEventListener("click", async () => {
    const bad = [];
    nav2.forEach((it) => {
      if (it.visible !== false && (!it.label.trim() || !it.href.trim())) bad.push(it);
      (it.children || []).forEach((c) => { if (c.visible !== false && (!c.label.trim() || !c.href.trim())) bad.push(c); });
    });
    if (bad.length) return msg("표시 중인 메뉴에는 이름과 링크를 모두 입력해야 합니다.", "error");
    await persist("저장되었습니다. 공개 페이지를 새로고침하면 메뉴에 반영됩니다.");
  });

  $("menu-reset").addEventListener("click", async () => {
    if (!confirm("메뉴 구성을 기본값으로 되돌릴까요? (만든 페이지 목록은 유지됩니다)")) return;
    nav2 = structuredClone(ContentStore.DEFAULTS.nav2);
    $("menu-login-label").value = ContentStore.DEFAULTS.loginLabel;
    render();
    await persist("기본값으로 되돌렸습니다.");
  });

  // ---------- 만든 페이지 목록 ----------
  function renderPages() {
    const wrap = $("page-list-wrap");
    const list = $("page-list");
    if (!pages.length) { wrap.style.display = "none"; return; }
    wrap.style.display = "";
    list.innerHTML = pages.map((p, idx) => `
      <div class="board-item">
        <div class="b-row static">
          <span class="b-title">${esc(p.title)}
            <small style="font-weight:500; color:var(--muted);">${PEN_KINDS[p.kind] || p.kind} · ${p.scope === "member" ? "멤버 전용" : "전체공개"}</small></span>
          <span class="b-meta">
            <a class="btn-sm" href="page.html?p=${encodeURIComponent(p.id)}" target="_blank" rel="noopener" style="text-decoration:none;">열기</a>
            <button class="btn-sm danger" data-pg-del="${idx}" style="margin-left:6px;">삭제</button></span>
        </div>
      </div>`).join("");
    list.querySelectorAll("button[data-pg-del]").forEach((b) => {
      b.addEventListener("click", async () => {
        const idx = Number(b.dataset.pgDel);
        const p = pages[idx];
        if (!confirm(`"${p.title}" 페이지를 삭제할까요?\n메뉴에서 함께 제거됩니다. 이미 올린 게시글·사진 데이터는 서버에 남지만 더 이상 표시되지 않습니다.`)) return;
        const href = "page.html?p=" + p.id;
        pages.splice(idx, 1);
        nav2 = nav2.filter((it) => it.href !== href);
        nav2.forEach((it) => { if (it.children) it.children = it.children.filter((c) => c.href !== href); });
        render();
        await persist("페이지를 삭제했습니다.");
      });
    });
  }

  // ---------- 새 페이지 만들기 ----------
  const pageModal = $("page-modal");
  const kindDd = createDropdown($("pg-kind-dd"), {
    values: Object.values(PEN_KINDS),
    onChange: (v) => { $("pg-kind").value = v; },
  });
  const pgScope = setupScopeToggle($("pg-scope-toggle"), $("pg-scope-label"), $("pg-scope"));

  $("page-new").addEventListener("click", () => {
    $("pg-title").value = "";
    $("pg-desc").value = "";
    kindDd.set(PEN_KINDS.board);
    $("pg-kind").value = PEN_KINDS.board;
    pgScope.set(false, { animate: false });
    $("pg-msg").className = "form-msg";
    pageModal.classList.add("open");
  });
  $("pg-cancel").addEventListener("click", () => pageModal.classList.remove("open"));
  pageModal.addEventListener("click", (e) => { if (e.target === pageModal) pageModal.classList.remove("open"); });

  $("pg-save").addEventListener("click", async () => {
    const title = $("pg-title").value.trim();
    if (!title) {
      $("pg-msg").textContent = "페이지 이름을 입력해 주세요.";
      $("pg-msg").className = "form-msg error";
      return;
    }
    const kind = $("pg-kind").value === PEN_KINDS.album ? "album" : "board";
    const scope = $("pg-scope").value === "공개" ? "public" : "member";
    const id = "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    pages.push({ id, title, desc: $("pg-desc").value.trim(), kind, scope });
    nav2.push({ label: title, href: "page.html?p=" + id, visible: true, children: [] });
    render();
    const ok = await persist(`"${title}" 페이지를 만들었습니다. 메뉴 위치는 끌어서 조정한 뒤 저장하세요.`);
    if (ok) pageModal.classList.remove("open");
  });
}
