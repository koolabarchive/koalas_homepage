// 연구실 사진 페이지 (gallery.html)
// posts 컬렉션의 앨범 사진(kind='album')을 한곳에 모아 보여 줍니다.
// - 이 페이지에서 올린 사진: pageId='gallery' (기본 앨범 "연구실 사진")
// - 메뉴 관리에서 만든 앨범 페이지(page.html?p=<id>)의 사진도 함께 표시
// - 앨범이 둘 이상이면 상단 칩으로 골라 볼 수 있고, ?album=<id> 로 바로 열 수 있습니다.
// - 비로그인 방문자는 공개(scope='public') 사진만, 멤버는 전체를 봅니다.

import { auth, db, isConfigured } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, doc, getDoc, addDoc, deleteDoc, onSnapshot, query, where, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { esc, createDropdown } from "./notice-ui.js";
import { todayIso, isoToDot } from "./notice-form.js";
import { buildGallery, groupByAlbum, DEFAULT_ALBUM } from "./gallery-view.js";

if (isConfigured) {
  const $ = (id) => document.getElementById(id);
  const box = $("gl-content");

  let me = null;
  let isAdmin = false;
  let pages = [];        // siteConfig.pages (앨범 제목 찾기용)
  let photos = [];
  let unsubscribe = null;
  let filter = new URLSearchParams(location.search).get("album") || "";  // '' = 전체

  const showMsg = (t) => { box.innerHTML = `<p style="color:var(--muted); font-size:0.9rem; padding:12px 4px;">${t}</p>`; };

  // 앨범 정의: 기본 앨범 + 관리자가 만든 앨범 페이지
  const albums = () => [DEFAULT_ALBUM, ...pages.filter((p) => p.kind === "album").map((p) => ({ id: p.id, title: p.title, scope: p.scope || "public" }))];

  (async () => {
    try {
      const snap = await getDoc(doc(db, "siteConfig", "main"));
      const data = snap.exists() ? snap.data() : {};
      pages = Array.isArray(data.pages) ? data.pages : [];
      const desc = data.aboutPage?.galleryDesc;
      if (desc) $("gl-desc").textContent = desc;
    } catch (_) {}

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
      $("gl-toolbar").style.display = isAdmin ? "" : "none";
      subscribe(isMember);
    });
  })();

  function subscribe(isMember) {
    if (unsubscribe) unsubscribe();
    const q = isMember
      ? query(collection(db, "posts"), where("kind", "==", "album"))
      : query(collection(db, "posts"), where("kind", "==", "album"), where("scope", "==", "public"));
    unsubscribe = onSnapshot(q, (snap) => {
      photos = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .filter((p) => p.imageData)
        .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)
          || (b.date || "").localeCompare(a.date || ""));
      render();
    }, (err) => showMsg("불러오기 실패: " + esc(err.code || err.message)));
  }

  // ---------- 렌더링 ----------
  let visible = [];   // 라이트박스 순서 (현재 화면에 보이는 사진)

  function render() {
    const groups = groupByAlbum(photos, albums());
    if (filter && !groups.some((g) => g.id === filter)) filter = "";
    visible = filter ? (groups.find((g) => g.id === filter)?.items || []) : photos;
    box.innerHTML = buildGallery(groups, { filter, isAdmin });

    box.querySelectorAll("[data-album]").forEach((chip) => {
      chip.addEventListener("click", () => {
        filter = chip.dataset.album;
        const url = new URL(location.href);
        if (filter) url.searchParams.set("album", filter); else url.searchParams.delete("album");
        history.replaceState(null, "", url);
        render();
      });
    });
    box.querySelectorAll("[data-lb]").forEach((fig) => {
      fig.addEventListener("click", (e) => {
        if (e.target.closest(".gl-del")) return;
        openLightbox(Number(fig.dataset.lb));
      });
    });
    box.querySelectorAll("[data-del-photo]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("이 사진을 삭제할까요?")) return;
        try { await deleteDoc(doc(db, "posts", btn.dataset.delPhoto)); }
        catch (err) { alert("삭제 실패: " + err.message); }
      });
    });
  }

  // ---------- 라이트박스 ----------
  const lb = $("lightbox");
  let lbIdx = 0;

  function showLb() {
    const p = visible[lbIdx];
    if (!p) return;
    $("lb-img").src = p.imageData;
    $("lb-img").alt = p.title || "사진";
    $("lb-caption").textContent = p.title || "";
    $("lb-meta").textContent = [p.date, `${lbIdx + 1} / ${visible.length}`].filter(Boolean).join(" · ");
    $("lb-prev").style.visibility = lbIdx > 0 ? "" : "hidden";
    $("lb-next").style.visibility = lbIdx < visible.length - 1 ? "" : "hidden";
  }
  function openLightbox(idx) {
    lbIdx = idx;
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
  $("lb-next").addEventListener("click", () => { if (lbIdx < visible.length - 1) { lbIdx++; showLb(); } });
  document.addEventListener("keydown", (e) => {
    if (lb.hidden) return;
    if (e.key === "Escape") closeLightbox();
    if (e.key === "ArrowLeft" && lbIdx > 0) { lbIdx--; showLb(); }
    if (e.key === "ArrowRight" && lbIdx < visible.length - 1) { lbIdx++; showLb(); }
  });
  // 모바일: 좌우 스와이프로 넘기기
  let touchX = null;
  lb.addEventListener("touchstart", (e) => { touchX = e.touches[0].clientX; }, { passive: true });
  lb.addEventListener("touchend", (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(dx) < 40) return;
    if (dx < 0 && lbIdx < visible.length - 1) { lbIdx++; showLb(); }
    if (dx > 0 && lbIdx > 0) { lbIdx--; showLb(); }
  });

  // ---------- 사진 올리기 (관리자) ----------
  const modal = $("gl-modal");
  const albumDd = createDropdown($("gl-album-dd"), {
    values: [], allowEmpty: false,
    onChange: (v) => { $("gl-album").value = v; },
  });
  $("btn-gl-add").addEventListener("click", () => {
    const list = albums();
    albumDd.setOptions(list.map((a) => a.title));
    const cur = list.find((a) => a.id === filter) || list[0];
    albumDd.set(cur.title);
    $("gl-album").value = cur.title;
    $("gl-files").value = "";
    $("gl-file-list").innerHTML = "";
    $("gl-caption").value = "";
    $("gl-member-only").checked = false;
    $("gl-msg").className = "form-msg";
    modal.classList.add("open");
  });
  $("gl-cancel").addEventListener("click", () => modal.classList.remove("open"));
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.remove("open"); });
  $("gl-files").addEventListener("change", () => {
    const files = [...($("gl-files").files || [])];
    $("gl-file-list").innerHTML = files.map((f) => `<div class="file-row"><span class="f-name">${esc(f.name)}</span></div>`).join("");
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

  $("gl-save").addEventListener("click", async () => {
    const files = [...($("gl-files").files || [])];
    const msg = $("gl-msg");
    const btn = $("gl-save");
    if (!files.length) {
      msg.textContent = "사진을 선택해 주세요.";
      msg.className = "form-msg error";
      return;
    }
    const album = albums().find((a) => a.title === $("gl-album").value) || DEFAULT_ALBUM;
    // 멤버 전용 앨범 페이지의 사진은 항상 멤버에게만 공개
    const scope = ($("gl-member-only").checked || album.scope === "member") ? "member" : "public";
    btn.disabled = true;
    try {
      const caption = $("gl-caption").value.trim();
      for (let i = 0; i < files.length; i++) {
        btn.textContent = `올리는 중… (${i + 1}/${files.length})`;
        let dataUrl = await resizeImage(files[i], 1280, 0.82);
        if (dataUrl.length > 900000) dataUrl = await resizeImage(files[i], 900, 0.72);
        await addDoc(collection(db, "posts"), {
          pageId: album.id,
          kind: "album",
          title: caption,
          imageData: dataUrl,
          date: isoToDot(todayIso()),
          scope,
          authorUid: me.uid,
          authorName: me.name || "",
          createdAt: serverTimestamp(),
        });
      }
      modal.classList.remove("open");
    } catch (err) {
      msg.textContent = "업로드 실패: " + err.message;
      msg.className = "form-msg error";
    } finally {
      btn.disabled = false;
      btn.textContent = "올리기";
    }
  });
}
