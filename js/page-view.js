// 커스텀 페이지 렌더러 (page.html?p=<id>)
// 관리자가 메뉴 관리에서 만든 페이지를 표시합니다.
// - 페이지 정의: siteConfig/main 문서의 pages 배열 { id, title, desc, kind, scope }
// - 게시글: posts 컬렉션에 pageId 필드로 저장 (공지 목록과는 분리)
//   · kind='board'  : 공지와 같은 게시판 (목록·상세·첨부·마크다운)
//   · kind='album'  : 사진 그리드 + 라이트박스 (이미지는 리사이즈해 문서에 저장)

import { auth, db, isConfigured } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, doc, getDoc, addDoc, deleteDoc, onSnapshot, query, where, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { initNoticeEditor, bindAttachmentEvents, deleteNoticeAttachments, todayIso, isoToDot } from "./notice-form.js";
import { buildNoticeList, buildNoticeDetail, esc } from "./notice-ui.js";

if (isConfigured) {
  const $ = (id) => document.getElementById(id);
  const box = $("pg-content");
  const pageId = new URLSearchParams(location.search).get("p");
  const MORE_COUNT = 5;

  let def = null;          // 페이지 정의
  let me = null;
  let isAdmin = false;
  let posts = [];
  let unsubscribe = null;
  let editor = null;

  const showMsg = (t) => { box.innerHTML = `<p style="color:var(--muted); font-size:0.9rem; padding:12px 4px;">${t}</p>`; };

  // ---------- 페이지 정의 로드 ----------
  (async () => {
    if (!pageId) return showMsg("페이지 주소가 올바르지 않습니다.");
    try {
      const snap = await getDoc(doc(db, "siteConfig", "main"));
      def = ((snap.exists() && snap.data().pages) || []).find((p) => p.id === pageId) || null;
    } catch (_) {}
    if (!def) return showMsg("페이지를 찾을 수 없습니다. 삭제되었거나 주소가 잘못되었을 수 있어요.");

    document.title = def.title + " | 한신대학교 임상심리 연구실";
    $("pg-title").textContent = def.title;
    $("pg-desc").textContent = def.desc || "";
    $("pg-eyebrow").textContent = def.kind === "album" ? "Album" : "Board";

    onAuthStateChanged(auth, async (user) => {
      me = null;
      if (user) {
        try {
          const s = await getDoc(doc(db, "users", user.uid));
          if (s.exists()) me = { uid: user.uid, ...s.data() };
        } catch (_) {}
      }
      isAdmin = me?.role === "admin";
      const isMember = isAdmin || me?.role === "member";

      if (def.scope === "member" && !isMember) {
        $("pg-toolbar").style.display = "none";
        showMsg('멤버 전용 페이지입니다. <a href="login.html">멤버 로그인</a> 후 이용해 주세요.');
        return;
      }

      // 관리자 도구 버튼
      $("pg-toolbar").style.display = isAdmin ? "" : "none";
      $("btn-page-write").style.display = isAdmin && def.kind === "board" ? "" : "none";
      $("btn-album-add").style.display = isAdmin && def.kind === "album" ? "" : "none";
      if (isAdmin && def.kind === "board" && !editor) {
        editor = initNoticeEditor(db, () => me, { pageId, noun: "게시글" });
        $("btn-page-write").addEventListener("click", () => editor.open(null));
      }

      subscribe(isMember);
    });
  })();

  // ---------- 게시글 구독 ----------
  function subscribe(isMember) {
    if (unsubscribe) unsubscribe();
    const q = isMember
      ? query(collection(db, "posts"), where("pageId", "==", pageId))
      : query(collection(db, "posts"), where("pageId", "==", pageId), where("scope", "==", "public"));
    unsubscribe = onSnapshot(q, (snap) => {
      posts = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.date || "").localeCompare(a.date || "")
          || (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      render();
    }, (err) => showMsg("불러오기 실패: " + esc(err.code || err.message)));
  }

  // ---------- 렌더링 ----------
  window.addEventListener("hashchange", () => render(true));

  const currentId = () => {
    const m = /^#post=(.+)$/.exec(location.hash);
    return m ? decodeURIComponent(m[1]) : null;
  };

  function render(scroll = false) {
    if (!def) return;
    if (def.kind === "album") renderAlbum();
    else renderBoard();
    if (scroll) window.scrollTo({ top: 0 });
  }

  // ----- 게시판 -----
  function renderBoard() {
    const id = currentId();
    const focused = id && posts.find((p) => p.id === id);
    if (focused) {
      const others = posts.filter((o) => o.id !== focused.id).slice(0, MORE_COUNT);
      box.classList.add("focused");
      box.innerHTML = buildNoticeDetail(focused, others, { isAdmin });
      box.querySelectorAll("[data-back]").forEach((b) => b.addEventListener("click", () => {
        history.pushState(null, "", location.pathname + location.search);
        render(true);
      }));
      bindRowOpen();
      if (isAdmin) {
        const editBtn = box.querySelector(`[data-edit="${focused.id}"]`);
        if (editBtn) editBtn.addEventListener("click", () => editor.open(focused));
        const delBtn = box.querySelector(`[data-del="${focused.id}"]`);
        if (delBtn) delBtn.addEventListener("click", async () => {
          if (!confirm(`"${focused.title}" 글을 삭제할까요? 첨부파일도 함께 삭제됩니다.`)) return;
          try {
            await deleteNoticeAttachments(db, focused.attachments);
            await deleteDoc(doc(db, "posts", focused.id));
            history.replaceState(null, "", location.pathname + location.search);
            render();
          } catch (err) { alert("삭제 실패: " + err.message); }
        });
      }
      bindAttachmentEvents(db, box, { [focused.id]: focused });
    } else {
      if (id && posts.length) history.replaceState(null, "", location.pathname + location.search);
      box.classList.remove("focused");
      box.innerHTML = posts.length
        ? buildNoticeList(posts)
        : '<p class="board-empty">아직 등록된 글이 없습니다.</p>';
      bindRowOpen();
    }
  }

  function bindRowOpen() {
    box.querySelectorAll("button[data-open]").forEach((btn) => {
      btn.addEventListener("click", () => { location.hash = "#post=" + encodeURIComponent(btn.dataset.open); });
    });
  }

  // ----- 앨범 -----
  function renderAlbum() {
    const items = posts.filter((p) => p.imageData);
    if (!items.length) {
      box.innerHTML = '<p class="board-empty">아직 등록된 사진이 없습니다.</p>';
      return;
    }
    box.innerHTML = `<div class="album-grid">` + items.map((p, i) => `
      <figure class="album-item" data-lb="${i}">
        <img src="${p.imageData}" alt="${esc(p.title || "사진")}" loading="lazy" />
        ${p.title ? `<figcaption>${esc(p.title)}</figcaption>` : ""}
        ${isAdmin ? `<button type="button" class="album-del" data-del-item="${p.id}" title="삭제">✕</button>` : ""}
      </figure>`).join("") + `</div>`;

    box.querySelectorAll("[data-lb]").forEach((fig) => {
      fig.addEventListener("click", (e) => {
        if (e.target.closest(".album-del")) return;
        openLightbox(items, Number(fig.dataset.lb));
      });
    });
    box.querySelectorAll("[data-del-item]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("이 사진을 삭제할까요?")) return;
        try { await deleteDoc(doc(db, "posts", btn.dataset.delItem)); }
        catch (err) { alert("삭제 실패: " + err.message); }
      });
    });
  }

  // ----- 라이트박스 -----
  const lb = $("lightbox");
  let lbItems = [];
  let lbIdx = 0;

  function showLb() {
    const p = lbItems[lbIdx];
    if (!p) return;
    $("lb-img").src = p.imageData;
    $("lb-caption").textContent = p.title || "";
    $("lb-prev").style.visibility = lbIdx > 0 ? "" : "hidden";
    $("lb-next").style.visibility = lbIdx < lbItems.length - 1 ? "" : "hidden";
  }
  function openLightbox(items, idx) {
    lbItems = items; lbIdx = idx;
    lb.hidden = false;
    document.body.style.overflow = "hidden";
    showLb();
  }
  function closeLightbox() {
    lb.hidden = true;
    document.body.style.overflow = "";
  }
  $("lb-close").addEventListener("click", closeLightbox);
  lb.addEventListener("click", (e) => { if (e.target === lb) closeLightbox(); });
  $("lb-prev").addEventListener("click", () => { if (lbIdx > 0) { lbIdx--; showLb(); } });
  $("lb-next").addEventListener("click", () => { if (lbIdx < lbItems.length - 1) { lbIdx++; showLb(); } });
  document.addEventListener("keydown", (e) => {
    if (lb.hidden) return;
    if (e.key === "Escape") closeLightbox();
    if (e.key === "ArrowLeft" && lbIdx > 0) { lbIdx--; showLb(); }
    if (e.key === "ArrowRight" && lbIdx < lbItems.length - 1) { lbIdx++; showLb(); }
  });

  // ----- 앨범: 사진 추가 -----
  const albumModal = $("album-modal");
  $("btn-album-add").addEventListener("click", () => {
    $("al-files").value = "";
    $("al-file-list").innerHTML = "";
    $("al-caption").value = "";
    $("al-msg").className = "form-msg";
    albumModal.classList.add("open");
  });
  $("al-cancel").addEventListener("click", () => albumModal.classList.remove("open"));
  albumModal.addEventListener("click", (e) => { if (e.target === albumModal) albumModal.classList.remove("open"); });
  $("al-files").addEventListener("change", () => {
    const files = [...($("al-files").files || [])];
    $("al-file-list").innerHTML = files.map((f) => `<div class="file-row"><span class="f-name">${esc(f.name)}</span></div>`).join("");
  });

  // 이미지를 데이터 URL로 리사이즈 — Firestore 문서 1MB 한도를 넘지 않게
  // 1280px/품질 0.82로 시작해, 크면 900px/0.72로 한 번 더 줄입니다.
  function resizeImage(file, max, quality) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(file.name + " — 이미지를 읽을 수 없습니다.")); };
      img.src = url;
    });
  }

  $("al-save").addEventListener("click", async () => {
    const files = [...($("al-files").files || [])];
    const msg = $("al-msg");
    const btn = $("al-save");
    if (!files.length) {
      msg.textContent = "사진을 선택해 주세요.";
      msg.className = "form-msg error";
      return;
    }
    btn.disabled = true;
    try {
      const caption = $("al-caption").value.trim();
      for (let i = 0; i < files.length; i++) {
        btn.textContent = `올리는 중… (${i + 1}/${files.length})`;
        let dataUrl = await resizeImage(files[i], 1280, 0.82);
        if (dataUrl.length > 900000) dataUrl = await resizeImage(files[i], 900, 0.72);
        await addDoc(collection(db, "posts"), {
          pageId,
          kind: "album",
          title: caption,
          imageData: dataUrl,
          date: isoToDot(todayIso()),
          scope: def.scope || "public",
          authorUid: me.uid,
          authorName: me.name || "",
          createdAt: serverTimestamp(),
        });
      }
      albumModal.classList.remove("open");
    } catch (err) {
      msg.textContent = "업로드 실패: " + err.message;
      msg.className = "form-msg error";
    } finally {
      btn.disabled = false;
      btn.textContent = "올리기";
    }
  });
}
