// 범용 파일 저장 모듈 — Firestore Base64 청크 방식
// 임의의 최상위 컬렉션({coll}/{fileId} + chunks 하위 컬렉션)에 파일을 저장/조회/삭제합니다.
// 성과(publications)의 원문 PDF 첨부에 사용하며(pubFiles), 이후 자료실 등에도 재사용할 수 있습니다.

import {
  collection, doc, getDocs, addDoc, setDoc, deleteDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const MAX_STORED_FILE = 10 * 1024 * 1024; // 10MB
const CHUNK = 600 * 1024;

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

// 업로드 → { fileId, name, type, size } 반환
export async function uploadStoredFile(db, coll, uid, file, extra = {}) {
  if (file.size > MAX_STORED_FILE) throw new Error(`"${file.name}" 파일이 10MB를 초과합니다.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const chunkCount = Math.max(1, Math.ceil(bytes.length / CHUNK));
  const ref = await addDoc(collection(db, coll), {
    name: file.name,
    type: file.type || "application/octet-stream",
    size: bytes.length,
    chunkCount,
    uploaderUid: uid,
    createdAt: serverTimestamp(),
    ...extra,
  });
  for (let i = 0; i < chunkCount; i++) {
    const part = bytes.subarray(i * CHUNK, (i + 1) * CHUNK);
    await setDoc(doc(db, coll, ref.id, "chunks", String(i).padStart(4, "0")), {
      data: bytesToBase64(part),
      uploaderUid: uid,
    });
  }
  return { fileId: ref.id, name: file.name, type: file.type || "application/octet-stream", size: bytes.length };
}

export async function loadStoredBlob(db, coll, att) {
  const snap = await getDocs(collection(db, coll, att.fileId, "chunks"));
  const parts = snap.docs.sort((a, b) => a.id.localeCompare(b.id)).map((d) => base64ToBytes(d.data().data));
  return new Blob(parts, { type: att.type || "application/octet-stream" });
}

export async function downloadStoredFile(db, coll, att, btn) {
  const original = btn ? btn.textContent : "";
  try {
    if (btn) { btn.disabled = true; btn.textContent = "다운로드 중…"; }
    const blob = await loadStoredBlob(db, coll, att);
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

export async function deleteStoredFile(db, coll, fileId) {
  const snap = await getDocs(collection(db, coll, fileId, "chunks"));
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  await deleteDoc(doc(db, coll, fileId));
}

export const fmtStoredSize = (b) => {
  if (b == null) return "";
  if (b < 1024) return b + "B";
  if (b < 1024 * 1024) return (b / 1024).toFixed(0) + "KB";
  return (b / (1024 * 1024)).toFixed(1) + "MB";
};
