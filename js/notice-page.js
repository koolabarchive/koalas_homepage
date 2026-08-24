// 공지사항 페이지 (notice.html)
// - 게시판형 목록: 제목 클릭 → 내용·첨부파일 펼침, 작성자·날짜 표시
// - 비로그인: 공개 글만 / 멤버: 멤버 전용 포함 / 관리자: 글쓰기·수정·삭제 버튼 노출

import { auth, db, isConfigured } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, doc, getDoc, deleteDoc, onSnapshot, query, where,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  initNoticeEditor, attachmentChips, bindAttachmentEvents, deleteNoticeAttachments,
} from "./notice-form.js";
import { renderMarkdown } from "./markdown-lite.js";

if (isConfigured) {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const board = $("notice-board");
  let me = null;               // { uid, name, role } | null
  let editor = null;           // 관리자용 작성 모달 (지연 초기화)
  let unsubscribe = null;
  const openItems = new Set(); // 펼쳐 둔 글 유지

  onAuthStateChanged(auth, async (user) => {
    me = null;
    if (user) {
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        if (snap.exists()) me = { uid: user.uid, ...snap.data() };
      } catch (_) { /* 규칙 미배포 등 — 비로그인과 동일 취급 */ }
    }
    const isAdmin = me?.role === "admin";
    const isMember = isAdmin || me?.role === "member";

    // 관리자: 글쓰기 버튼 + 모달
    $("notice-toolbar").style.display = isAdmin ? "" : "none";
    if (isAdmin && !editor) {
      editor = initNoticeEditor(db, () => me);
      $("btn-write-notice").addEventListener("click", () => editor.open(null));
    }

    subscribe(isMember, isAdmin);
  });

  function subscribe(isMember, isAdmin) {
    if (unsubscribe) unsubscribe();
    // 비로그인·대기 계정은 공개 글만 조회 가능 (보안 규칙상 필터 필수)
    const q = isMember
      ? collection(db, "posts")
      : query(collection(db, "posts"), where("scope", "==", "public"));

    unsubscribe = onSnapshot(q, (snap) => {
      const posts = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      render(posts, isAdmin);
    }, (err) => {
      board.innerHTML = `<p style="color:var(--danger); font-size:0.9rem; padding:12px 4px;">불러오기 실패: ${esc(err.code || err.message)}</p>`;
    });
  }

  function render(posts, isAdmin) {
    if (!posts.length) {
      board.innerHTML = '<p style="color:var(--muted); font-size:0.9rem; padding:12px 4px;">등록된 공지가 없습니다.</p>';
      return;
    }
    const byKey = {};
    board.innerHTML = posts.map((p) => {
      byKey[p.id] = p;
      const open = openItems.has(p.id);
      const attCount = (p.attachments || []).length;
      const metaBits = [p.authorName, p.date].filter(Boolean).map(esc);
      return `<div class="board-item${open ? " open" : ""}">
        <button type="button" class="b-row" data-toggle="${p.id}">
          <span class="b-title">
            ${p.badge ? `<span class="badge">${esc(p.badge)}</span>` : ""}
            ${p.scope === "member" ? `<span class="scope-chip">멤버 전용</span>` : ""}
            ${esc(p.title)}${attCount ? ` <span class="b-att">📎 ${attCount}</span>` : ""}
          </span>
          <span class="b-meta">${metaBits.join(" · ")}</span>
        </button>
        <div class="b-detail"${open ? "" : " hidden"}>
          ${p.content ? `<div class="b-body md-body">${renderMarkdown(p.content)}</div>` : ""}
          ${attachmentChips(p.attachments, p.id)}
          ${isAdmin ? `<div class="b-actions">
            <button class="btn-sm" data-edit="${p.id}">수정</button>
            <button class="btn-sm danger" data-del="${p.id}">삭제</button>
          </div>` : ""}
        </div>
      </div>`;
    }).join("");

    board.querySelectorAll("button[data-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const item = btn.closest(".board-item");
        const detail = item.querySelector(".b-detail");
        const id = btn.dataset.toggle;
        if (detail.hidden) { detail.hidden = false; item.classList.add("open"); openItems.add(id); }
        else { detail.hidden = true; item.classList.remove("open"); openItems.delete(id); }
      });
    });

    if (isAdmin) {
      board.querySelectorAll("button[data-edit]").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          editor.open(byKey[btn.dataset.edit]);
        });
      });
      board.querySelectorAll("button[data-del]").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const p = byKey[btn.dataset.del];
          if (!confirm(`"${p.title}" 공지를 삭제할까요? 첨부파일도 함께 삭제됩니다.`)) return;
          try {
            await deleteNoticeAttachments(db, p.attachments);
            await deleteDoc(doc(db, "posts", p.id));
          } catch (err) { alert("삭제 실패: " + err.message); }
        });
      });
    }

    bindAttachmentEvents(db, board, byKey);
  }
}
