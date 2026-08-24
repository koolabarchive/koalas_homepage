// 공지사항 페이지 (notice.html)
// - 목록 보기: 제목 행만 표시, 클릭하면 해당 공지를 포커스한 상세 보기로 이동
// - 상세 보기: 마크다운 본문·첨부·(관리자) 수정/삭제 + 하단에 다른 공지 5개 + 목록 버튼
// - URL 해시(#post=아이디)로 상태를 관리해 브라우저 뒤로가기·새로고침·링크 공유가 동작합니다
// - 비로그인: 공개 글만 / 멤버: 멤버 전용 포함 / 관리자: 글쓰기·수정·삭제 노출

import { auth, db, isConfigured } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, doc, getDoc, deleteDoc, onSnapshot, query, where,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  initNoticeEditor, attachmentChips, bindAttachmentEvents, deleteNoticeAttachments,
} from "./notice-form.js";
import { buildNoticeList, buildNoticeDetail, esc } from "./notice-ui.js";

if (isConfigured) {
  const $ = (id) => document.getElementById(id);
  const MORE_COUNT = 5;          // 상세 하단에 보여줄 다른 공지 수

  const board = $("notice-board");
  let me = null;                 // { uid, name, role } | null
  let editor = null;             // 관리자용 작성 모달 (지연 초기화)
  let unsubscribe = null;
  let posts = [];                // 현재 구독 중인 글 목록 (최신순)
  let isAdmin = false;

  const currentId = () => {
    const m = /^#post=(.+)$/.exec(location.hash);
    return m ? decodeURIComponent(m[1]) : null;
  };
  const openPost = (id) => { location.hash = "#post=" + encodeURIComponent(id); };
  const backToList = () => {
    // 해시만 지우고 다시 그립니다. (history.back()은 공유 링크로 바로 진입한
    // 경우 사이트 밖으로 나가버립니다)
    history.pushState(null, "", location.pathname);
    render(true);
  };

  onAuthStateChanged(auth, async (user) => {
    me = null;
    if (user) {
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        if (snap.exists()) me = { uid: user.uid, ...snap.data() };
      } catch (_) { /* 규칙 미배포 등 — 비로그인과 동일 취급 */ }
    }
    isAdmin = me?.role === "admin";
    const isMember = isAdmin || me?.role === "member";

    // 관리자: 글쓰기 버튼 + 모달
    $("notice-toolbar").style.display = isAdmin ? "" : "none";
    if (isAdmin && !editor) {
      editor = initNoticeEditor(db, () => me);
      $("btn-write-notice").addEventListener("click", () => editor.open(null));
    }

    subscribe(isMember);
  });

  function subscribe(isMember) {
    if (unsubscribe) unsubscribe();
    // 비로그인·대기 계정은 공개 글만 조회 가능 (보안 규칙상 필터 필수)
    const q = isMember
      ? collection(db, "posts")
      : query(collection(db, "posts"), where("scope", "==", "public"));

    unsubscribe = onSnapshot(q, (snap) => {
      posts = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      render();
    }, (err) => {
      board.innerHTML = `<p style="color:var(--danger); font-size:0.9rem; padding:12px 4px;">불러오기 실패: ${esc(err.code || err.message)}</p>`;
    });
  }

  window.addEventListener("hashchange", () => render(true));
  window.addEventListener("popstate", () => render(true));

  // scroll: 목록↔상세 탐색일 때만 위로 이동합니다.
  // (Firestore 실시간 갱신으로 다시 그릴 때 스크롤이 튀면 안 됩니다)
  function render(scroll = false) {
    const id = currentId();
    const focused = id && posts.find((p) => p.id === id);

    if (focused) renderDetail(focused);
    else {
      // 삭제됐거나 권한 밖의 글을 가리키는 해시는 목록으로 정리
      if (id && posts.length) history.replaceState(null, "", location.pathname);
      renderList();
    }
    if (scroll) window.scrollTo({ top: 0 });
  }

  function renderList() {
    board.classList.remove("focused");
    board.innerHTML = buildNoticeList(posts);
    bindRowOpen(board);
  }

  function renderDetail(p) {
    const others = posts.filter((o) => o.id !== p.id).slice(0, MORE_COUNT);
    board.classList.add("focused");
    board.innerHTML = buildNoticeDetail(p, others, { isAdmin });

    board.querySelectorAll("[data-back]").forEach((b) => b.addEventListener("click", backToList));
    bindRowOpen(board);

    if (isAdmin) {
      const editBtn = board.querySelector(`[data-edit="${p.id}"]`);
      if (editBtn) editBtn.addEventListener("click", () => editor.open(p));
      const delBtn = board.querySelector(`[data-del="${p.id}"]`);
      if (delBtn) delBtn.addEventListener("click", async () => {
        if (!confirm(`"${p.title}" 공지를 삭제할까요? 첨부파일도 함께 삭제됩니다.`)) return;
        try {
          await deleteNoticeAttachments(db, p.attachments);
          await deleteDoc(doc(db, "posts", p.id));
          history.replaceState(null, "", location.pathname);
          render();
        } catch (err) { alert("삭제 실패: " + err.message); }
      });
    }

    bindAttachmentEvents(db, board, { [p.id]: p });
  }

  function bindRowOpen(box) {
    box.querySelectorAll("button[data-open]").forEach((btn) => {
      btn.addEventListener("click", () => openPost(btn.dataset.open));
    });
  }
}
