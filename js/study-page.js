// 스터디 상세 페이지 (study-detail.html?id=...) — 멤버 전용
// 회차 타임라인(진행 요일 반영), 미팅 링크, 공지·자료 게시판(글쓰기 모달 + 첨부파일 직접 업로드/다운로드)
//
// 첨부파일은 Firebase Storage 대신 Firestore에 Base64 청크로 저장합니다.
// (요금제 업그레이드 없이 무료 플랜에서 동작. 파일당 10MB 제한)

import { auth, db, isConfigured } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc, onSnapshot,
  query, orderBy, serverTimestamp, Timestamp, arrayUnion, arrayRemove, deleteField,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { initTeamChat } from "./chat-room.js";

if (isConfigured) {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const pad = (n) => String(n).padStart(2, "0");
  const fmtDate = (ts) => {
    if (!ts || !ts.toDate) return "";
    const d = ts.toDate();
    return d.getFullYear() + "." + pad(d.getMonth() + 1) + "." + pad(d.getDate());
  };
  const fmtDateTime = (ts) => {
    if (!ts || !ts.toDate) return "";
    const d = ts.toDate();
    return fmtDate(ts) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  };
  const fmtDateStr = (s) => (s ? s.replaceAll("-", ".") : ""); // "YYYY-MM-DD" → "YYYY.MM.DD"
  const fmtSize = (b) => {
    if (b == null) return "";
    if (b < 1024) return b + "B";
    if (b < 1024 * 1024) return (b / 1024).toFixed(0) + "KB";
    return (b / (1024 * 1024)).toFixed(1) + "MB";
  };
  const nowLocal = () => {
    const d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  };

  const STATUS_LABEL = { recruiting: "모집 중", active: "운영 중", ended: "종료" };
  const STATUS_CLS = { recruiting: "pending", active: "approved", ended: "member" };
  const MODE_LABEL = { online: "온라인", offline: "오프라인", hybrid: "온·오프라인 병행" };
  const DAYS = [ // JS getDay(): 0=일 … 6=토, 표시는 월→일 순
    { v: 1, l: "월" }, { v: 2, l: "화" }, { v: 3, l: "수" }, { v: 4, l: "목" },
    { v: 5, l: "금" }, { v: 6, l: "토" }, { v: 0, l: "일" },
  ];
  const DAY_LABEL = { 0: "일", 1: "월", 2: "화", 3: "수", 4: "목", 5: "금", 6: "토" };

  const MAX_FILE = 10 * 1024 * 1024; // 10MB
  const MAX_FILES = 5;
  const CHUNK = 600 * 1024;          // 청크당 600KB(원본 기준) → Base64 약 800KB < 문서 1MB 한도

  const studyId = new URLSearchParams(location.search).get("id");
  let me = null;
  let study = null;
  let accounts = null; // 멤버 계정 목록 (리더/관리자용, 지연 로드)
  let chatInited = false;
  const openPosts = new Set(); // 펼쳐 둔 공지 유지용

  if (!studyId) {
    $("sd-title").textContent = "잘못된 접근입니다.";
  } else {
    onAuthStateChanged(auth, async (user) => {
      if (!user) { location.href = "login.html"; return; }
      const snap = await getDoc(doc(db, "users", user.uid));
      const data = snap.exists() ? snap.data() : null;
      if (!data || (data.role !== "member" && data.role !== "admin")) {
        alert("승인된 멤버만 이용할 수 있는 페이지입니다.");
        location.href = "index.html";
        return;
      }
      me = { uid: user.uid, ...data };
      init();
    });
  }

  function init() {
    buildDayPicker($("sd-days"));

    onSnapshot(doc(db, "studies", studyId), (snap) => {
      if (!snap.exists()) {
        $("sd-title").textContent = "존재하지 않는 스터디입니다.";
        return;
      }
      study = { id: snap.id, ...snap.data() };
      renderHead();
    }, (err) => {
      $("sd-title").textContent = "불러오기 실패: " + (err.code || err.message);
    });

    watchPosts();
    watchMaterials();
    bindManage();
    bindPostModal();
    bindMatModal();
  }

  function buildDayPicker(box) {
    box.innerHTML = DAYS.map((d) => `
      <label class="day-chip"><input type="checkbox" value="${d.v}" /><span>${d.l}</span></label>
    `).join("");
  }
  const pickedDays = (box) => [...box.querySelectorAll("input:checked")].map((i) => Number(i.value));
  const setPickedDays = (box, days) => {
    const set = new Set((days || []).map(Number));
    box.querySelectorAll("input").forEach((i) => { i.checked = set.has(Number(i.value)); });
  };

  // ================= 헤더 + 타임라인 =================
  function renderHead() {
    const s = study;
    const isLeader = s.leaderUid === me.uid;
    const isAdmin = me.role === "admin";
    const joined = (s.participantsUids || []).includes(me.uid);

    // 팀 채팅: 참여자(또는 관리자)에게 1회 초기화
    if (!chatInited && (joined || isAdmin)) {
      chatInited = true;
      initTeamChat({
        db, me,
        type: "study",
        refId: studyId,
        refTitle: s.title,
        getParticipants: () => ({ ...(study.participantsNames || {}) }),
        isAdmin,
      });
    }

    document.title = s.title + " | 한신대학교 임상심리 연구실";
    $("sd-title").textContent = s.title;
    const badge = $("sd-status-badge");
    badge.textContent = STATUS_LABEL[s.status] || s.status;
    badge.className = "status " + (STATUS_CLS[s.status] || "member");

    const opened = s.openedDate ? fmtDateStr(s.openedDate) : fmtDate(s.createdAt);
    const bits = [`리더 <strong>${esc(s.leaderName)}</strong>`];
    if (s.mode && MODE_LABEL[s.mode]) bits.push(esc(MODE_LABEL[s.mode]));
    if (s.schedule) bits.push(esc(s.schedule));
    if (opened) bits.push("개설 " + opened);
    $("sd-meta").innerHTML = bits.join(" · ");
    $("sd-desc").textContent = s.desc || "";

    $("sd-meeting").innerHTML = s.meetingUrl
      ? `<a class="btn-meeting" href="${esc(s.meetingUrl)}" target="_blank" rel="noopener noreferrer">🎥 온라인 미팅 참여하기</a>`
      : "";

    renderTimeline(s);

    const names = Object.values(s.participantsNames || {});
    $("sd-participants").innerHTML = `참여자 <strong>${names.length}명</strong>${names.length ? " — " + esc(names.join(", ")) : ""}`;

    // 모집 기간이 지난 recruiting 스터디: 리더·관리자 방문 시 "운영 중"으로 자동 전환
    const _today = new Date();
    const _todayStr = _today.getFullYear() + "-" + String(_today.getMonth() + 1).padStart(2, "0") + "-" + String(_today.getDate()).padStart(2, "0");
    if (s.status === "recruiting" && s.recruitEnd && _todayStr > s.recruitEnd && (isAdmin || isLeader)) {
      updateDoc(doc(db, "studies", studyId), { status: "active" }).catch(() => {});
    }

    // 참여/취소 버튼
    const actions = $("sd-actions");
    actions.innerHTML = "";
    const recruitingNow = s.status === "recruiting" && (!s.recruitEnd || _todayStr <= s.recruitEnd) && (s.capacity || s.recruitEnd);
    if (!joined && recruitingNow) {
      // 정원·모집기간이 설정된 모집 중 스터디는 목록 페이지의 신청 절차로 안내 (정원 우회 방지)
      const a = document.createElement("a");
      a.className = "btn-sm primary";
      a.style.textDecoration = "none";
      a.href = "study.html";
      a.textContent = "모집 페이지에서 신청하기 →";
      actions.appendChild(a);
    } else if (s.status !== "ended") {
      const btn = document.createElement("button");
      btn.className = joined ? "btn-sm" : "btn-sm primary";
      btn.textContent = joined ? "참여 취소" : "참여하기";
      btn.addEventListener("click", async () => {
        try {
          if (joined) {
            if (isLeader) { alert("리더는 참여를 취소할 수 없습니다."); return; }
            await updateDoc(doc(db, "studies", studyId), {
              participantsUids: arrayRemove(me.uid),
              ["participantsNames." + me.uid]: deleteField(),
            });
          } else {
            await updateDoc(doc(db, "studies", studyId), {
              participantsUids: arrayUnion(me.uid),
              ["participantsNames." + me.uid]: me.name,
            });
          }
        } catch (err) { alert("처리 실패: " + err.message); }
      });
      actions.appendChild(btn);
    }

    // 리더 관리 영역 + 공지 글쓰기 버튼 노출
    const manage = $("sd-manage");
    if (isLeader || isAdmin) {
      manage.style.display = "";
      const editing = document.activeElement && manage.contains(document.activeElement);
      if (!editing) {
        $("sd-meeting-url").value = s.meetingUrl || "";
        $("sd-weeks").value = s.totalWeeks || "";
        $("sd-start").value = s.startDate || "";
        $("sd-status").value = s.status;
        $("sd-mode").value = s.mode || "online";
        $("sd-opened").value = s.openedDate || "";
        setPickedDays($("sd-days"), s.days);
        // 리더 지정: 참여자 목록으로 옵션 구성
        const leaderSel = $("sd-leader");
        const entries = Object.entries(s.participantsNames || {});
        if (!entries.some(([uid]) => uid === s.leaderUid) && s.leaderUid) {
          entries.unshift([s.leaderUid, s.leaderName || "현재 리더"]);
        }
        leaderSel.innerHTML = entries.map(([uid, name]) =>
          `<option value="${esc(uid)}"${uid === s.leaderUid ? " selected" : ""}>${esc(name)}${uid === s.leaderUid ? " (현재 리더)" : ""}</option>`
        ).join("");
        refreshAddMemberOptions();
      }
      $("sd-post-toolbar").style.display = "";
    } else {
      manage.style.display = "none";
      $("sd-post-toolbar").style.display = "none";
    }
  }

  // ---------- 타임라인: 진행 요일이 있으면 회차 단위, 없으면 주차 단위 ----------
  function renderTimeline(s) {
    const wrap = $("sd-timeline-wrap");
    const total = parseInt(s.totalWeeks) || 0;
    if (!total || total < 1 || total > 52 || !s.startDate) {
      wrap.style.display = "none";
      return;
    }
    const start = new Date(s.startDate + "T00:00:00");
    if (isNaN(start)) { wrap.style.display = "none"; return; }

    const days = [...new Set((s.days || []).map(Number))];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const ended = s.status === "ended";
    const fmt = (d) => (d.getMonth() + 1) + "/" + d.getDate();
    const DAY_MS = 24 * 3600 * 1000;

    let html = "";

    if (days.length) {
      // 회차 모드: 주차별 그룹 안에 선택 요일 세션을 표시 (예: 토·일 → 한 주 2회)
      let currentMarked = false;
      for (let w = 1; w <= total; w++) {
        const weekStart = new Date(start.getTime() + (w - 1) * 7 * DAY_MS);
        const sessions = [];
        for (let off = 0; off < 7; off++) {
          const d = new Date(weekStart.getTime() + off * DAY_MS);
          if (days.includes(d.getDay())) sessions.push(d);
        }
        if (!sessions.length) continue;

        const nodes = sessions.map((d) => {
          let cls = "";
          if (ended || d < today) cls = "done";
          else if (!currentMarked) { cls = "current"; currentMarked = true; }
          return `<div class="tl-node ${cls}">
            <div class="tl-dot"></div>
            <div class="tl-day">${DAY_LABEL[d.getDay()]}</div>
            <div class="tl-date">${fmt(d)}</div>
          </div>`;
        }).join('<div class="tl-line short"></div>');

        const weekDone = ended || sessions[sessions.length - 1] < today;
        html += `<div class="tl-group${weekDone ? " done" : ""}">
          <div class="tl-week">${w}주차</div>
          <div class="tl-sessions">${nodes}</div>
        </div>`;
        if (w < total) html += `<div class="tl-line gap${weekDone ? " done" : ""}"></div>`;
      }
    } else {
      // 주차 모드(기존 방식)
      let currentWeek = Math.floor((today - start) / (7 * DAY_MS)) + 1;
      if (ended) currentWeek = total + 1;
      for (let i = 1; i <= total; i++) {
        const wDate = new Date(start.getTime() + (i - 1) * 7 * DAY_MS);
        const cls = i < currentWeek ? "done" : i === currentWeek ? "current" : "";
        html += `<div class="tl-node ${cls}">
          <div class="tl-dot"></div>
          <div class="tl-week">${i}주차</div>
          <div class="tl-date">${fmt(wDate)}</div>
        </div>`;
        if (i < total) html += `<div class="tl-line ${i < currentWeek ? "done" : ""}"></div>`;
      }
    }

    $("sd-timeline").innerHTML = html;
    wrap.style.display = "";
  }

  // ================= 리더 관리 =================
  async function refreshAddMemberOptions() {
    const sel = $("sd-add-member");
    if (!sel || !study) return;
    try {
      if (!accounts) {
        const snap = await getDocs(collection(db, "users"));
        accounts = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((u) => u.role === "member" || u.role === "admin");
      }
    } catch (_) {
      sel.innerHTML = '<option value="">멤버 목록을 불러올 수 없습니다 (보안 규칙 확인)</option>';
      return;
    }
    const joined = new Set(study.participantsUids || []);
    const candidates = accounts.filter((u) => !joined.has(u.id));
    sel.innerHTML = candidates.length
      ? '<option value="" disabled selected>멤버 선택</option>' + candidates.map((u) =>
          `<option value="${esc(u.id)}">${esc(u.name)} (${esc([u.position, u.affiliation].filter(Boolean).join(" · ") || u.email)})</option>`
        ).join("")
      : '<option value="">추가할 수 있는 멤버가 없습니다</option>';
  }

  function bindManage() {
    $("sd-add-member-btn").addEventListener("click", async () => {
      const uid = $("sd-add-member").value;
      if (!uid || !accounts) return;
      const u = accounts.find((x) => x.id === uid);
      if (!u) return;
      try {
        await updateDoc(doc(db, "studies", studyId), {
          participantsUids: arrayUnion(uid),
          ["participantsNames." + uid]: u.name,
        });
      } catch (err) { alert("추가 실패: " + err.message); }
    });

    $("sd-manage-save").addEventListener("click", async () => {
      const msg = $("sd-msg");
      let url = $("sd-meeting-url").value.trim();
      if (url && !/^https?:\/\//i.test(url)) url = "https://" + url;
      try {
        const newLeaderUid = $("sd-leader").value || study.leaderUid;
        const newLeaderName = (study.participantsNames || {})[newLeaderUid] || study.leaderName;
        const leaderChanged = newLeaderUid !== study.leaderUid;
        if (leaderChanged && !confirm(`리더를 "${newLeaderName}" 님으로 변경할까요?\n변경 후에는 새 리더(또는 관리자)만 이 관리 패널을 사용할 수 있습니다.`)) {
          return;
        }
        await updateDoc(doc(db, "studies", studyId), {
          meetingUrl: url,
          totalWeeks: $("sd-weeks").value.trim(),
          startDate: $("sd-start").value,
          status: $("sd-status").value,
          mode: $("sd-mode").value,
          openedDate: $("sd-opened").value,
          days: pickedDays($("sd-days")),
          leaderUid: newLeaderUid,
          leaderName: newLeaderName,
        });
        msg.textContent = "저장되었습니다.";
        msg.className = "form-msg ok";
        setTimeout(() => (msg.className = "form-msg"), 2500);
      } catch (err) {
        msg.textContent = "저장 실패: " + err.message;
        msg.className = "form-msg error";
      }
    });

    $("sd-delete").addEventListener("click", async () => {
      if (!study) return;
      if (!confirm(`"${study.title}" 스터디를 삭제할까요?\n공지·자료·첨부파일이 모두 함께 삭제됩니다.`)) return;
      const btn = $("sd-delete");
      btn.disabled = true; btn.textContent = "삭제 중…";
      try {
        await cleanupSubcollections();
        await deleteDoc(doc(db, "studies", studyId));
        location.href = "study.html";
      } catch (err) {
        alert("삭제 실패: " + err.message);
        btn.disabled = false; btn.textContent = "스터디 삭제";
      }
    });
  }

  async function cleanupSubcollections() {
    // 첨부파일 청크 → 파일 문서 → 공지/자료 문서 순으로 정리
    const filesSnap = await getDocs(collection(db, "studies", studyId, "files"));
    for (const f of filesSnap.docs) await deleteFileDoc(f.id);
    for (const sub of ["posts", "materials"]) {
      const snap = await getDocs(collection(db, "studies", studyId, sub));
      await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
    }
  }

  // ================= 첨부파일: 업로드 / 다운로드 / 삭제 =================
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

  // 파일 1개 업로드 → { fileId, name, type, size } 반환
  async function uploadFile(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const chunkCount = Math.max(1, Math.ceil(bytes.length / CHUNK));
    const fileRef = await addDoc(collection(db, "studies", studyId, "files"), {
      name: file.name,
      type: file.type || "application/octet-stream",
      size: bytes.length,
      chunkCount,
      uploaderUid: me.uid,
      uploaderName: me.name,
      createdAt: serverTimestamp(),
    });
    for (let i = 0; i < chunkCount; i++) {
      const part = bytes.subarray(i * CHUNK, (i + 1) * CHUNK);
      await setDoc(
        doc(db, "studies", studyId, "files", fileRef.id, "chunks", String(i).padStart(4, "0")),
        { data: bytesToBase64(part), uploaderUid: me.uid }
      );
    }
    return { fileId: fileRef.id, name: file.name, type: file.type || "application/octet-stream", size: bytes.length };
  }

  async function loadFileBlob(att) {
    const snap = await getDocs(collection(db, "studies", studyId, "files", att.fileId, "chunks"));
    const parts = snap.docs
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((d) => base64ToBytes(d.data().data));
    return new Blob(parts, { type: att.type || "application/octet-stream" });
  }

  async function downloadAttachment(att, btn) {
    const original = btn ? btn.textContent : "";
    try {
      if (btn) { btn.disabled = true; btn.textContent = "다운로드 중…"; }
      const blob = await loadFileBlob(att);
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

  async function deleteFileDoc(fileId) {
    const chunksSnap = await getDocs(collection(db, "studies", studyId, "files", fileId, "chunks"));
    await Promise.all(chunksSnap.docs.map((d) => deleteDoc(d.ref)));
    await deleteDoc(doc(db, "studies", studyId, "files", fileId));
  }

  async function deleteAttachments(atts) {
    for (const a of atts || []) {
      try { await deleteFileDoc(a.fileId); } catch (_) { /* 권한/이미 삭제 등은 무시 */ }
    }
  }

  // ---------- 첨부 UI 공통 ----------
  function validateFiles(input, msgEl) {
    const files = [...(input.files || [])];
    if (files.length > MAX_FILES) {
      msgEl.textContent = `첨부파일은 최대 ${MAX_FILES}개까지 올릴 수 있습니다.`;
      msgEl.className = "form-msg error";
      return null;
    }
    const big = files.find((f) => f.size > MAX_FILE);
    if (big) {
      msgEl.textContent = `"${big.name}" 파일이 10MB를 초과합니다.`;
      msgEl.className = "form-msg error";
      return null;
    }
    return files;
  }

  function bindFilePreview(input, listEl) {
    input.addEventListener("change", () => {
      const files = [...(input.files || [])];
      listEl.innerHTML = files.map((f) =>
        `<div class="file-row"><span class="f-name">${esc(f.name)}</span><span class="f-size">${fmtSize(f.size)}</span></div>`
      ).join("");
    });
  }

  function attachmentChips(atts, postKey) {
    if (!atts || !atts.length) return "";
    return `<div class="att-list">` + atts.map((a, i) => {
      const isImg = (a.type || "").startsWith("image/");
      return `<span class="att-chip">
        <button type="button" class="att-dl" data-att="${postKey}:${i}" title="다운로드">${esc(a.name)} <small>${fmtSize(a.size)}</small></button>
        ${isImg ? `<button type="button" class="att-view" data-view="${postKey}:${i}">미리보기</button>` : ""}
      </span>`;
    }).join("") + `</div><div class="att-previews" data-previews="${postKey}"></div>`;
  }

  function bindAttachmentEvents(box, itemsByKey) {
    box.querySelectorAll("button.att-dl").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const [key, idx] = btn.dataset.att.split(":");
        const att = itemsByKey[key]?.attachments?.[Number(idx)];
        if (att) downloadAttachment(att, btn);
      });
    });
    box.querySelectorAll("button.att-view").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const [key, idx] = btn.dataset.view.split(":");
        const att = itemsByKey[key]?.attachments?.[Number(idx)];
        const holder = box.querySelector(`[data-previews="${key}"]`);
        if (!att || !holder) return;
        const existing = holder.querySelector(`img[data-img="${key}:${idx}"]`);
        if (existing) { existing.remove(); btn.textContent = "미리보기"; return; }
        btn.disabled = true; btn.textContent = "불러오는 중…";
        try {
          const blob = await loadFileBlob(att);
          const img = document.createElement("img");
          img.dataset.img = `${key}:${idx}`;
          img.src = URL.createObjectURL(blob);
          img.alt = att.name;
          holder.appendChild(img);
          btn.textContent = "닫기";
        } catch (err) {
          alert("미리보기 실패: " + err.message);
          btn.textContent = "미리보기";
        } finally {
          btn.disabled = false;
        }
      });
    });
  }

  // ================= 공지 (게시판) =================
  function watchPosts() {
    const box = $("sd-posts");
    onSnapshot(query(collection(db, "studies", studyId, "posts"), orderBy("createdAt", "desc")), (snap) => {
      const posts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (!posts.length) {
        box.innerHTML = '<p style="color:var(--muted); font-size:0.9rem; padding:12px 4px;">아직 공지가 없습니다.</p>';
        return;
      }
      const byKey = {};
      box.innerHTML = posts.map((p) => {
        byKey[p.id] = p;
        const canDelete = me.role === "admin" || p.authorUid === me.uid;
        const open = openPosts.has(p.id);
        const attCount = (p.attachments || []).length;
        return `<div class="board-item${open ? " open" : ""}" data-post="${p.id}">
          <button type="button" class="b-row" data-toggle="${p.id}">
            <span class="b-title">${esc(p.title)}${attCount ? ` <span class="b-att">${attCount}</span>` : ""}</span>
            <span class="b-meta">${esc(p.authorName)} · ${fmtDateTime(p.createdAt)}</span>
          </button>
          <div class="b-detail"${open ? "" : " hidden"}>
            ${p.content ? `<div class="b-body">${esc(p.content)}</div>` : ""}
            ${attachmentChips(p.attachments, p.id)}
            ${canDelete ? `<div class="b-actions"><button class="btn-sm danger" data-post-del="${p.id}">삭제</button></div>` : ""}
          </div>
        </div>`;
      }).join("");

      box.querySelectorAll("button[data-toggle]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const item = btn.closest(".board-item");
          const detail = item.querySelector(".b-detail");
          const id = btn.dataset.toggle;
          if (detail.hidden) { detail.hidden = false; item.classList.add("open"); openPosts.add(id); }
          else { detail.hidden = true; item.classList.remove("open"); openPosts.delete(id); }
        });
      });

      box.querySelectorAll("button[data-post-del]").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const p = byKey[btn.dataset.postDel];
          if (!confirm("이 공지를 삭제할까요? 첨부파일도 함께 삭제됩니다.")) return;
          try {
            await deleteAttachments(p.attachments);
            await deleteDoc(doc(db, "studies", studyId, "posts", p.id));
          } catch (err) { alert("삭제 실패: " + err.message); }
        });
      });

      bindAttachmentEvents(box, byKey);
    }, (err) => {
      box.innerHTML = `<p style="color:var(--danger); font-size:0.9rem; padding:12px 4px;">불러오기 실패: ${esc(err.code || err.message)}</p>`;
    });
  }

  function bindPostModal() {
    const modal = $("post-modal");
    bindFilePreview($("sp-files"), $("sp-file-list"));
    $("btn-write-post").addEventListener("click", () => {
      $("sp-when").value = nowLocal();
      $("sp-author").value = me.name || "";
      $("sp-title").value = "";
      $("sp-content").value = "";
      $("sp-files").value = "";
      $("sp-file-list").innerHTML = "";
      $("sp-msg").className = "form-msg";
      modal.classList.add("open");
    });
    $("sp-cancel").addEventListener("click", () => modal.classList.remove("open"));
    modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.remove("open"); });

    $("sp-add").addEventListener("click", async () => {
      const msg = $("sp-msg");
      const btn = $("sp-add");
      const title = $("sp-title").value.trim();
      if (!title) { msg.textContent = "공지 제목을 입력해 주세요."; msg.className = "form-msg error"; return; }
      const when = $("sp-when").value ? new Date($("sp-when").value) : new Date();
      if (isNaN(when)) { msg.textContent = "작성일시가 올바르지 않습니다."; msg.className = "form-msg error"; return; }
      const files = validateFiles($("sp-files"), msg);
      if (files === null) return;

      btn.disabled = true;
      try {
        const attachments = [];
        for (let i = 0; i < files.length; i++) {
          btn.textContent = `업로드 중… (${i + 1}/${files.length})`;
          attachments.push(await uploadFile(files[i]));
        }
        btn.textContent = "등록 중…";
        await addDoc(collection(db, "studies", studyId, "posts"), {
          title,
          content: $("sp-content").value.trim(),
          attachments,
          authorUid: me.uid,
          authorName: $("sp-author").value.trim() || me.name,
          createdAt: Timestamp.fromDate(when),
        });
        modal.classList.remove("open");
      } catch (err) {
        msg.textContent = "등록 실패: " + err.message;
        msg.className = "form-msg error";
      } finally {
        btn.disabled = false;
        btn.textContent = "공지 올리기";
      }
    });
  }

  // ================= 자료 (게시판 + 직접 업로드) =================
  function watchMaterials() {
    const box = $("sd-materials");
    onSnapshot(query(collection(db, "studies", studyId, "materials"), orderBy("createdAt", "desc")), (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (!items.length) {
        box.innerHTML = '<p style="color:var(--muted); font-size:0.9rem; padding:12px 4px;">아직 등록된 자료가 없습니다. 첫 자료를 올려보세요.</p>';
        return;
      }
      const byKey = {};
      box.innerHTML = items.map((m) => {
        byKey[m.id] = m;
        const canDelete = me.role === "admin" || m.uploaderUid === me.uid;
        return `<div class="board-item mat">
          <div class="b-row static">
            <span class="b-title">${esc(m.title)}</span>
            <span class="b-meta">${esc(m.uploaderName)} · ${fmtDateTime(m.createdAt)}</span>
          </div>
          <div class="b-detail">
            ${m.note ? `<div class="b-body">${esc(m.note)}</div>` : ""}
            ${m.link ? `<div class="b-body"><a class="link-chip" href="${esc(m.link)}" target="_blank" rel="noopener noreferrer" style="color:var(--indigo); font-weight:600;">외부 링크 열기</a></div>` : ""}
            ${attachmentChips(m.attachments, m.id)}
            ${canDelete ? `<div class="b-actions"><button class="btn-sm danger" data-del="${m.id}">삭제</button></div>` : ""}
          </div>
        </div>`;
      }).join("");

      box.querySelectorAll("button[data-del]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const m = byKey[btn.dataset.del];
          if (!confirm("이 자료를 삭제할까요? 첨부파일도 함께 삭제됩니다.")) return;
          try {
            await deleteAttachments(m.attachments);
            await deleteDoc(doc(db, "studies", studyId, "materials", m.id));
          } catch (err) { alert("삭제 실패: " + err.message); }
        });
      });

      bindAttachmentEvents(box, byKey);
    }, (err) => {
      box.innerHTML = `<p style="color:var(--danger); font-size:0.9rem; padding:12px 4px;">불러오기 실패: ${esc(err.code || err.message)}</p>`;
    });
  }

  function bindMatModal() {
    const modal = $("mat-modal");
    bindFilePreview($("sm-files"), $("sm-file-list"));
    $("btn-write-mat").addEventListener("click", () => {
      $("sm-when").value = nowLocal();
      $("sm-author").value = me.name || "";
      $("sm-title").value = "";
      $("sm-note").value = "";
      $("sm-files").value = "";
      $("sm-file-list").innerHTML = "";
      $("sm-msg").className = "form-msg";
      modal.classList.add("open");
    });
    $("sm-cancel").addEventListener("click", () => modal.classList.remove("open"));
    modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.remove("open"); });

    $("sm-add").addEventListener("click", async () => {
      const msg = $("sm-msg");
      const btn = $("sm-add");
      const title = $("sm-title").value.trim();
      if (!title) { msg.textContent = "자료 제목을 입력해 주세요."; msg.className = "form-msg error"; return; }
      const when = $("sm-when").value ? new Date($("sm-when").value) : new Date();
      if (isNaN(when)) { msg.textContent = "작성일시가 올바르지 않습니다."; msg.className = "form-msg error"; return; }
      const files = validateFiles($("sm-files"), msg);
      if (files === null) return;
      if (!files.length) { msg.textContent = "첨부파일을 최소 1개 올려 주세요."; msg.className = "form-msg error"; return; }

      btn.disabled = true;
      try {
        const attachments = [];
        for (let i = 0; i < files.length; i++) {
          btn.textContent = `업로드 중… (${i + 1}/${files.length})`;
          attachments.push(await uploadFile(files[i]));
        }
        btn.textContent = "등록 중…";
        await addDoc(collection(db, "studies", studyId, "materials"), {
          title,
          note: $("sm-note").value.trim(),
          attachments,
          uploaderUid: me.uid,
          uploaderName: $("sm-author").value.trim() || me.name,
          createdAt: Timestamp.fromDate(when),
        });
        modal.classList.remove("open");
      } catch (err) {
        msg.textContent = "등록 실패: " + err.message;
        msg.className = "form-msg error";
      } finally {
        btn.disabled = false;
        btn.textContent = "자료 등록";
      }
    });
  }
}
