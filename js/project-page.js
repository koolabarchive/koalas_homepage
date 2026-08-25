// 프로젝트 페이지 (project.html?id=...)
// 대외용: 소개(마크다운), 연구 참가 신청·문의, 공개 공지(모집)
// 일원용: 달력(참석 체크), 직책별 연구팀 명단, 공지 게시판, 자료 게시판(첨부파일)

import { auth, db, isConfigured } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc, onSnapshot,
  query, where, orderBy, serverTimestamp, Timestamp, deleteField,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { renderMarkdown } from "./markdown-lite.js";
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
  const todayIso = () => {
    const d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  };

  const STATUS_CLS = { "진행 중": "approved", "준비 중": "pending", "종료": "member" };
  const MAX_FILE = 10 * 1024 * 1024;
  const MAX_FILES = 5;
  const CHUNK = 600 * 1024;
  const EV_CATS = ["회의", "데이터 수집", "참여자 모집", "분석", "마감", "기타"];

  const projectId = new URLSearchParams(location.search).get("id");
  let me = null;
  let project = null;
  let isParticipant = false;
  let isAdmin = false;
  let isLeader = false;
  let matSearch = "";
  let matCategory = "all";
  let materials = [];
  let unsubInternal = [];
  const openItems = new Set();

  if (!projectId) {
    $("pj-title").textContent = "잘못된 접근입니다.";
  } else {
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        try {
          const snap = await getDoc(doc(db, "users", user.uid));
          if (snap.exists()) me = { uid: user.uid, ...snap.data() };
        } catch (_) {}
      }
      loadProject();
    });
  }

  async function loadProject() {
    try {
      const snap = await getDoc(doc(db, "projects", projectId));
      if (!snap.exists()) {
        $("pj-title").textContent = "존재하지 않는 프로젝트입니다.";
        return;
      }
      project = { id: snap.id, ...snap.data() };
    } catch (err) {
      $("pj-title").textContent = "멤버 전용 프로젝트입니다. 로그인 후 이용해 주세요.";
      $("pj-intro").innerHTML = '<a href="login.html" class="btn btn-primary" style="margin-top:10px;">멤버 로그인</a>';
      return;
    }

    const isMember = me && (me.role === "member" || me.role === "admin");
    isAdmin = me && me.role === "admin";
    isParticipant = isMember && ((project.participantsUids || []).includes(me.uid) || isAdmin);
    isLeader = isMember && (project.leaderUids || []).includes(me.uid);

    renderHead();
    renderPeople(isMember);
    renderJoin(isMember);
    watchPosts();
    bindInquiryForm();
    if (isAdmin || isLeader) watchInquiryCount();
    if (isAdmin || isLeader) {
      $("btn-edit-intro").style.display = "";
      bindIntroEditor();
    }

    if (isParticipant) {
      initTeamChat({
        db, me,
        type: "project",
        refId: projectId,
        refTitle: project.title,
        getParticipants: () => ({ ...(project.participantsNames || {}) }),
        isAdmin,
      });
      $("pj-calendar-section").style.display = "";
      $("pj-internal-section").style.display = "";
      $("pj-post-toolbar").style.display = "";
      // 참여자(비관리자)는 내부 공지만 작성 가능
      // 공개/내부 선택은 모든 참여자에게 제공 (기본값: 공개)
      initCalendar();
      watchMaterials();
      bindPostModal();
      bindMatModal();
    }
  }

  function renderHead() {
    const p = project;
    document.title = p.title + " | 한신대학교 임상심리 연구실";
    $("pj-title").textContent = p.title;
    const badge = $("pj-status");
    badge.textContent = p.status;
    badge.className = "status " + (STATUS_CLS[p.status] || "member");
    $("pj-meta").innerHTML = esc([p.period, p.meta].filter(Boolean).join(" · "));
    // 소개는 마크다운으로 렌더링 (기존 일반 텍스트도 문단으로 자연스럽게 표시됨)
    $("pj-intro").innerHTML = renderMarkdown(p.intro || p.meta || "소개가 아직 등록되지 않았습니다.");
  }

  // ================= 소개 편집 (관리자·프로젝트 리더) =================
  function bindIntroEditor() {
    const modal = $("intro-modal");
    $("btn-edit-intro").addEventListener("click", () => {
      $("in-md").value = project.intro || "";
      $("in-msg").className = "form-msg";
      modal.classList.add("open");
    });
    $("in-cancel").addEventListener("click", () => modal.classList.remove("open"));
    modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.remove("open"); });

    // 이미지 삽입: 리사이즈 → Data URL을 마크다운으로 커서 위치에 삽입
    $("in-img-btn").addEventListener("click", () => $("in-img-file").click());
    $("in-img-file").addEventListener("change", async () => {
      const file = $("in-img-file").files[0];
      if (!file) return;
      const msg = $("in-msg");
      try {
        const dataUrl = await resizeImageToDataUrl(file, 1000);
        const ta = $("in-md");
        const pos = ta.selectionStart ?? ta.value.length;
        const snippet = `\n![이미지](${dataUrl})\n`;
        ta.value = ta.value.slice(0, pos) + snippet + ta.value.slice(pos);
        msg.textContent = "이미지가 본문에 삽입되었습니다.";
        msg.className = "form-msg ok";
      } catch (err) {
        msg.textContent = err.message;
        msg.className = "form-msg error";
      }
      $("in-img-file").value = "";
    });

    $("in-save").addEventListener("click", async () => {
      const msg = $("in-msg");
      const intro = $("in-md").value;
      if (intro.length > 900000) {
        msg.textContent = "내용이 너무 큽니다(이미지 수를 줄여 주세요). 이미지는 2~3장 이내를 권장합니다.";
        msg.className = "form-msg error";
        return;
      }
      try {
        await updateDoc(doc(db, "projects", projectId), { intro });
        project.intro = intro;
        renderHead();
        modal.classList.remove("open");
      } catch (err) {
        msg.textContent = "저장 실패: " + err.message;
        msg.className = "form-msg error";
      }
    });
  }

  function resizeImageToDataUrl(file, max) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
        if (dataUrl.length > 350000) reject(new Error("압축 후에도 이미지가 너무 큽니다. 더 작은 사진을 사용해 주세요."));
        else resolve(dataUrl);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("이미지를 읽을 수 없습니다.")); };
      img.src = url;
    });
  }

  // ================= 연구팀 (멤버에게는 직책별 그룹) =================
  const POSITION_ORDER = ["교수", "연구원", "박사", "석사", "학사"];

  async function renderPeople(isMember) {
    const p = project;
    const entries = Object.entries(p.participantsNames || {});
    if (!entries.length) {
      $("pj-people").innerHTML = '<p style="color:var(--muted); font-size:0.9rem;">연구팀이 아직 등록되지 않았습니다.</p>';
      return;
    }

    const roleOf = (uid) => (p.participantsRoles || {})[uid] || "";

    if (!isMember) {
      // 비로그인: 이름·프로젝트 역할만 (계정 정보 접근 불가)
      $("pj-people").innerHTML = '<div class="grid grid-3">' + entries.map(([uid, name]) => `
        <a class="card" href="members.html#u=${encodeURIComponent(uid)}" style="padding:18px 20px;" title="구성원 프로필 보기">
          <h3 style="font-size:0.98rem; margin-bottom:2px;">${esc(name)}</h3>
          ${roleOf(uid) ? '<div class="study-meta">' + esc(roleOf(uid)) + "</div>" : ""}
        </a>`).join("") + "</div>";
      return;
    }

    // 멤버: 계정 정보로 직책별 그룹 표시
    try {
      const users = {};
      const snap = await getDocs(collection(db, "users"));
      snap.docs.forEach((d) => { users[d.id] = d.data(); });

      const groups = {};
      entries.forEach(([uid, name]) => {
        const u = users[uid];
        const pos = u && POSITION_ORDER.includes(u.position) ? u.position : "기타";
        (groups[pos] = groups[pos] || []).push({ uid, name, u });
      });

      const order = [...POSITION_ORDER, "기타"].filter((g) => groups[g]);
      const leaderSet = new Set(project.leaderUids || []);
      $("pj-people").innerHTML = order.map((g) => `
        <div style="margin-bottom:18px;">
          <div style="font-size:0.8rem; font-weight:700; color:var(--muted); letter-spacing:0.06em; margin-bottom:8px;">${esc(g)}</div>
          <div class="grid grid-3">
            ${groups[g].map(({ uid, name, u }) => {
              // 가독성: 역할·직책은 첫 줄, 소속은 둘째 줄로 분리
              const line1 = [roleOf(uid), u ? [u.position, u.memberStatus].filter(Boolean).join("·") : ""].filter(Boolean).join(" · ");
              const affil = u && u.affiliation ? u.affiliation : "";
              return `
              <a class="card" href="members.html#u=${encodeURIComponent(uid)}" style="padding:16px 18px;" title="구성원 프로필 보기">
                <h3 style="font-size:0.96rem; margin-bottom:2px;">${esc(name)}${leaderSet.has(uid) ? ' <span class="status approved" style="vertical-align:1px;">리더</span>' : ""}</h3>
                ${line1 ? `<div class="study-meta">${esc(line1)}</div>` : ""}
                ${affil ? `<div class="pt-affil">${esc(affil)}</div>` : ""}
              </a>`;
            }).join("")}
          </div>
        </div>`).join("");
    } catch (_) {
      // 계정 조회 실패 시 기본 표시로 폴백
      $("pj-people").innerHTML = '<div class="grid grid-3">' + entries.map(([uid, name]) => `
        <div class="card" style="padding:18px 20px;"><h3 style="font-size:0.98rem;">${esc(name)}</h3></div>`).join("") + "</div>";
    }
  }

  // ================= 참여 신청 (멤버) =================
  function renderJoin(isMember) {
    const box = $("pj-join");
    box.innerHTML = "";
    if (!isMember) return;
    if ((project.participantsUids || []).includes(me.uid)) {
      $("pj-joined-badge").innerHTML = '<span class="status approved">이 프로젝트에 참여 중입니다</span>';
      return;
    }
    if (project.status === "종료") return;

    const un = onSnapshot(doc(db, "projects", projectId, "joinRequests", me.uid), (snap) => {
      box.innerHTML = "";
      if (snap.exists()) {
        box.innerHTML = '<span class="status pending">참여 신청 대기 중</span>';
        const cancel = document.createElement("button");
        cancel.className = "btn-sm";
        cancel.textContent = "신청 취소";
        cancel.addEventListener("click", async () => {
          try { await deleteDoc(doc(db, "projects", projectId, "joinRequests", me.uid)); }
          catch (err) { alert("취소 실패: " + err.message); }
        });
        box.appendChild(cancel);
      } else {
        const roleInput = document.createElement("input");
        roleInput.type = "text";
        roleInput.placeholder = "희망 역할 (예: 연구보조원)";
        roleInput.style.cssText = "padding:8px 10px; border:1px solid var(--line); border-radius:6px; font-family:var(--font-body); font-size:0.86rem; background:#fff; min-width:200px;";
        const joinBtn = document.createElement("button");
        joinBtn.className = "btn-sm primary";
        joinBtn.textContent = "참여 신청";
        joinBtn.addEventListener("click", async () => {
          try {
            await setDoc(doc(db, "projects", projectId, "joinRequests", me.uid), {
              uid: me.uid,
              name: me.name,
              role: roleInput.value.trim(),
              createdAt: serverTimestamp(),
            });
          } catch (err) {
            $("pj-join-msg").textContent = "신청 실패: " + err.message;
            $("pj-join-msg").className = "form-msg error";
          }
        });
        box.appendChild(roleInput);
        box.appendChild(joinBtn);
      }
    }, () => {});
    unsubInternal.push(un);
  }

  // ================= 연구 참가 신청 · 문의 (외부 방문자) =================
  function bindInquiryForm() {
    $("pi-send").addEventListener("click", async () => {
      const msg = $("pi-msg");
      const btn = $("pi-send");
      const name = $("pi-name").value.trim();
      const contact = $("pi-contact").value.trim();
      const message = $("pi-message").value.trim();
      if (!name || !contact) {
        msg.textContent = "이름과 연락처를 입력해 주세요.";
        msg.className = "form-msg error";
        return;
      }
      btn.disabled = true;
      try {
        await addDoc(collection(db, "projectInquiries"), {
          projectId,
          projectTitle: project.title,
          name, contact, message,
          createdAt: serverTimestamp(),
        });
        $("pi-name").value = $("pi-contact").value = $("pi-message").value = "";
        msg.textContent = "접수되었습니다. 연구팀이 확인 후 연락드리겠습니다.";
        msg.className = "form-msg ok";
      } catch (err) {
        msg.textContent = "전송 실패: " + err.message;
        msg.className = "form-msg error";
      } finally {
        btn.disabled = false;
      }
    });
  }

  // 리더·관리자: 접수 건수만 표시하고 상세 확인은 마이페이지로 안내
  function watchInquiryCount() {
    const box = $("pj-inquiry-leader");
    const un = onSnapshot(query(collection(db, "projectInquiries"), where("projectId", "==", projectId)), (snap) => {
      if (!snap.size) { box.style.display = "none"; return; }
      box.style.display = "";
      box.innerHTML = `<div class="card" style="padding:14px 18px; display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap;">
        <span style="font-size:0.9rem;">접수된 연구 참가 신청·문의 <strong>${snap.size}건</strong>이 있습니다.</span>
        <a href="dashboard.html" class="btn-sm primary" style="text-decoration:none;">마이페이지에서 확인 →</a>
      </div>`;
    }, () => { box.style.display = "none"; });
    unsubInternal.push(un);
  }

  // ================= 첨부파일 (projects/{id}/files 청크 저장) =================
  function bytesToBase64(bytes) {
    let bin = "";
    const BLOCK = 0x8000;
    for (let i = 0; i < bytes.length; i += BLOCK) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + BLOCK));
    return btoa(bin);
  }
  function base64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  async function uploadFile(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const chunkCount = Math.max(1, Math.ceil(bytes.length / CHUNK));
    const ref = await addDoc(collection(db, "projects", projectId, "files"), {
      name: file.name, type: file.type || "application/octet-stream", size: bytes.length,
      chunkCount, uploaderUid: me.uid, uploaderName: me.name, createdAt: serverTimestamp(),
    });
    for (let i = 0; i < chunkCount; i++) {
      await setDoc(doc(db, "projects", projectId, "files", ref.id, "chunks", String(i).padStart(4, "0")), {
        data: bytesToBase64(bytes.subarray(i * CHUNK, (i + 1) * CHUNK)),
        uploaderUid: me.uid,
      });
    }
    return { fileId: ref.id, name: file.name, type: file.type || "application/octet-stream", size: bytes.length };
  }
  async function loadFileBlob(att) {
    const snap = await getDocs(collection(db, "projects", projectId, "files", att.fileId, "chunks"));
    const parts = snap.docs.sort((a, b) => a.id.localeCompare(b.id)).map((d) => base64ToBytes(d.data().data));
    return new Blob(parts, { type: att.type || "application/octet-stream" });
  }
  async function downloadAttachment(att, btn) {
    const original = btn ? btn.textContent : "";
    try {
      if (btn) { btn.disabled = true; btn.textContent = "다운로드 중…"; }
      const blob = await loadFileBlob(att);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = att.name || "file";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (err) { alert("다운로드 실패: " + err.message); }
    finally { if (btn) { btn.disabled = false; btn.textContent = original; } }
  }
  async function deleteFileDoc(fileId) {
    const snap = await getDocs(collection(db, "projects", projectId, "files", fileId, "chunks"));
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
    await deleteDoc(doc(db, "projects", projectId, "files", fileId));
  }
  async function deleteAttachments(atts) {
    for (const a of atts || []) { try { await deleteFileDoc(a.fileId); } catch (_) {} }
  }
  function validateFiles(input, msgEl) {
    const files = [...(input.files || [])];
    if (files.length > MAX_FILES) {
      msgEl.textContent = `첨부파일은 최대 ${MAX_FILES}개까지 올릴 수 있습니다.`;
      msgEl.className = "form-msg error"; return null;
    }
    const big = files.find((f) => f.size > MAX_FILE);
    if (big) { msgEl.textContent = `"${big.name}" 파일이 10MB를 초과합니다.`; msgEl.className = "form-msg error"; return null; }
    return files;
  }
  function bindFilePreview(input, listEl) {
    input.addEventListener("change", () => {
      listEl.innerHTML = [...(input.files || [])].map((f) =>
        `<div class="file-row">📎 <span class="f-name">${esc(f.name)}</span><span class="f-size">${fmtSize(f.size)}</span></div>`).join("");
    });
  }
  function attachmentChips(atts, key) {
    if (!atts || !atts.length || !isParticipant) return "";
    return `<div class="att-list">` + atts.map((a, i) =>
      `<span class="att-chip"><button type="button" class="att-dl" data-att="${key}:${i}">📎 ${esc(a.name)} <small>${fmtSize(a.size)}</small></button></span>`
    ).join("") + `</div>`;
  }
  function bindAttachmentEvents(box, byKey) {
    box.querySelectorAll("button.att-dl").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const [key, idx] = btn.dataset.att.split(":");
        const att = byKey[key]?.attachments?.[Number(idx)];
        if (att) downloadAttachment(att, btn);
      });
    });
  }

  // ================= 프로젝트 달력 =================
  let calCursor = new Date();
  calCursor.setDate(1);
  let events = [];
  let editingEvent = null;
  let viewingEventId = null;

  function initCalendar() {
    const un = onSnapshot(collection(db, "projects", projectId, "events"), (snap) => {
      events = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderCalendar();
      if (viewingEventId) renderEventView(); // 참석 변경 실시간 반영
    }, () => { $("pj-calendar").innerHTML = '<p style="color:var(--muted);">달력을 불러오지 못했습니다.</p>'; });
    unsubInternal.push(un);

    $("cal-prev").addEventListener("click", () => { calCursor.setMonth(calCursor.getMonth() - 1); renderCalendar(); });
    $("cal-next").addEventListener("click", () => { calCursor.setMonth(calCursor.getMonth() + 1); renderCalendar(); });
    $("cal-today").addEventListener("click", () => { calCursor = new Date(); calCursor.setDate(1); renderCalendar(); });
    $("btn-add-event").addEventListener("click", () => openEventModal(null));

    // 일정 등록·수정 모달
    $("ev-cat").innerHTML = EV_CATS.map((c) => `<option>${c}</option>`).join("");
    $("ev-cancel").addEventListener("click", () => $("ev-modal").classList.remove("open"));
    $("ev-modal").addEventListener("click", (e) => { if (e.target === $("ev-modal")) $("ev-modal").classList.remove("open"); });
    $("ev-save").addEventListener("click", saveEvent);

    // 상세 모달
    $("ev-view-close").addEventListener("click", closeEventView);
    $("ev-view-modal").addEventListener("click", (e) => { if (e.target === $("ev-view-modal")) closeEventView(); });
    $("ev-att-yes").addEventListener("click", () => setAttendance("yes"));
    $("ev-att-no").addEventListener("click", () => setAttendance("no"));
    $("ev-view-edit").addEventListener("click", () => {
      const ev = events.find((x) => x.id === viewingEventId);
      if (ev) { closeEventView(); openEventModal(ev); }
    });
    $("ev-view-del").addEventListener("click", async () => {
      const ev = events.find((x) => x.id === viewingEventId);
      if (!ev || !confirm(`"${ev.title}" 일정을 삭제할까요?`)) return;
      try { await deleteDoc(doc(db, "projects", projectId, "events", ev.id)); closeEventView(); }
      catch (err) { alert("삭제 실패: " + err.message); }
    });
  }

  function catIdx(cat) { const i = EV_CATS.indexOf(cat); return i < 0 ? EV_CATS.length - 1 : i; }

  function renderCalendar() {
    const y = calCursor.getFullYear();
    const m = calCursor.getMonth();
    $("cal-title").textContent = `${y}년 ${m + 1}월`;

    const first = new Date(y, m, 1);
    const startOffset = first.getDay(); // 일요일 시작
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const todayStr = todayIso();
    const cells = [];
    const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;

    for (let i = 0; i < totalCells; i++) {
      const dayNum = i - startOffset + 1;
      if (dayNum < 1 || dayNum > daysInMonth) { cells.push('<div class="cal-cell empty"></div>'); continue; }
      const dateStr = `${y}-${pad(m + 1)}-${pad(dayNum)}`;
      const dayEvents = events
        .filter((ev) => (ev.start || "") <= dateStr && dateStr <= (ev.end || ev.start || ""))
        .sort((a, b) => (a.start || "").localeCompare(b.start || ""));
      const chips = dayEvents.slice(0, 3).map((ev) => {
        const label = (ev.startTime && ev.start === dateStr ? ev.startTime + " " : "") + ev.title;
        return `<button type="button" class="cal-ev cat-${catIdx(ev.category)}" data-ev="${ev.id}" title="${esc(label)}">${esc(label)}</button>`;
      }).join("");
      const more = dayEvents.length > 3 ? `<div class="cal-more">+${dayEvents.length - 3}</div>` : "";
      cells.push(`<div class="cal-cell${dateStr === todayStr ? " today" : ""}${i % 7 === 0 ? " sun" : ""}${i % 7 === 6 ? " sat" : ""}">
        <div class="cal-day">${dayNum}</div>${chips}${more}
      </div>`);
    }

    $("pj-calendar").innerHTML =
      '<div class="cal-head">' + ["일", "월", "화", "수", "목", "금", "토"].map((d, i) =>
        `<div class="${i === 0 ? "sun" : i === 6 ? "sat" : ""}">${d}</div>`).join("") + "</div>" +
      '<div class="cal-body">' + cells.join("") + "</div>";

    $("pj-calendar").querySelectorAll("button[data-ev]").forEach((btn) => {
      btn.addEventListener("click", () => { viewingEventId = btn.dataset.ev; renderEventView(); $("ev-view-modal").classList.add("open"); });
    });
  }

  function openEventModal(ev) {
    editingEvent = ev || null;
    $("ev-modal-title").textContent = ev ? "일정 수정" : "일정 등록";
    $("ev-title").value = ev ? ev.title : "";
    $("ev-start").value = ev ? (ev.start || "") : todayIso();
    $("ev-end").value = ev ? (ev.end || ev.start || "") : todayIso();
    $("ev-start-time").value = ev ? (ev.startTime || "") : "";
    $("ev-end-time").value = ev ? (ev.endTime || "") : "";
    $("ev-cat").value = ev && EV_CATS.includes(ev.category) ? ev.category : EV_CATS[0];
    $("ev-msg").className = "form-msg";
    $("ev-modal").classList.add("open");
  }

  async function saveEvent() {
    const msg = $("ev-msg");
    const title = $("ev-title").value.trim();
    const start = $("ev-start").value;
    let end = $("ev-end").value || start;
    if (!title) { msg.textContent = "일정 제목을 입력해 주세요."; msg.className = "form-msg error"; return; }
    if (!start) { msg.textContent = "시작 일정을 선택해 주세요."; msg.className = "form-msg error"; return; }
    if (end < start) end = start;
    try {
      const startTime = $("ev-start-time").value || "";
      const endTime = $("ev-end-time").value || "";
      if (editingEvent) {
        await updateDoc(doc(db, "projects", projectId, "events", editingEvent.id), {
          title, start, end, startTime, endTime, category: $("ev-cat").value,
        });
      } else {
        await addDoc(collection(db, "projects", projectId, "events"), {
          title, start, end, startTime, endTime, category: $("ev-cat").value,
          attendance: {},
          createdByUid: me.uid, createdByName: me.name,
          createdAt: serverTimestamp(),
        });
      }
      $("ev-modal").classList.remove("open");
    } catch (err) {
      msg.textContent = "저장 실패: " + err.message;
      msg.className = "form-msg error";
    }
  }

  function closeEventView() {
    viewingEventId = null;
    $("ev-view-modal").classList.remove("open");
  }

  function renderEventView() {
    const ev = events.find((x) => x.id === viewingEventId);
    if (!ev) { closeEventView(); return; }
    $("ev-view-title").textContent = ev.title;
    const sT = ev.startTime ? " " + ev.startTime : "";
    const eT = ev.endTime ? " " + ev.endTime : "";
    const period = (ev.start === ev.end || !ev.end)
      ? ev.start + sT + (eT ? " ~" + eT : "")
      : `${ev.start}${sT} ~ ${ev.end}${eT}`;
    $("ev-view-info").innerHTML =
      `<span class="cal-ev cat-${catIdx(ev.category)}" style="cursor:default;">${esc(ev.category || "기타")}</span>
       <span style="margin-left:8px;">${esc(period.replaceAll("-", "."))}</span>
       <span class="sub" style="display:inline; margin-left:8px;">등록 ${esc(ev.createdByName || "")}</span>`;

    const att = ev.attendance || {};
    const names = project.participantsNames || {};
    const mine = att[me.uid];
    $("ev-att-yes").className = "btn-sm" + (mine === "yes" ? " primary" : "");
    $("ev-att-no").className = "btn-sm" + (mine === "no" ? " danger" : "");

    const yes = Object.entries(att).filter(([, v]) => v === "yes").map(([u]) => names[u] || "?");
    const no = Object.entries(att).filter(([, v]) => v === "no").map(([u]) => names[u] || "?");
    const pending = Object.keys(names).filter((u) => !att[u]);
    $("ev-view-att").innerHTML =
      `<div>✓ 참석 <strong>${yes.length}명</strong>${yes.length ? " — " + esc(yes.join(", ")) : ""}</div>
       <div style="margin-top:4px;">✗ 불참 <strong>${no.length}명</strong>${no.length ? " — " + esc(no.join(", ")) : ""}</div>
       <div style="margin-top:4px; color:var(--muted);">미응답 ${pending.length}명</div>`;
  }

  async function setAttendance(value) {
    const ev = events.find((x) => x.id === viewingEventId);
    if (!ev) return;
    try {
      const cur = (ev.attendance || {})[me.uid];
      await updateDoc(doc(db, "projects", projectId, "events", ev.id), {
        ["attendance." + me.uid]: cur === value ? deleteField() : value, // 같은 버튼 재클릭 = 응답 취소
      });
    } catch (err) { alert("저장 실패: " + err.message); }
  }

  // ================= 공지 (게시판) =================
  function watchPosts() {
    const box = $("pj-posts");
    const q = isParticipant
      ? query(collection(db, "projects", projectId, "posts"), orderBy("createdAt", "desc"))
      : query(collection(db, "projects", projectId, "posts"), where("scope", "==", "public"));
    if (isParticipant) $("pj-posts-hint").textContent = "제목을 클릭하면 내용이 펼쳐집니다. 🔒 표시가 있는 글은 참여 연구원에게만 보입니다.";

    const un = onSnapshot(q, (snap) => {
      let posts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (!isParticipant) posts.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      if (!posts.length) {
        box.innerHTML = '<p style="color:var(--muted); font-size:0.9rem; padding:12px 4px;">아직 공지가 없습니다.</p>';
        return;
      }
      const byKey = {};
      box.innerHTML = posts.map((p) => {
        byKey[p.id] = p;
        const open = openItems.has("post:" + p.id);
        const canDelete = me && (me.role === "admin" || p.authorUid === me.uid);
        const attCount = isParticipant ? (p.attachments || []).length : 0;
        return `<div class="board-item${open ? " open" : ""}">
          <button type="button" class="b-row" data-toggle="post:${p.id}">
            <span class="b-title">${p.scope === "internal" ? '<span class="scope-chip">🔒 내부</span>' : ""}${esc(p.title)}${attCount ? ` <span class="b-att">📎 ${attCount}</span>` : ""}</span>
            <span class="b-meta">${esc(p.authorName)} · ${fmtDateTime(p.createdAt) || fmtDate(p.createdAt)}</span>
          </button>
          <div class="b-detail"${open ? "" : " hidden"}>
            ${p.content ? `<div class="b-body">${esc(p.content)}</div>` : ""}
            ${attachmentChips(p.attachments, p.id)}
            ${canDelete ? `<div class="b-actions"><button class="btn-sm danger" data-post-del="${p.id}">삭제</button></div>` : ""}
          </div>
        </div>`;
      }).join("");

      bindToggles(box);
      box.querySelectorAll("button[data-post-del]").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const p = byKey[btn.dataset.postDel];
          if (!confirm("이 공지를 삭제할까요? 첨부파일도 함께 삭제됩니다.")) return;
          try {
            await deleteAttachments(p.attachments);
            await deleteDoc(doc(db, "projects", projectId, "posts", p.id));
          } catch (err) { alert("삭제 실패: " + err.message); }
        });
      });
      bindAttachmentEvents(box, byKey);
    }, () => {
      box.innerHTML = '<p style="color:var(--muted); font-size:0.9rem; padding:12px 4px;">공지를 불러오지 못했습니다.</p>';
    });
    unsubInternal.push(un);
  }

  function bindToggles(box) {
    box.querySelectorAll("button[data-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const item = btn.closest(".board-item");
        const detail = item.querySelector(".b-detail");
        const key = btn.dataset.toggle;
        if (detail.hidden) { detail.hidden = false; item.classList.add("open"); openItems.add(key); }
        else { detail.hidden = true; item.classList.remove("open"); openItems.delete(key); }
      });
    });
  }

  function bindPostModal() {
    const modal = $("ppost-modal");
    bindFilePreview($("pp-files"), $("pp-file-list"));
    $("btn-write-ppost").addEventListener("click", () => {
      $("pp-when").value = nowLocal();
      $("pp-author").value = me.name || "";
      $("pp-title").value = "";
      $("pp-content").value = "";
      $("pp-scope").value = "public";
      $("pp-files").value = "";
      $("pp-file-list").innerHTML = "";
      $("pp-msg").className = "form-msg";
      modal.classList.add("open");
    });
    $("pp-cancel").addEventListener("click", () => modal.classList.remove("open"));
    modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.remove("open"); });

    $("pp-add").addEventListener("click", async () => {
      const msg = $("pp-msg");
      const btn = $("pp-add");
      const title = $("pp-title").value.trim();
      if (!title) { msg.textContent = "공지 제목을 입력해 주세요."; msg.className = "form-msg error"; return; }
      const when = $("pp-when").value ? new Date($("pp-when").value) : new Date();
      const files = validateFiles($("pp-files"), msg);
      if (files === null) return;
      const scope = $("pp-scope").value;

      btn.disabled = true;
      try {
        const attachments = [];
        for (let i = 0; i < files.length; i++) {
          btn.textContent = `업로드 중… (${i + 1}/${files.length})`;
          attachments.push(await uploadFile(files[i]));
        }
        btn.textContent = "등록 중…";
        await addDoc(collection(db, "projects", projectId, "posts"), {
          title,
          content: $("pp-content").value.trim(),
          scope,
          attachments,
          authorUid: me.uid,
          authorName: $("pp-author").value.trim() || me.name,
          createdAt: Timestamp.fromDate(isNaN(when) ? new Date() : when),
        });
        modal.classList.remove("open");
      } catch (err) {
        msg.textContent = "등록 실패: " + err.message;
        msg.className = "form-msg error";
      } finally {
        btn.disabled = false;
        btn.textContent = "올리기";
      }
    });
  }

  // ================= 자료 (게시판 + 첨부) =================
  function renderMaterials() {
    const box = $("pj-materials");
    let filtered = matCategory === "all" ? materials : materials.filter((m) => (m.category || "기타") === matCategory);
    if (matSearch) {
      const q = matSearch.toLowerCase();
      filtered = filtered.filter((m) =>
        [m.title, m.note, m.category, m.uploaderName, ...(m.attachments || []).map((a) => a.name)]
          .some((v) => (v || "").toLowerCase().includes(q)));
    }
    if (!filtered.length) {
      box.innerHTML = `<p style="color:var(--muted); font-size:0.9rem; padding:12px 4px;">${matSearch ? "검색 결과가 없습니다." : "해당 분류의 자료가 없습니다."}</p>`;
      return;
    }
    const byKey = {};
    box.innerHTML = filtered.map((m) => {
      byKey[m.id] = m;
      const open = openItems.has("mat:" + m.id);
      const canDelete = me.role === "admin" || m.uploaderUid === me.uid;
      const attCount = (m.attachments || []).length;
      return `<div class="board-item${open ? " open" : ""}">
        <button type="button" class="b-row" data-toggle="mat:${m.id}">
          <span class="b-title"><span class="pub-type" style="margin-right:8px;">${esc(m.category || "기타")}</span>${esc(m.title)}${attCount ? ` <span class="b-att">📎 ${attCount}</span>` : ""}</span>
          <span class="b-meta">${esc(m.uploaderName)} · ${fmtDateTime(m.createdAt) || fmtDate(m.createdAt)}</span>
        </button>
        <div class="b-detail"${open ? "" : " hidden"}>
          ${m.note ? `<div class="b-body">${esc(m.note)}</div>` : ""}
          ${m.link ? `<div class="b-body"><a href="${esc(m.link)}" target="_blank" rel="noopener noreferrer" style="color:var(--indigo); font-weight:600;">🔗 외부 링크 열기</a></div>` : ""}
          ${attachmentChips(m.attachments, m.id)}
          ${canDelete ? `<div class="b-actions"><button class="btn-sm danger" data-del="${m.id}">삭제</button></div>` : ""}
        </div>
      </div>`;
    }).join("");

    bindToggles(box);
    box.querySelectorAll("button[data-del]").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const m = byKey[btn.dataset.del];
        if (!confirm("이 항목을 삭제할까요? 첨부파일도 함께 삭제됩니다.")) return;
        try {
          await deleteAttachments(m.attachments);
          await deleteDoc(doc(db, "projects", projectId, "materials", m.id));
        } catch (err) { alert("삭제 실패: " + err.message); }
      });
    });
    bindAttachmentEvents(box, byKey);
  }

  function watchMaterials() {
    const un = onSnapshot(
      query(collection(db, "projects", projectId, "materials"), orderBy("createdAt", "desc")),
      (snap) => {
        materials = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        renderMaterials();
      },
      (err) => {
        $("pj-materials").innerHTML = `<p style="color:var(--danger); font-size:0.9rem; padding:12px 4px;">불러오기 실패: ${esc(err.code || err.message)}</p>`;
      }
    );
    unsubInternal.push(un);

    document.querySelectorAll("#pj-mat-filter button").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#pj-mat-filter button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        matCategory = btn.dataset.cat;
        renderMaterials();
      });
    });
    $("pj-mat-search").addEventListener("input", () => {
      matSearch = $("pj-mat-search").value.trim();
      renderMaterials();
    });
  }

  function bindMatModal() {
    const modal = $("pmat-modal");
    bindFilePreview($("pm-files"), $("pm-file-list"));
    $("btn-write-pmat").addEventListener("click", () => {
      $("pm-when").value = nowLocal();
      $("pm-author").value = me.name || "";
      $("pm-title").value = "";
      $("pm-note").value = "";
      $("pm-link").value = "";
      $("pm-cat").selectedIndex = 0;
      $("pm-files").value = "";
      $("pm-file-list").innerHTML = "";
      $("pm-msg").className = "form-msg";
      modal.classList.add("open");
    });
    $("pm-cancel").addEventListener("click", () => modal.classList.remove("open"));
    modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.remove("open"); });

    $("pm-add").addEventListener("click", async () => {
      const msg = $("pm-msg");
      const btn = $("pm-add");
      const title = $("pm-title").value.trim();
      if (!title) { msg.textContent = "제목을 입력해 주세요."; msg.className = "form-msg error"; return; }
      const when = $("pm-when").value ? new Date($("pm-when").value) : new Date();
      let link = $("pm-link").value.trim();
      if (link && !/^https?:\/\//i.test(link)) link = "https://" + link;
      const files = validateFiles($("pm-files"), msg);
      if (files === null) return;

      btn.disabled = true;
      try {
        const attachments = [];
        for (let i = 0; i < files.length; i++) {
          btn.textContent = `업로드 중… (${i + 1}/${files.length})`;
          attachments.push(await uploadFile(files[i]));
        }
        btn.textContent = "등록 중…";
        await addDoc(collection(db, "projects", projectId, "materials"), {
          title,
          link,
          note: $("pm-note").value.trim(),
          category: $("pm-cat").value,
          attachments,
          uploaderUid: me.uid,
          uploaderName: $("pm-author").value.trim() || me.name,
          createdAt: Timestamp.fromDate(isNaN(when) ? new Date() : when),
        });
        modal.classList.remove("open");
      } catch (err) {
        msg.textContent = "등록 실패: " + err.message;
        msg.className = "form-msg error";
      } finally {
        btn.disabled = false;
        btn.textContent = "등록";
      }
    });
  }
}
