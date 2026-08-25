// 팀 채팅 공용 모듈 — 프로젝트/스터디 페이지 임베드 패널 + 메시지 인박스에서 공유
// 데이터 구조: rooms/{roomId} (type: 'project'|'study' = 전체 채팅, 'topic' = 소규모 주제 채팅방)
//   { type, parentType?, refId, refTitle, title, members[], names{}, unread{}, lastMessage, lastAt, ... }
//   messages/{msgId}: { text, senderUid, senderName, createdAt }

import {
  collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc, onSnapshot,
  query, where, orderBy, serverTimestamp, arrayUnion, increment,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { downloadStoredFile, fmtStoredSize } from "./file-store.js";

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const pad = (n) => String(n).padStart(2, "0");
const fmtTime = (ts) => {
  if (!ts || !ts.toDate) return "";
  const d = ts.toDate();
  return pad(d.getHours()) + ":" + pad(d.getMinutes());
};

// ---------- 공용 헬퍼 ----------
export const mainRoomId = (type, refId) => `${type}_${refId}`;

// 방 표시 이름: 개인 별칭(aliases[uid])이 있으면 그것을, 없으면 기본 이름
export function roomDisplayTitle(r, myUid) {
  const alias = (r.aliases || {})[myUid];
  if (alias) return alias;
  if (r.type === "group") return r.title || "단체 채팅";
  if (r.type === "topic") return "# " + (r.title || "채팅방");
  return "전체 채팅";
}

// 멤버 목록 팝오버 토글 (names 맵 기준)
export function toggleMembersPop(pop, names) {
  if (pop.style.display !== "none") { pop.style.display = "none"; return; }
  const list = Object.values(names || {});
  pop.innerHTML = `<div class="members-pop-title">대화 멤버 ${list.length}명</div>` +
    list.map((n) => `<div class="members-pop-row">${esc(n)}</div>`).join("");
  pop.style.display = "";
}

// 전체 채팅방 보장 + 본인 합류 (처음 여는 사람이 방을 만들고, 이후엔 멤버로 합류)
export async function ensureMainRoom(db, me, { type, refId, refTitle }) {
  const id = mainRoomId(type, refId);
  const ref = doc(db, "rooms", id);
  const snap = await getDoc(ref).catch(() => null);
  if (snap && snap.exists()) {
    if (!(snap.data().members || []).includes(me.uid)) {
      await updateDoc(ref, {
        members: arrayUnion(me.uid),
        ["names." + me.uid]: me.name,
        ["unread." + me.uid]: 0,
      });
    }
  } else {
    await setDoc(ref, {
      type, refId, refTitle,
      title: "전체 채팅",
      members: [me.uid],
      names: { [me.uid]: me.name },
      unread: { [me.uid]: 0 },
      createdByUid: me.uid,
      createdAt: serverTimestamp(),
    });
  }
  return id;
}

export async function markRoomRead(db, roomId, uid) {
  try {
    await updateDoc(doc(db, "rooms", roomId), {
      ["unread." + uid]: 0,
      // 다인 읽음 집계용: 각자의 마지막 읽은 시각
      ["reads." + uid]: serverTimestamp(),
    });
  } catch (_) {}
}

// 대화 목록에 보여줄 마지막 메시지 요약 (첨부 전용 메시지 포함)
export function lastMessageLabel(text, attachment) {
  if (text) return text.length > 60 ? text.slice(0, 60) + "…" : text;
  if (!attachment) return "";
  const t = attachment.type || "";
  if (t.startsWith("image/")) return "사진";
  if (t.startsWith("video/")) return "동영상";
  return "파일: " + attachment.name;
}

export async function sendRoomMessage(db, me, room, text, attachment = null, thumb = null) {
  const msg = { text, senderUid: me.uid, senderName: me.name, createdAt: serverTimestamp() };
  if (attachment) { msg.attachment = attachment; if (thumb) msg.thumb = thumb; }
  await addDoc(collection(db, "rooms", room.id, "messages"), msg);
  const upd = {
    lastMessage: lastMessageLabel(text, attachment),
    lastAt: serverTimestamp(),
    lastSenderUid: me.uid,
    ["names." + me.uid]: me.name,
    ["unread." + me.uid]: 0,
  };
  (room.members || []).forEach((u) => { if (u !== me.uid) upd["unread." + u] = increment(1); });
  await updateDoc(doc(db, "rooms", room.id), upd);
}

// ---------- 첨부 메시지 (이미지·동영상·파일) 공용 헬퍼 ----------
export const CHAT_TICK = '<svg viewBox="0 0 14 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 5.3l3.2 3L12.5 1.2"/></svg>';

// 첨부 렌더: 이미지는 미리보기(썸네일), 그 외(동영상·문서)는 파일 칩.
// 클릭하면 원본을 내려받습니다.
export function chatAttachmentHtml(m) {
  const a = m.attachment;
  if (!a) return "";
  if (m.thumb) {
    return `<img class="dm-att-img" src="${esc(m.thumb)}" alt="${esc(a.name)}" title="클릭하면 원본을 내려받습니다" data-attdl="${esc(m.id)}" loading="lazy" />`;
  }
  return `<button type="button" class="dm-att-file" data-attdl="${esc(m.id)}">
    <span class="f-name">${esc(a.name)}</span><small>${fmtStoredSize(a.size)}</small>
  </button>`;
}

// 첨부 다운로드 클릭 바인딩 (렌더 직후 호출)
export function bindChatAttachments(db, box, msgs) {
  box.querySelectorAll("[data-attdl]").forEach((el) => {
    el.addEventListener("click", () => {
      const m = msgs.find((x) => x.id === el.dataset.attdl);
      if (m?.attachment) downloadStoredFile(db, "chatFiles", m.attachment, el.tagName === "BUTTON" ? el : null);
    });
  });
}

// 다인 읽음 집계: 내 메시지를 읽은 인원 수만큼 파란 체크가 늘어납니다.
// (겹쳐 쌓여 폭을 아낍니다) 아무도 읽지 않았으면 표시 없음.
function roomTicks(m, myUid, room) {
  if (!room || m.senderUid !== myUid || !m.createdAt?.toMillis) return "";
  const others = (room.members || []).filter((u) => u !== myUid);
  if (!others.length) return "";
  const reads = room.reads || {};
  const readCount = others.filter((u) =>
    reads[u]?.toMillis && reads[u].toMillis() >= m.createdAt.toMillis()).length;
  if (!readCount) return "";
  return `<span class="dm-ticks read stack" title="읽음 ${readCount}/${others.length}명">${CHAT_TICK.repeat(readCount)}</span>`;
}

// 그룹 채팅 렌더러 — 상대 메시지에 보낸 사람 이름 표시, 날짜 구분선,
// 다인 읽음 체크(room 전달 시), 첨부 메시지, 자동 스크롤
export function renderChatMessages(box, msgs, myUid, room = null, db = null) {
  if (!msgs.length) {
    box.innerHTML = '<p style="color:var(--muted); font-size:0.86rem; text-align:center; margin-top:40px;">첫 메시지를 보내 보세요.</p>';
    return;
  }
  let lastDay = "";
  let lastSender = "";
  box.innerHTML = msgs.map((m) => {
    const mine = m.senderUid === myUid;
    const day = m.createdAt?.toDate ? m.createdAt.toDate().toDateString() : "";
    let divider = "";
    if (day && day !== lastDay) {
      lastDay = day;
      lastSender = "";
      const d = m.createdAt.toDate();
      divider = `<div class="dm-day">${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일</div>`;
    }
    const showName = !mine && m.senderUid !== lastSender;
    lastSender = m.senderUid;
    const body = m.attachment ? chatAttachmentHtml(m) : `<div class="dm-bubble">${esc(m.text)}</div>`;
    return divider + `<div class="dm-msg${mine ? " mine" : ""}">
      <div class="dm-msg-col">
        ${showName ? `<div class="dm-sender">${esc(m.senderName || "")}</div>` : ""}
        ${body}
      </div>
      <div class="dm-msg-meta"><span class="dm-msg-time">${fmtTime(m.createdAt)}</span>${roomTicks(m, myUid, room)}</div>
    </div>`;
  }).join("");
  if (db) bindChatAttachments(db, box, msgs);
  box.scrollTop = box.scrollHeight;
}

// 채팅 첨부용 이미지 축소 썸네일 (미리보기용 — 원본은 chatFiles에 저장)
export function makeChatThumb(file, maxW = 360) {
  return new Promise((resolve) => {
    if (!(file.type || "").startsWith("image/")) { resolve(null); return; }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const scale = Math.min(1, maxW / img.width);
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL("image/jpeg", 0.8));
      } catch (_) { resolve(null); }
      URL.revokeObjectURL(url);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

async function deleteRoomWithMessages(db, roomId) {
  const snap = await getDocs(collection(db, "rooms", roomId, "messages"));
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  await deleteDoc(doc(db, "rooms", roomId));
}

// ---------- 임베드 팀 채팅 패널 (프로젝트/스터디 페이지 공용) ----------
// 필요한 요소 ID: team-chat-section, chat-rooms, chat-room-title, chat-room-sub,
//   chat-messages, chat-text, chat-send,
//   room-modal, rm-name, rm-members, rm-create, rm-cancel, rm-msg, btn-new-room
export function initTeamChat({ db, me, type, refId, refTitle, getParticipants, isAdmin }) {
  const $ = (id) => document.getElementById(id);
  $("team-chat-section").style.display = "";

  const mainId = mainRoomId(type, refId);
  let rooms = [];
  let activeRoomId = mainId;
  let lastPopupMsgs = [];
  let unsubMsgs = null;
  let popupOpen = false;
  let threadStarted = false;

  const roomById = (id) => rooms.find((r) => r.id === id);

  // 플로팅 버튼 열기/닫기
  const wrap = $("team-chat-section");
  // 어느 공간의 채팅인지 상단에 명시
  $("chat-context").textContent = `${type === "project" ? "프로젝트" : "스터디"} · ${refTitle} 팀 채팅`;
  $("chat-fab").title = `${refTitle} 팀 채팅`;
  // 멤버 목록 팝오버
  $("chat-members-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    const r = roomById(activeRoomId);
    toggleMembersPop($("chat-members-pop"), r ? r.names : {});
  });
  document.addEventListener("click", (e) => {
    const pop = $("chat-members-pop");
    if (pop && pop.style.display !== "none" && !pop.contains(e.target) && !$("chat-members-btn").contains(e.target)) {
      pop.style.display = "none";
    }
  });
  $("chat-fab").addEventListener("click", () => {
    popupOpen = !popupOpen;
    wrap.classList.toggle("open", popupOpen);
    if (popupOpen) {
      if (!threadStarted) { threadStarted = true; openRoom(activeRoomId); }
      else markRoomRead(db, activeRoomId, me.uid);
      setTimeout(() => $("chat-text").focus(), 50);
    }
  });
  $("chat-close").addEventListener("click", () => {
    popupOpen = false;
    wrap.classList.remove("open");
  });

  function refreshFabBadge() {
    const total = rooms.reduce((n, r) => n + ((r.unread || {})[me.uid] || 0), 0);
    const badge = $("chat-fab-badge");
    badge.textContent = total > 99 ? "99+" : total || "";
    badge.style.display = total ? "" : "none";
  }

  // 전체 채팅 합류 후 내 방 목록 구독 (구독만 하고, 스레드는 팝업을 열 때 시작)
  ensureMainRoom(db, me, { type, refId, refTitle }).then(() => {
    onSnapshot(query(collection(db, "rooms"), where("members", "array-contains", me.uid)), (snap) => {
      rooms = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .filter((r) => r.refId === refId && (r.type === type || (r.type === "topic" && r.parentType === type)))
        .sort((a, b) => {
          if (a.id === mainId) return -1;
          if (b.id === mainId) return 1;
          return (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0);
        });
      renderRoomTabs();
      // 열린 방의 읽음(reads) 변경을 체크 표시에 즉시 반영
      if (popupOpen && activeRoomId && lastPopupMsgs.length) {
        renderChatMessages($("chat-messages"), lastPopupMsgs, me.uid, roomById(activeRoomId), db);
      }
      refreshFabBadge();
      if (threadStarted && !roomById(activeRoomId)) openRoom(mainId); // 방 삭제 시 전체 채팅으로
    }, () => {
      $("chat-messages").innerHTML = '<p style="color:var(--muted); text-align:center; margin-top:40px;">채팅을 불러오지 못했습니다. (보안 규칙 확인)</p>';
    });
  }).catch(() => {
    $("chat-messages").innerHTML = '<p style="color:var(--muted); text-align:center; margin-top:40px;">채팅을 불러오지 못했습니다. (보안 규칙 확인)</p>';
  });

  function renderRoomTabs() {
    const box = $("chat-rooms");
    box.innerHTML = rooms.map((r) => {
      const unread = (r.unread || {})[me.uid] || 0;
      const isMain = r.id === mainId;
      const canDel = !isMain && (isAdmin || r.createdByUid === me.uid);
      return `<button type="button" class="chat-room-tab${r.id === activeRoomId ? " active" : ""}" data-room="${r.id}">
        ${esc(roomDisplayTitle(r, me.uid))}
        ${unread ? `<span class="nav-badge">${unread > 99 ? "99+" : unread}</span>` : ""}
        ${canDel ? `<span class="room-del" data-room-del="${r.id}" title="채팅방 삭제">✕</span>` : ""}
      </button>`;
    }).join("") + `<button type="button" class="chat-room-tab new" id="btn-new-room">＋ 채팅방</button>`;

    box.querySelectorAll("button[data-room]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        if (e.target.closest("[data-room-del]")) return;
        openRoom(btn.dataset.room);
      });
    });
    box.querySelectorAll("[data-room-del]").forEach((el) => {
      el.addEventListener("click", async (e) => {
        e.stopPropagation();
        const r = roomById(el.dataset.roomDel);
        if (!r || !confirm(`"${r.title}" 채팅방을 삭제할까요?\n대화 내용이 모두 삭제됩니다.`)) return;
        try { await deleteRoomWithMessages(db, r.id); }
        catch (err) { alert("삭제 실패: " + err.message); }
      });
    });
    $("btn-new-room").addEventListener("click", openRoomModal);
  }

  function openRoom(roomId) {
    activeRoomId = roomId;
    renderRoomTabs();
    const r = roomById(roomId);
    $("chat-room-title").textContent = r ? roomDisplayTitle(r, me.uid) : "";
    $("chat-members-pop").style.display = "none";
    $("chat-room-sub").textContent = r ? `${(r.members || []).length}명` : "";
    if (popupOpen) markRoomRead(db, roomId, me.uid);

    if (unsubMsgs) unsubMsgs();
    const box = $("chat-messages");
    box.innerHTML = '<p style="color:var(--muted); font-size:0.86rem; text-align:center; margin-top:40px;">불러오는 중…</p>';
    unsubMsgs = onSnapshot(
      query(collection(db, "rooms", roomId, "messages"), orderBy("createdAt", "asc")),
      (snap) => {
        lastPopupMsgs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        renderChatMessages(box, lastPopupMsgs, me.uid, roomById(roomId), db);
        // 팝업이 열려 있고 이 방을 보고 있을 때만 읽음 처리
        if (popupOpen && activeRoomId === roomId) markRoomRead(db, roomId, me.uid);
      },
      () => { box.innerHTML = '<p style="color:var(--muted); text-align:center; margin-top:40px;">메시지를 불러오지 못했습니다.</p>'; }
    );
  }

  async function send() {
    const ta = $("chat-text");
    const text = ta.value.trim();
    if (!text) return;
    if (text.length > 2000) { alert("메시지는 2000자 이내로 보내 주세요."); return; }
    const r = roomById(activeRoomId);
    if (!r) return;
    ta.value = "";
    try { await sendRoomMessage(db, me, r, text); }
    catch (err) { alert("전송 실패: " + err.message); ta.value = text; }
  }
  $("chat-send").addEventListener("click", send);
  $("chat-text").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
  });

  // ----- 소규모 채팅방 만들기 -----
  function openRoomModal() {
    const participants = getParticipants(); // {uid: name}
    $("rm-name").value = "";
    $("rm-members").innerHTML = Object.entries(participants)
      .filter(([uid]) => uid !== me.uid)
      .map(([uid, name]) => `
        <label class="member-check">
          <input type="checkbox" value="${esc(uid)}" />
          <span>${esc(name)}</span>
        </label>`).join("")
      || '<p style="color:var(--muted); font-size:0.84rem; padding:8px;">추가할 수 있는 참여자가 없습니다.</p>';
    $("rm-msg").className = "form-msg";
    $("room-modal").classList.add("open");
  }
  $("rm-cancel").addEventListener("click", () => $("room-modal").classList.remove("open"));
  $("room-modal").addEventListener("click", (e) => { if (e.target === $("room-modal")) $("room-modal").classList.remove("open"); });
  $("rm-create").addEventListener("click", async () => {
    const msg = $("rm-msg");
    const title = $("rm-name").value.trim();
    if (!title) { msg.textContent = "채팅방 이름을 입력해 주세요."; msg.className = "form-msg error"; return; }
    const participants = getParticipants();
    const picked = [...$("rm-members").querySelectorAll("input:checked")].map((i) => i.value);
    const members = [me.uid, ...picked];
    const names = { [me.uid]: me.name };
    const unread = { [me.uid]: 0 };
    picked.forEach((u) => { names[u] = participants[u] || "멤버"; unread[u] = 0; });
    try {
      const ref = await addDoc(collection(db, "rooms"), {
        type: "topic",
        parentType: type,
        refId, refTitle,
        title,
        members, names, unread,
        createdByUid: me.uid,
        createdAt: serverTimestamp(),
      });
      $("room-modal").classList.remove("open");
      activeRoomId = ref.id; // 스냅샷 도착 시 자동 선택
    } catch (err) {
      msg.textContent = "생성 실패: " + err.message;
      msg.className = "form-msg error";
    }
  });
}
