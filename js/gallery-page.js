// 연구실 사진 페이지 (gallery.html)
// - 사진: galleryPhotos 컬렉션 (멤버 누구나 올리고, 본인 사진은 수정·삭제)
// - 앨범: galleryAlbums 컬렉션 (멤버 누구나 만들고, 만든 사람·관리자가 이름 변경·삭제)
//   사진 하나가 여러 앨범(태그)에 속할 수 있고, 상단 칩으로 골라 봅니다. ?album=<id> 로 바로 열기
// - 이전 방식(posts kind='album', 관리자 앨범 페이지)의 사진도 함께 보여 줍니다 (관리자만 삭제)
// - 비로그인 방문자는 공개(scope='public') 사진만, 멤버는 전체를 봅니다.

import { auth, db, isConfigured } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, doc, getDoc, addDoc, updateDoc, deleteDoc, onSnapshot, query, where, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { esc } from "./notice-ui.js";
import { todayIso, isoToDot } from "./notice-form.js";
import { buildGallery, buildAlbumPicker, filterPhotos, NONE_ID } from "./gallery-view.js";

if (isConfigured) {
  const $ = (id) => document.getElementById(id);
  const box = $("gl-content");

  let me = null;
  let isAdmin = false;
  let isMember = false;
  let pages = [];          // siteConfig.pages (이전 앨범 페이지 제목용)
  let albums = [];         // galleryAlbums
  let photos = [];         // galleryPhotos
  let legacy = [];         // posts(kind='album')
  const unsubs = [];
  let filter = new URLSearchParams(location.search).get("album") || "";

  const showMsg = (t) => { box.innerHTML = `<p style="color:var(--muted); font-size:0.9rem; padding:12px 4px;">${t}</p>`; };
  const bySeconds = (a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0) || (b.date || "").localeCompare(a.date || "");

  // 이전 앨범 페이지 → 가상 앨범(수정 불가), 사진이 있는 것만
  const legacyAlbums = () => {
    const used = new Set(legacy.map((p) => p.albumIds[0]).filter(Boolean));
    return pages.filter((p) => p.kind === "album" && used.has("page:" + p.id))
      .map((p) => ({ id: "page:" + p.id, name: p.title, legacy: true }));
  };
  const allAlbums = () => [...albums, ...legacyAlbums()];
  const allPhotos = () => [...photos, ...legacy].sort(bySeconds);

  // ---------- 로드 ----------
  (async () => {
    try {
      const snap = await getDoc(doc(db, "siteConfig", "main"));
      const data = snap.exists() ? snap.data() : {};
      pages = Array.isArray(data.pages) ? data.pages : [];
      if (data.aboutPage?.galleryDesc) $("gl-desc").textContent = data.aboutPage.galleryDesc;
    } catch (_) {}

    // 앨범 목록은 누구나 볼 수 있음
    unsubs.push(onSnapshot(collection(db, "galleryAlbums"), (snap) => {
      albums = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
      render();
    }, () => {}));

    onAuthStateChanged(auth, async (user) => {
      me = null;
      if (user) {
        try {
          const s = await getDoc(doc(db, "users", user.uid));
          if (s.exists()) me = { uid: user.uid, ...s.data() };
        } catch (_) {}
      }
      isAdmin = me?.role === "admin";
      isMember = isAdmin || me?.role === "member";
      $("gl-toolbar").style.display = isMember ? "" : "none";
      subscribe();
    });
  })();

  let photoUnsub = null, legacyUnsub = null;
  function subscribe() {
    if (photoUnsub) photoUnsub();
    if (legacyUnsub) legacyUnsub();
    const qPhotos = isMember
      ? collection(db, "galleryPhotos")
      : query(collection(db, "galleryPhotos"), where("scope", "==", "public"));
    photoUnsub = onSnapshot(qPhotos, (snap) => {
      photos = snap.docs.map((d) => ({ id: d.id, ...d.data(), albumIds: d.data().albumIds || [] })).filter((p) => p.imageData);
      render();
    }, (err) => showMsg("불러오기 실패: " + esc(err.code || err.message)));

    const qLegacy = isMember
      ? query(collection(db, "posts"), where("kind", "==", "album"))
      : query(collection(db, "posts"), where("kind", "==", "album"), where("scope", "==", "public"));
    legacyUnsub = onSnapshot(qLegacy, (snap) => {
      legacy = snap.docs.map((d) => {
        const x = d.data();
        return { id: d.id, ...x, caption: x.title || "", legacy: true,
          albumIds: x.pageId && x.pageId !== "gallery" ? ["page:" + x.pageId] : [] };
      }).filter((p) => p.imageData);
      render();
    }, () => {});
  }

  // ---------- 렌더링 ----------
  let visible = [];
  const canEdit = (p) => isAdmin || (isMember && !p.legacy && p.authorUid === me?.uid);
  const canManage = (a) => !a.legacy && (isAdmin || (isMember && a.createdByUid === me?.uid));

  function render() {
    const list = allAlbums();
    const all = allPhotos();
    if (filter && filter !== NONE_ID && !list.some((a) => a.id === filter)) filter = "";
    visible = filterPhotos(all, list, filter);
    box.innerHTML = buildGallery(all, list, { filter, canEdit, canManage, isMember });

    box.querySelectorAll("[data-album]").forEach((chip) => chip.addEventListener("click", () => {
      filter = chip.dataset.album;
      const url = new URL(location.href);
      if (filter) url.searchParams.set("album", filter); else url.searchParams.delete("album");
      history.replaceState(null, "", url);
      render();
    }));
    box.querySelectorAll("[data-lb]").forEach((fig) => fig.addEventListener("click", (e) => {
      if (e.target.closest(".gl-tools")) return;
      openLightbox(Number(fig.dataset.lb));
    }));
    // ⋯ 메뉴 열고 닫기 (하나만 열림, 바깥 클릭·ESC로 닫힘)
    box.querySelectorAll("[data-menu]").forEach((btn) => btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const menu = btn.nextElementSibling;
      const open = menu.hidden;
      closeMenus();
      if (open) { menu.hidden = false; btn.setAttribute("aria-expanded", "true"); btn.closest(".gl-tools").classList.add("open"); }
    }));
    box.querySelectorAll("[data-del-photo]").forEach((btn) => btn.addEventListener("click", async () => {
      closeMenus();
      if (!confirm("이 사진을 삭제할까요?")) return;
      const p = all.find((x) => x.id === btn.dataset.delPhoto);
      try { await deleteDoc(doc(db, p?.legacy ? "posts" : "galleryPhotos", btn.dataset.delPhoto)); }
      catch (err) { alert("삭제 실패: " + err.message); }
    }));
    box.querySelectorAll("[data-edit-photo]").forEach((btn) => btn.addEventListener("click", () => {
      closeMenus();
      const p = photos.find((x) => x.id === btn.dataset.editPhoto);
      if (p) openModal(p);
    }));
    box.querySelectorAll("[data-rename-album]").forEach((btn) => btn.addEventListener("click", () => {
      const a = albums.find((x) => x.id === btn.dataset.renameAlbum);
      if (a) openAlbumModal(a);
    }));
    box.querySelectorAll("[data-del-album]").forEach((btn) => btn.addEventListener("click", async () => {
      const a = albums.find((x) => x.id === btn.dataset.delAlbum);
      if (!a) return;
      if (!confirm(`"${a.name}" 앨범을 삭제할까요? 사진은 지워지지 않고 앨범 표시만 사라집니다.`)) return;
      try {
        await deleteDoc(doc(db, "galleryAlbums", a.id));
        filter = "";
        history.replaceState(null, "", location.pathname);
      } catch (err) { alert("삭제 실패: " + err.message); }
    }));
  }

  function closeMenus() {
    box.querySelectorAll(".gl-menu:not([hidden])").forEach((m) => { m.hidden = true; });
    box.querySelectorAll("[data-menu][aria-expanded='true']").forEach((b) => b.setAttribute("aria-expanded", "false"));
    box.querySelectorAll(".gl-tools.open").forEach((t) => t.classList.remove("open"));
  }
  document.addEventListener("click", (e) => { if (!e.target.closest(".gl-tools")) closeMenus(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenus(); });

  // ---------- 라이트박스 ----------
  const lb = $("lightbox");
  let lbIdx = 0;
  function showLb() {
    const p = visible[lbIdx];
    if (!p) return;
    $("lb-img").src = p.imageData;
    $("lb-img").alt = p.caption || "사진";
    $("lb-caption").textContent = p.caption || "";
    const names = (p.albumIds || []).map((id) => allAlbums().find((a) => a.id === id)?.name).filter(Boolean).map((n) => "#" + n);
    $("lb-meta").textContent = [p.authorName, p.date, ...names, `${lbIdx + 1} / ${visible.length}`].filter(Boolean).join(" · ");
    $("lb-prev").style.visibility = lbIdx > 0 ? "" : "hidden";
    $("lb-next").style.visibility = lbIdx < visible.length - 1 ? "" : "hidden";
  }
  function openLightbox(idx) { lbIdx = idx; lb.hidden = false; document.body.style.overflow = "hidden"; showLb(); }
  function closeLightbox() { lb.hidden = true; document.body.style.overflow = ""; }
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

  // ---------- 앨범 만들기 / 이름 바꾸기 ----------
  const albumModal = $("gl-album-modal");
  let editingAlbum = null;
  function openAlbumModal(album) {
    editingAlbum = album || null;
    $("gl-album-title").textContent = album ? "앨범 이름 바꾸기" : "새 앨범 만들기";
    $("ga-save").textContent = album ? "저장" : "만들기";
    $("ga-name").value = album ? album.name : "";
    $("ga-msg").className = "form-msg";
    albumModal.classList.add("open");
    setTimeout(() => $("ga-name").focus(), 50);
  }
  $("btn-gl-album").addEventListener("click", () => openAlbumModal(null));
  $("ga-cancel").addEventListener("click", () => albumModal.classList.remove("open"));
  albumModal.addEventListener("click", (e) => { if (e.target === albumModal) albumModal.classList.remove("open"); });
  $("ga-name").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("ga-save").click(); } });
  async function createAlbum(name) {
    const ref = await addDoc(collection(db, "galleryAlbums"), {
      name, createdByUid: me.uid, createdByName: me.name || "", createdAt: serverTimestamp(),
    });
    return ref.id;
  }
  $("ga-save").addEventListener("click", async () => {
    const name = $("ga-name").value.trim();
    const msg = $("ga-msg");
    if (!name) { msg.textContent = "앨범 이름을 입력해 주세요."; msg.className = "form-msg error"; return; }
    if (albums.some((a) => a.name === name && a.id !== editingAlbum?.id)) {
      msg.textContent = "같은 이름의 앨범이 이미 있습니다."; msg.className = "form-msg error"; return;
    }
    try {
      if (editingAlbum) await updateDoc(doc(db, "galleryAlbums", editingAlbum.id), { name });
      else {
        const id = await createAlbum(name);
        // 올리기 모달이 열려 있으면 새 앨범을 바로 선택 상태로 추가
        if (modal.classList.contains("open")) { picked.add(id); renderPicker(); }
      }
      albumModal.classList.remove("open");
    } catch (err) {
      msg.textContent = "저장 실패: " + err.message; msg.className = "form-msg error";
    }
  });

  // ---------- 사진 올리기 / 수정 ----------
  const modal = $("gl-modal");
  let editing = null;          // 수정 중인 사진 (null = 새로 올리기)
  const picked = new Set();    // 선택된 앨범 id

  function renderPicker() {
    $("gl-picker").innerHTML = buildAlbumPicker(albums, [...picked]);
    $("gl-picker").querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => {
      const id = b.dataset.pick;
      if (picked.has(id)) picked.delete(id); else picked.add(id);
      renderPicker();
    }));
  }
  function openModal(photo) {
    editing = photo || null;
    picked.clear();
    if (photo) (photo.albumIds || []).forEach((id) => picked.add(id));
    else if (filter && filter !== NONE_ID && albums.some((a) => a.id === filter)) picked.add(filter);
    $("gl-modal-title").textContent = photo ? "사진 정보 수정" : "사진 올리기";
    $("gl-save").textContent = photo ? "저장" : "올리기";
    $("gl-files-field").style.display = photo ? "none" : "";
    $("gl-files").value = "";
    $("gl-file-list").innerHTML = "";
    $("gl-caption").value = photo ? (photo.caption || "") : "";
    $("gl-member-only").checked = photo ? photo.scope === "member" : false;
    $("gl-msg").className = "form-msg";
    renderPicker();
    modal.classList.add("open");
  }
  $("btn-gl-add").addEventListener("click", () => openModal(null));
  $("gl-new-album").addEventListener("click", () => openAlbumModal(null));
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
    const msg = $("gl-msg");
    const btn = $("gl-save");
    const caption = $("gl-caption").value.trim();
    const scope = $("gl-member-only").checked ? "member" : "public";
    const albumIds = [...picked].filter((id) => albums.some((a) => a.id === id));
    btn.disabled = true;
    try {
      if (editing) {
        await updateDoc(doc(db, "galleryPhotos", editing.id), { caption, scope, albumIds });
        modal.classList.remove("open");
        return;
      }
      const files = [...($("gl-files").files || [])];
      if (!files.length) { msg.textContent = "사진을 선택해 주세요."; msg.className = "form-msg error"; return; }
      for (let i = 0; i < files.length; i++) {
        btn.textContent = `올리는 중… (${i + 1}/${files.length})`;
        let dataUrl = await resizeImage(files[i], 1280, 0.82);
        if (dataUrl.length > 900000) dataUrl = await resizeImage(files[i], 900, 0.72);
        await addDoc(collection(db, "galleryPhotos"), {
          imageData: dataUrl, caption, albumIds, scope,
          date: isoToDot(todayIso()),
          authorUid: me.uid, authorName: me.name || "",
          createdAt: serverTimestamp(),
        });
      }
      modal.classList.remove("open");
    } catch (err) {
      msg.textContent = (editing ? "저장" : "업로드") + " 실패: " + err.message;
      msg.className = "form-msg error";
    } finally {
      btn.disabled = false;
      btn.textContent = editing ? "저장" : "올리기";
    }
  });
}
