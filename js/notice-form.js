// 공지 작성·수정 공용 모듈 (admin.html 공지 관리 / notice.html 공지 탭에서 함께 사용)
// - 글쓰기 모달(제목·작성자·날짜·공개범위·말머리·내용·첨부파일·슬라이더)
// - 첨부파일: noticeFiles/{fileId} + chunks 하위 컬렉션에 Base64 청크로 저장
//   (공개 글의 첨부는 비로그인 방문자도 내려받을 수 있도록 scope 필드를 함께 저장)

import {
  collection, doc, getDocs, addDoc, setDoc, updateDoc, deleteDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  createDropdown, createDatePicker, setupScopeToggle, setupMarkdownPreview,
  attachHelpTip, BADGE_OPTIONS, esc, fmtSize,
} from "./notice-ui.js";
// 첨부 칩은 notice-ui로 옮겼습니다. 기존 사용처 호환을 위해 재수출합니다.
export { attachmentChips } from "./notice-ui.js";

const MAX_FILE = 10 * 1024 * 1024;
const MAX_FILES = 5;
const CHUNK = 600 * 1024;

// "2026.07.01" ↔ "2026-07-01"
export const dotToIso = (s) => (s || "").trim().replaceAll(".", "-");
export const isoToDot = (s) => (s || "").trim().replaceAll("-", ".");
export const todayIso = () => {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
};

// ---------- Base64 청크 ----------
function bytesToBase64(bytes) {
  let bin = "";
  const BLOCK = 0x8000;
  for (let i = 0; i < bytes.length; i += BLOCK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + BLOCK));
  }
  return btoa(bin);
}
function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------- 파일 업로드/다운로드/삭제 ----------
export async function uploadNoticeFile(db, uid, file, scope) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const chunkCount = Math.max(1, Math.ceil(bytes.length / CHUNK));
  const ref = await addDoc(collection(db, "noticeFiles"), {
    name: file.name,
    type: file.type || "application/octet-stream",
    size: bytes.length,
    chunkCount,
    scope, // 'public' | 'member' — 공개 글 첨부만 비로그인 열람 허용
    uploaderUid: uid,
    createdAt: serverTimestamp(),
  });
  for (let i = 0; i < chunkCount; i++) {
    const part = bytes.subarray(i * CHUNK, (i + 1) * CHUNK);
    await setDoc(doc(db, "noticeFiles", ref.id, "chunks", String(i).padStart(4, "0")), {
      data: bytesToBase64(part),
    });
  }
  return { fileId: ref.id, name: file.name, type: file.type || "application/octet-stream", size: bytes.length };
}

export async function loadNoticeBlob(db, att) {
  const snap = await getDocs(collection(db, "noticeFiles", att.fileId, "chunks"));
  const parts = snap.docs.sort((a, b) => a.id.localeCompare(b.id)).map((d) => base64ToBytes(d.data().data));
  return new Blob(parts, { type: att.type || "application/octet-stream" });
}

export async function downloadNoticeAttachment(db, att, btn) {
  const original = btn ? btn.textContent : "";
  try {
    if (btn) { btn.disabled = true; btn.textContent = "다운로드 중…"; }
    const blob = await loadNoticeBlob(db, att);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = att.name || "file";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch (err) {
    alert("다운로드 실패: " + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = original; }
  }
}

export async function deleteNoticeFile(db, fileId) {
  const snap = await getDocs(collection(db, "noticeFiles", fileId, "chunks"));
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  await deleteDoc(doc(db, "noticeFiles", fileId));
}

export async function deleteNoticeAttachments(db, atts) {
  for (const a of atts || []) {
    try { await deleteNoticeFile(db, a.fileId); } catch (_) { /* 이미 삭제 등 무시 */ }
  }
}

// ---------- 첨부 이벤트 (게시판·상세 공용) ----------
export function bindAttachmentEvents(db, box, byKey) {
  box.querySelectorAll("button.att-dl").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const [key, idx] = btn.dataset.att.split(":");
      const att = byKey[key]?.attachments?.[Number(idx)];
      if (att) downloadNoticeAttachment(db, att, btn);
    });
  });
  box.querySelectorAll("button.att-view").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const [key, idx] = btn.dataset.view.split(":");
      const att = byKey[key]?.attachments?.[Number(idx)];
      const holder = box.querySelector(`[data-previews="${key}"]`);
      if (!att || !holder) return;
      const existing = holder.querySelector(`img[data-img="${key}:${idx}"]`);
      if (existing) { existing.remove(); btn.textContent = "미리보기"; return; }
      btn.disabled = true; btn.textContent = "불러오는 중…";
      try {
        const blob = await loadNoticeBlob(db, att);
        const img = document.createElement("img");
        img.dataset.img = `${key}:${idx}`;
        img.src = URL.createObjectURL(blob);
        img.alt = att.name;
        holder.appendChild(img);
        btn.textContent = "닫기";
      } catch (err) {
        alert("미리보기 실패: " + err.message);
        btn.textContent = "미리보기";
      } finally { btn.disabled = false; }
    });
  });
}

// ---------- 작성·수정 모달 컨트롤러 ----------
// 두 페이지 모두 동일한 ID의 모달 마크업을 갖습니다:
// edit-modal, edit-modal-title, edit-title, edit-author, edit-date, edit-scope,
// edit-badge, edit-content, edit-att-current, edit-files, edit-file-list,
// edit-slider, edit-cancel, edit-save, edit-msg
export function initNoticeEditor(db, getMe) {
  const $ = (id) => document.getElementById(id);

  // 제목은 한 줄 입력 — Enter로 줄바꿈이 들어가지 않게 막습니다
  $("edit-title").addEventListener("keydown", (e) => { if (e.key === "Enter") e.preventDefault(); });

  // 내용 라벨 옆 ? 아이콘 — 마크다운 서식 안내
  const mdHelp = $("edit-md-help");
  if (mdHelp) attachHelpTip(mdHelp,
    "<strong>마크다운 서식</strong>" +
    "<p>내용에 쓴 서식이 게시글에 그대로 반영됩니다. 미리보기 탭에서 결과를 확인할 수 있어요.</p>" +
    "<ul><li><b>**굵게**</b> · <b>*기울임*</b></li>" +
    "<li><b>## 소제목</b> — 줄 앞에 #, ##, ###</li>" +
    "<li><b>- 목록</b> · <b>1. 번호 목록</b></li>" +
    "<li><b>[텍스트](https://주소)</b> — 링크</li>" +
    "<li><b>&gt; 인용</b> · <b>---</b> 구분선</li></ul>");

  // 슬라이더 노출 옆 ? 아이콘 — 클릭하면 안내 팝오버
  const sliderHelp = $("edit-slider-help");
  if (sliderHelp) attachHelpTip(sliderHelp,
    "<strong>홈 화면 슬라이더 노출</strong>" +
    "<p>체크하면 이 공지가 홈 화면 상단 최신 소식 슬라이더에 표시됩니다.</p>" +
    "<ul><li>공개 범위가 <b>전체공개</b>인 글만 표시됩니다.</li>" +
    "<li>이미지를 첨부하면 첫 번째 이미지가 슬라이드 배경으로 쓰입니다.</li>" +
    "<li>배경 이미지는 2100×800px · 500KB 이하를 권장합니다.</li></ul>");
  const modal = $("edit-modal");
  let editing = null;        // 수정 대상 post (null이면 새 글)
  let keptAtts = [];         // 수정 시 유지되는 기존 첨부

  // UI 위젯: 말머리 드롭다운 · 자물쇠 공개 범위 · 마크다운 미리보기
  const badgeDd = createDropdown($("edit-badge-dd"), {
    values: BADGE_OPTIONS,
    onChange: (v) => { $("edit-badge").value = v; },
  });
  const scope = setupScopeToggle($("edit-scope-toggle"), $("edit-scope-label"), $("edit-scope"));
  const datePicker = createDatePicker($("edit-date-dp"), $("edit-date"));
  const preview = setupMarkdownPreview({
    writeBtn: $("edit-mode-write"),
    previewBtn: $("edit-mode-preview"),
    textarea: $("edit-content"),
    preview: $("edit-preview"),
  });

  // 새 첨부 선택 미리보기
  $("edit-files").addEventListener("change", () => {
    const files = [...($("edit-files").files || [])];
    $("edit-file-list").innerHTML = files.map((f) =>
      `<div class="file-row">📎 <span class="f-name">${esc(f.name)}</span><span class="f-size">${fmtSize(f.size)}</span></div>`
    ).join("");
  });

  function renderKept() {
    const box = $("edit-att-current");
    if (!keptAtts.length) { box.innerHTML = ""; return; }
    box.innerHTML = `<div class="hint" style="margin-bottom:4px;">기존 첨부파일 — ✕를 누르면 저장 시 삭제됩니다.</div>` +
      keptAtts.map((a, i) =>
        `<div class="file-row">📎 <span class="f-name">${esc(a.name)}</span><span class="f-size">${fmtSize(a.size)}</span>
          <button type="button" class="att-remove" data-i="${i}" title="삭제">✕</button></div>`
      ).join("");
    box.querySelectorAll(".att-remove").forEach((btn) => {
      btn.addEventListener("click", () => {
        keptAtts.splice(Number(btn.dataset.i), 1);
        renderKept();
      });
    });
  }

  function open(post) {
    const me = getMe();
    editing = post || null;
    keptAtts = post ? [...(post.attachments || [])] : [];
    $("edit-modal-title").textContent = post ? "공지 수정" : "새 공지 작성";
    $("edit-title").value = post ? post.title : "";
    $("edit-author").value = post ? (post.authorName || me?.name || "") : (me?.name || "");
    datePicker.set(post ? dotToIso(post.date) : todayIso());
    scope.set(post ? post.scope === "member" : false, { animate: false });
    badgeDd.set(post ? (post.badge || "") : "");
    $("edit-badge").value = post ? (post.badge || "") : "";
    $("edit-content").value = post ? (post.content || "") : "";
    preview.reset();
    $("edit-slider").checked = post ? !!post.slider : false;
    $("edit-files").value = "";
    $("edit-file-list").innerHTML = "";
    $("edit-msg").className = "form-msg";
    renderKept();
    modal.classList.add("open");
  }

  $("edit-cancel").addEventListener("click", () => modal.classList.remove("open"));
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.remove("open"); });

  $("edit-save").addEventListener("click", async () => {
    const me = getMe();
    const msg = $("edit-msg");
    const btn = $("edit-save");
    const showErr = (t) => { msg.textContent = t; msg.className = "form-msg error"; };

    const title = $("edit-title").value.trim();
    if (!title) return showErr("제목을 입력해 주세요.");
    const scope = $("edit-scope").value === "공개" ? "public" : "member";
    const newFiles = [...($("edit-files").files || [])];
    if (keptAtts.length + newFiles.length > MAX_FILES)
      return showErr(`첨부파일은 최대 ${MAX_FILES}개까지 가능합니다. (기존 ${keptAtts.length}개 포함)`);
    const big = newFiles.find((f) => f.size > MAX_FILE);
    if (big) return showErr(`"${big.name}" 파일이 10MB를 초과합니다.`);

    btn.disabled = true;
    try {
      // 1) 새 파일 업로드
      const uploaded = [];
      for (let i = 0; i < newFiles.length; i++) {
        btn.textContent = `업로드 중… (${i + 1}/${newFiles.length})`;
        uploaded.push(await uploadNoticeFile(db, me.uid, newFiles[i], scope));
      }
      // 2) 수정 시: 제거된 기존 첨부 삭제
      if (editing) {
        const keptIds = new Set(keptAtts.map((a) => a.fileId));
        const removed = (editing.attachments || []).filter((a) => !keptIds.has(a.fileId));
        await deleteNoticeAttachments(db, removed);
        // 3) 공개 범위가 바뀌었으면 유지되는 첨부의 scope도 갱신
        if (editing.scope !== scope) {
          for (const a of keptAtts) {
            try { await updateDoc(doc(db, "noticeFiles", a.fileId), { scope }); } catch (_) {}
          }
        }
      }
      btn.textContent = "저장 중…";
      const data = {
        title,
        date: isoToDot($("edit-date").value) || isoToDot(todayIso()),
        scope,
        badge: $("edit-badge").value.trim(),
        content: $("edit-content").value.trim(),
        attachments: [...keptAtts, ...uploaded],
        authorName: $("edit-author").value.trim() || me?.name || "",
        authorUid: editing ? (editing.authorUid || me.uid) : me.uid,
        slider: $("edit-slider").checked,
        updatedAt: serverTimestamp(),
      };
      if (editing) await updateDoc(doc(db, "posts", editing.id), data);
      else await addDoc(collection(db, "posts"), { ...data, createdAt: serverTimestamp() });
      modal.classList.remove("open");
    } catch (err) {
      showErr("저장 실패: " + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "저장";
    }
  });

  return { open };
}
