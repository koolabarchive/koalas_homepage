// 메시지 페이지 (messages.html) — 멤버 간 1:1 DM
// 대화 ID는 두 uid를 정렬해 이은 값(uidA_uidB)이라 같은 상대와의 대화는 항상 하나로 모입니다.
// 안읽음 카운트는 dms 문서의 unread 맵(uid → 건수)으로 관리하고, 상단 ✉ 배지가 이를 합산합니다.

import { auth, db, isConfigured } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, onSnapshot,
  query, where, orderBy, serverTimestamp, increment,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  renderChatMessages, sendRoomMessage, markRoomRead, roomDisplayTitle, toggleMembersPop, addRoomMembers,
  chatAttachmentHtml, bindChatAttachments, makeChatThumb, lastMessageLabel,
} from "./chat-room.js";
import { uploadStoredFile, MAX_STORED_FILE } from "./file-store.js";

if (isConfigured) {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const pad = (n) => String(n).padStart(2, "0");
  const fmtTime = (ts) => {
    if (!ts || !ts.toDate) return "";
    const d = ts.toDate();
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return pad(d.getHours()) + ":" + pad(d.getMinutes());
    if (d.getFullYear() === now.getFullYear()) return (d.getMonth() + 1) + "/" + d.getDate();
    return d.getFullYear() + "." + pad(d.getMonth() + 1) + "." + pad(d.getDate());
  };
  // 대화 버블 옆에는 항상 시각만 표시 (날짜는 날짜 구분선이 담당)
  const fmtClock = (ts) => {
    if (!ts || !ts.toDate) return "";
    const d = ts.toDate();
    return pad(d.getHours()) + ":" + pad(d.getMinutes());
  };
  const fmtFull = (ts) => {
    if (!ts || !ts.toDate) return "";
    const d = ts.toDate();
    return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  let me = null;
  let convs = [];       // 1:1 DM
  let roomConvs = [];   // 팀 채팅방 (프로젝트/스터디)
  let accounts = null;
  let activeKey = null; // "dm:{id}" | "room:{id}"
  let unsubThread = null;

  const convIdWith = (uid) => [me.uid, uid].sort().join("_");
  const activeNames = () => {
    if (!activeKey) return {};
    const [kind, id] = activeKey.split(":");
    const c = kind === "dm" ? convs.find((x) => x.id === id) : roomConvs.find((x) => x.id === id);
    return c ? (c.names || {}) : {};
  };
  const peerOf = (c) => (c.participants || []).find((u) => u !== me.uid);
  const peerName = (c) => (c.names || {})[peerOf(c)] || "알 수 없음";

  onAuthStateChanged(auth, async (user) => {
    if (!user) { location.href = "login.html"; return; }
    // 사용자 문서 조회가 실패해도(규칙 미배포 등) 멈추지 않고 비멤버로 처리
    let data = null;
    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      data = snap.exists() ? snap.data() : null;
    } catch (_) { data = null; }
    if (!data || (data.role !== "member" && data.role !== "admin")) {
      alert("승인된 멤버만 이용할 수 있는 페이지입니다.");
      location.href = "index.html";
      return;
    }
    me = { uid: user.uid, ...data };
    init();
  });

  function init() {
    // 대화 목록 실시간 구독 (1:1 DM + 팀 채팅방)
    onSnapshot(query(collection(db, "dms"), where("participants", "array-contains", me.uid)), (snap) => {
      convs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderConvList();
      // 열려 있는 대화의 읽음 표시(reads)가 바뀌면 체크도 즉시 갱신
      if (activeKey && activeKey.startsWith("dm:")) renderMessages(lastThreadMsgs);
    }, (err) => {
      $("dm-conv-list").innerHTML = `<p style="color:var(--danger); font-size:0.86rem; padding:14px;">불러오기 실패: ${esc(err.code || err.message)}</p>`;
    });
    onSnapshot(query(collection(db, "rooms"), where("members", "array-contains", me.uid)), (snap) => {
      roomConvs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderConvList();
      // 열린 팀 채팅방의 읽음(reads) 변경을 체크 표시에 즉시 반영
      if (activeKey && activeKey.startsWith("room:") && lastRoomMsgs.length) {
        const r = roomConvs.find((x) => x.id === activeKey.slice(5));
        if (r) renderChatMessages($("dm-messages"), lastRoomMsgs, me.uid, r, db);
      }
    }, () => {});

    // 새 메시지 모달
    $("btn-new-dm").addEventListener("click", openNewDm);
    $("nd-start").addEventListener("click", startNewDm);
    $("nd-cancel").addEventListener("click", () => $("new-dm-modal").classList.remove("open"));
    $("new-dm-modal").addEventListener("click", (e) => { if (e.target === $("new-dm-modal")) $("new-dm-modal").classList.remove("open"); });
    $("nd-search").addEventListener("input", renderNdList);

    // 입력·전송
    $("dm-send").addEventListener("click", sendMessage);
    $("dm-attach").addEventListener("click", () => $("dm-attach-input").click());
    $("dm-attach-input").addEventListener("change", async () => {
      const f = $("dm-attach-input").files[0];
      $("dm-attach-input").value = "";
      if (f) await sendAttachment(f);
    });
    $("dm-text").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendMessage(); }
    });
    $("dm-back").addEventListener("click", () => {
      $("dm-layout").classList.remove("thread-open");
    });

    // 멤버 목록 팝오버
    $("dm-members-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      toggleMembersPop($("dm-members-pop"), activeNames());
    });
    document.addEventListener("click", (e) => {
      const pop = $("dm-members-pop");
      if (pop.style.display !== "none" && !pop.contains(e.target) && !$("dm-members-btn").contains(e.target)) {
        pop.style.display = "none";
      }
    });

    // 채팅방 내 표시 이름 변경 (본인에게만 적용)
    $("dm-rename").addEventListener("click", async () => {
      if (!activeKey || !activeKey.startsWith("room:")) return;
      const roomId = activeKey.slice(5);
      const r = roomConvs.find((x) => x.id === roomId);
      if (!r) return;
      const current = (r.aliases || {})[me.uid] || "";
      const input = prompt("이 채팅방의 내 표시 이름을 입력하세요.\n(비우면 기본 이름으로 돌아갑니다. 다른 멤버에게는 적용되지 않습니다.)", current);
      if (input === null) return;
      try {
        await updateDoc(doc(db, "rooms", roomId), { ["aliases." + me.uid]: input.trim() });
      } catch (err) { alert("변경 실패: " + err.message); }
    });

    // 채팅방 멤버 초대
    $("dm-invite").addEventListener("click", openInvite);
    $("iv-cancel").addEventListener("click", () => $("invite-modal").classList.remove("open"));
    $("invite-modal").addEventListener("click", (e) => { if (e.target === $("invite-modal")) $("invite-modal").classList.remove("open"); });
    $("iv-search").addEventListener("input", renderIvList);
    $("iv-add").addEventListener("click", addInvited);

    // ?to=uid 로 바로 대화 열기 (구성원 페이지 등에서 연결용)
    const to = new URLSearchParams(location.search).get("to");
    if (to && to !== me.uid) openConversationWith(to);
  }

  // 대화 목록 아바타 아이콘 — 이모지는 OS마다 모양이 달라 SVG로 통일합니다.
  const AV_BUBBLE = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3.6c-4.8 0-8.7 3.3-8.7 7.4 0 2.3 1.2 4.3 3.1 5.7-.1 1-.5 2.1-1.3 3 1.6-.2 2.9-.8 3.8-1.4.97.25 2 .4 3.1.4 4.8 0 8.7-3.3 8.7-7.4S16.8 3.6 12 3.6z"/></svg>';
  const AV_PEOPLE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16.4 20v-1.5a3.6 3.6 0 0 0-3.6-3.6H6.7a3.6 3.6 0 0 0-3.6 3.6V20"/><circle cx="9.7" cy="7.5" r="3.3"/><path d="M20.9 20v-1.5a3.6 3.6 0 0 0-2.7-3.5"/><path d="M14.8 4.3a3.3 3.3 0 0 1 0 6.4"/></svg>';

  // ================= 대화 목록 (DM + 팀 채팅 통합) =================
  function renderConvList() {
    const box = $("dm-conv-list");
    const merged = [
      ...convs.map((c) => ({ kind: "dm", key: "dm:" + c.id, data: c })),
      ...roomConvs.map((r) => ({ kind: "room", key: "room:" + r.id, data: r })),
    ].sort((a, b) => (b.data.lastAt?.seconds || 0) - (a.data.lastAt?.seconds || 0));

    if (!merged.length) {
      box.innerHTML = '<p style="color:var(--muted); font-size:0.86rem; padding:14px;">아직 대화가 없습니다.<br>"새 메시지"로 시작해 보세요.</p>';
      return;
    }
    box.innerHTML = merged.map(({ kind, key, data: c }) => {
      const unread = (c.unread || {})[me.uid] || 0;
      const mineLast = c.lastSenderUid === me.uid;
      let title, sub, avatar;
      if (kind === "dm") {
        title = peerName(c);
        sub = "";
        avatar = esc(title.charAt(0));
      } else {
        title = roomDisplayTitle(c, me.uid);
        if (c.type === "group") {
          sub = `<span class="dm-ref">단체 채팅 · ${(c.members || []).length}명</span>`;
          avatar = AV_PEOPLE;
        } else {
          sub = `<span class="dm-ref">${c.parentType === "study" || c.type === "study" ? "스터디" : "프로젝트"} · ${esc(c.refTitle || "")}</span>`;
          avatar = AV_BUBBLE;
        }
      }
      return `<button type="button" class="dm-conv${key === activeKey ? " active" : ""}" data-key="${key}">
        <div class="dm-avatar${kind === "room" ? " room" : ""}">${avatar}</div>
        <div class="dm-conv-body">
          <div class="dm-conv-top">
            <strong>${esc(title)}</strong>
            <span class="dm-time">${fmtTime(c.lastAt)}</span>
          </div>
          ${sub}
          <div class="dm-conv-bottom">
            <span class="dm-snippet">${mineLast ? "나: " : ""}${esc(c.lastMessage || "")}</span>
            ${unread ? `<span class="nav-badge">${unread > 99 ? "99+" : unread}</span>` : ""}
          </div>
        </div>
      </button>`;
    }).join("");
    box.querySelectorAll("button[data-key]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const [kind, id] = btn.dataset.key.split(":");
        if (kind === "dm") openConversation(id);
        else openRoom(id);
      });
    });
  }

  // ================= 새 메시지 =================
  async function openNewDm() {
    if (!accounts) {
      try {
        const snap = await getDocs(collection(db, "users"));
        accounts = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
          .filter((u) => (u.role === "member" || u.role === "admin") && u.id !== me.uid);
      } catch (_) { accounts = []; }
    }
    $("nd-search").value = "";
    $("nd-group-name").value = "";
    ndPicked.clear();
    renderNdList();
    $("new-dm-modal").classList.add("open");
  }

  const ndPicked = new Set();

  function refreshNdControls() {
    $("nd-start").disabled = ndPicked.size === 0;
    $("nd-start").textContent = ndPicked.size >= 2 ? `단체 채팅 시작 (${ndPicked.size}명)` : "대화 시작";
    $("nd-group-field").style.display = ndPicked.size >= 2 ? "" : "none";
  }

  function renderNdList() {
    const q = $("nd-search").value.trim().toLowerCase();
    const list = (accounts || []).filter((u) =>
      !q || [u.name, u.affiliation, u.position].some((v) => (v || "").toLowerCase().includes(q)));
    $("nd-list").innerHTML = list.length ? list.map((u) => `
      <label class="member-check">
        <input type="checkbox" value="${esc(u.id)}"${ndPicked.has(u.id) ? " checked" : ""} />
        <span class="dm-avatar" style="width:28px; height:28px; font-size:0.76rem;">${esc((u.name || "?").charAt(0))}</span>
        <span>${esc(u.name)} <small>${esc([u.position, u.affiliation].filter(Boolean).join(" · ") || u.email)}</small></span>
      </label>`).join("")
      : '<p style="color:var(--muted); font-size:0.84rem; padding:10px;">검색 결과가 없습니다.</p>';
    $("nd-list").querySelectorAll("input").forEach((inp) => {
      inp.addEventListener("change", () => {
        if (inp.checked) ndPicked.add(inp.value);
        else ndPicked.delete(inp.value);
        refreshNdControls();
      });
    });
    refreshNdControls();
  }

  async function startNewDm() {
    const picked = [...ndPicked];
    if (!picked.length) return;
    $("new-dm-modal").classList.remove("open");

    if (picked.length === 1) { openConversationWith(picked[0]); return; }

    // 단체 채팅 = group 방 생성
    const names = { [me.uid]: me.name };
    const unread = { [me.uid]: 0 };
    picked.forEach((u) => {
      const acc = (accounts || []).find((a) => a.id === u);
      names[u] = acc ? acc.name : "멤버";
      unread[u] = 0;
    });
    const autoTitle = Object.values(names).slice(0, 3).join(", ") + (picked.length + 1 > 3 ? ` 외 ${picked.length + 1 - 3}명` : "");
    const title = $("nd-group-name").value.trim() || autoTitle;
    try {
      const ref = await addDoc(collection(db, "rooms"), {
        type: "group",
        title,
        members: [me.uid, ...picked],
        names, unread,
        createdByUid: me.uid,
        createdAt: serverTimestamp(),
        lastAt: serverTimestamp(),
      });
      openRoom(ref.id);
    } catch (err) { alert("단체 채팅 생성 실패: " + err.message); }
  }

  // ================= 채팅방 멤버 초대 =================
  // 프로젝트·스터디 전체 채팅방: 아직 방에 없는 "참여자"를 후보로 (참여자만 방에
  //   들어올 수 있으므로 보안 규칙과 일치)
  // 단체 채팅방: 방에 없는 모든 승인 멤버가 후보
  const ivPicked = new Set();
  let ivCandidates = [];

  async function loadAccounts() {
    if (accounts) return accounts;
    try {
      const snap = await getDocs(collection(db, "users"));
      accounts = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .filter((u) => (u.role === "member" || u.role === "admin") && u.id !== me.uid);
    } catch (_) { accounts = []; }
    return accounts;
  }

  async function openInvite() {
    if (!activeKey || !activeKey.startsWith("room:")) return;
    const room = roomConvs.find((x) => x.id === activeKey.slice(5));
    if (!room) return;

    await loadAccounts();
    const inRoom = new Set(room.members || []);
    const kind = room.type === "topic" ? room.parentType : room.type;

    if (kind === "project" || kind === "study") {
      // 부모 프로젝트·스터디의 참여자 중 아직 방에 없는 사람
      let participants = [];
      try {
        const snap = await getDoc(doc(db, kind === "project" ? "projects" : "studies", room.refId));
        participants = snap.exists() ? (snap.data().participantsUids || []) : [];
      } catch (_) {}
      ivCandidates = participants
        .filter((uid) => !inRoom.has(uid) && uid !== me.uid)
        .map((uid) => (accounts || []).find((a) => a.id === uid) || { id: uid, name: room.names?.[uid] || "멤버" });
      $("iv-hint").textContent = ivCandidates.length
        ? `${room.refTitle || "이 프로젝트"}의 참여자 중 채팅방에 없는 분을 추가합니다.`
        : "채팅방에 없는 참여자가 없습니다. 참여자를 먼저 프로젝트에 추가해 주세요.";
    } else {
      ivCandidates = (accounts || []).filter((u) => !inRoom.has(u.id));
      $("iv-hint").textContent = "이 단체 채팅방에 추가할 멤버를 선택하세요.";
    }

    ivPicked.clear();
    $("iv-search").value = "";
    $("iv-msg").className = "form-msg";
    renderIvList();
    $("invite-modal").classList.add("open");
  }

  function renderIvList() {
    const q = $("iv-search").value.trim().toLowerCase();
    const list = ivCandidates.filter((u) =>
      !q || [u.name, u.affiliation, u.position].some((v) => (v || "").toLowerCase().includes(q)));
    $("iv-list").innerHTML = list.length ? list.map((u) => `
      <label class="member-check">
        <input type="checkbox" value="${esc(u.id)}"${ivPicked.has(u.id) ? " checked" : ""} />
        <span class="dm-avatar" style="width:28px; height:28px; font-size:0.76rem;">${esc((u.name || "?").charAt(0))}</span>
        <span>${esc(u.name)} <small>${esc([u.position, u.affiliation].filter(Boolean).join(" · ") || u.email || "")}</small></span>
      </label>`).join("")
      : '<p style="color:var(--muted); font-size:0.84rem; padding:10px;">추가할 수 있는 멤버가 없습니다.</p>';
    $("iv-list").querySelectorAll("input").forEach((inp) => {
      inp.addEventListener("change", () => {
        if (inp.checked) ivPicked.add(inp.value);
        else ivPicked.delete(inp.value);
        $("iv-add").disabled = ivPicked.size === 0;
        $("iv-add").textContent = ivPicked.size ? `추가 (${ivPicked.size}명)` : "추가";
      });
    });
    $("iv-add").disabled = ivPicked.size === 0;
    $("iv-add").textContent = ivPicked.size ? `추가 (${ivPicked.size}명)` : "추가";
  }

  async function addInvited() {
    if (!activeKey || !activeKey.startsWith("room:") || !ivPicked.size) return;
    const roomId = activeKey.slice(5);
    const people = [...ivPicked].map((uid) => {
      const u = ivCandidates.find((c) => c.id === uid);
      return { uid, name: u ? u.name : "멤버" };
    });
    const btn = $("iv-add");
    btn.disabled = true;
    try {
      await addRoomMembers(db, roomId, people);
      $("invite-modal").classList.remove("open");
    } catch (err) {
      $("iv-msg").textContent = "추가 실패: " + err.message;
      $("iv-msg").className = "form-msg error";
    } finally {
      btn.disabled = false;
    }
  }

  async function openConversationWith(uid) {
    const convId = convIdWith(uid);
    const existing = convs.find((c) => c.id === convId);
    if (!existing) {
      // 상대 이름 확보 후 대화 문서 생성(병합)
      let name = "멤버";
      const fromAccounts = (accounts || []).find((u) => u.id === uid);
      if (fromAccounts) name = fromAccounts.name;
      else {
        try {
          const s = await getDoc(doc(db, "users", uid));
          if (s.exists()) name = s.data().name || name;
        } catch (_) {}
      }
      try {
        await setDoc(doc(db, "dms", convId), {
          participants: [me.uid, uid].sort(),
          names: { [me.uid]: me.name, [uid]: name },
          unread: { [me.uid]: 0, [uid]: 0 },
          createdAt: serverTimestamp(),
        }, { merge: true });
      } catch (err) { alert("대화를 열 수 없습니다: " + err.message); return; }
    }
    openConversation(convId);
  }

  // ================= 스레드 =================
  function openConversation(convId) {
    activeKey = "dm:" + convId;
    renderConvList();
    $("dm-layout").classList.add("thread-open");
    $("dm-input").style.display = "";

    const c = convs.find((x) => x.id === convId);
    $("dm-peer-name").textContent = c ? peerName(c) : "대화";
    $("dm-rename").style.display = "none";
    $("dm-members-btn").style.display = "";
    $("dm-invite").style.display = "none";   // 1:1 대화는 초대 대상이 아닙니다
    $("dm-members-pop").style.display = "none";

    // 안읽음 초기화
    markRead(convId);

    if (unsubThread) unsubThread();
    const box = $("dm-messages");
    box.innerHTML = '<p style="color:var(--muted); font-size:0.86rem; text-align:center; margin-top:40px;">불러오는 중…</p>';
    unsubThread = onSnapshot(
      query(collection(db, "dms", convId, "messages"), orderBy("createdAt", "asc")),
      (snap) => {
        const msgs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        renderMessages(msgs);
        // 대화가 열려 있는 동안 새 메시지가 오면 즉시 읽음 처리
        if (activeKey === "dm:" + convId) markRead(convId);
      },
      (err) => {
        box.innerHTML = `<p style="color:var(--danger); font-size:0.86rem; text-align:center; margin-top:40px;">불러오기 실패: ${esc(err.code || err.message)}</p>`;
      }
    );
  }

  function openRoom(roomId) {
    activeKey = "room:" + roomId;
    renderConvList();
    $("dm-layout").classList.add("thread-open");
    $("dm-input").style.display = "";

    const r = roomConvs.find((x) => x.id === roomId);
    $("dm-peer-name").textContent = r
      ? roomDisplayTitle(r, me.uid) + (r.refTitle ? " · " + r.refTitle : "")
      : "채팅방";
    $("dm-rename").style.display = "";
    $("dm-members-btn").style.display = "";
    $("dm-invite").style.display = "";
    $("dm-members-pop").style.display = "none";

    markRoomRead(db, roomId, me.uid);
    if (unsubThread) unsubThread();
    const box = $("dm-messages");
    box.innerHTML = '<p style="color:var(--muted); font-size:0.86rem; text-align:center; margin-top:40px;">불러오는 중…</p>';
    unsubThread = onSnapshot(
      query(collection(db, "rooms", roomId, "messages"), orderBy("createdAt", "asc")),
      (snap) => {
        lastRoomMsgs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const r2 = roomConvs.find((x) => x.id === roomId);
        renderChatMessages(box, lastRoomMsgs, me.uid, r2, db);
        if (activeKey === "room:" + roomId) markRoomRead(db, roomId, me.uid);
      },
      (err) => {
        box.innerHTML = `<p style="color:var(--danger); font-size:0.86rem; text-align:center; margin-top:40px;">불러오기 실패: ${esc(err.code || err.message)}</p>`;
      }
    );
  }

  async function markRead(convId) {
    try {
      await updateDoc(doc(db, "dms", convId), {
        ["unread." + me.uid]: 0,
        // 읽음 표시용: 상대는 내 reads 시각 이전의 자기 메시지를 "읽음"으로 표시
        ["reads." + me.uid]: serverTimestamp(),
      });
    } catch (_) {}
  }

  // 읽음 체크: 상대가 읽으면 파란 체크 1개, 읽기 전에는 표시 없음
  const TICK = '<svg viewBox="0 0 14 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 5.3l3.2 3L12.5 1.2"/></svg>';

  let lastThreadMsgs = [];   // reads 갱신 시 재렌더용 캐시 (DM)
  let lastRoomMsgs = [];     // reads 갱신 시 재렌더용 캐시 (팀 채팅)

  function renderMessages(msgs) {
    lastThreadMsgs = msgs;
    const box = $("dm-messages");
    if (!msgs.length) {
      box.innerHTML = '<p style="color:var(--muted); font-size:0.86rem; text-align:center; margin-top:40px;">첫 메시지를 보내 보세요.</p>';
      return;
    }
    // 상대가 마지막으로 읽은 시각 — 그 이전의 내 메시지는 "읽음"
    const convId = activeKey && activeKey.startsWith("dm:") ? activeKey.slice(3) : null;
    const c = convId ? convs.find((x) => x.id === convId) : null;
    const peerReadAt = c ? (c.reads || {})[peerOf(c)] : null;

    let lastDay = "";
    box.innerHTML = msgs.map((m) => {
      const mine = m.senderUid === me.uid;
      const day = m.createdAt?.toDate ? m.createdAt.toDate().toDateString() : "";
      let divider = "";
      if (day && day !== lastDay) {
        lastDay = day;
        const d = m.createdAt.toDate();
        divider = `<div class="dm-day">${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일</div>`;
      }
      const read = mine && m.createdAt?.toMillis && peerReadAt?.toMillis
        && m.createdAt.toMillis() <= peerReadAt.toMillis();
      const ticks = mine && read
        ? `<span class="dm-ticks read" title="읽음">${TICK}</span>`
        : "";
      const body = m.attachment ? chatAttachmentHtml(m) : `<div class="dm-bubble">${esc(m.text)}</div>`;
      return divider + `<div class="dm-msg${mine ? " mine" : ""}">
        ${body}
        <div class="dm-msg-meta"><span class="dm-msg-time" title="${fmtFull(m.createdAt)}">${fmtClock(m.createdAt)}</span>${ticks}</div>
      </div>`;
    }).join("");
    bindChatAttachments(db, box, msgs);
    box.scrollTop = box.scrollHeight;
  }

  // 텍스트 또는 첨부 하나를 현재 대화(DM/팀 채팅)로 전송
  async function deliver(text, attachment = null, thumb = null) {
    const [kind, id] = activeKey.split(":");
    if (kind === "room") {
      const r = roomConvs.find((x) => x.id === id);
      if (!r) throw new Error("채팅방을 찾을 수 없습니다");
      await sendRoomMessage(db, me, r, text, attachment, thumb);
      return;
    }
    const c = convs.find((x) => x.id === id);
    const peer = c ? peerOf(c) : id.replace(me.uid, "").replace("_", "");
    const msg = { text, senderUid: me.uid, senderName: me.name, createdAt: serverTimestamp() };
    if (attachment) { msg.attachment = attachment; if (thumb) msg.thumb = thumb; }
    await addDoc(collection(db, "dms", id, "messages"), msg);
    await updateDoc(doc(db, "dms", id), {
      lastMessage: lastMessageLabel(text, attachment),
      lastAt: serverTimestamp(),
      lastSenderUid: me.uid,
      ["unread." + peer]: increment(1),
      ["names." + me.uid]: me.name, // 이름 변경 시 자연 갱신
    });
  }

  async function sendMessage() {
    if (!activeKey) return;
    const ta = $("dm-text");
    const text = ta.value.trim();
    if (!text) return;
    if (text.length > 2000) { alert("메시지는 2000자 이내로 보내 주세요."); return; }
    ta.value = "";
    try { await deliver(text); }
    catch (err) { alert("전송 실패: " + err.message); ta.value = text; }
  }

  // 첨부 전송: 파일 선택 → 업로드(chatFiles) → 이미지면 미리보기 썸네일과 함께 전송
  async function sendAttachment(file) {
    if (!activeKey) return;
    if (file.size > MAX_STORED_FILE) { alert(`"${file.name}" 파일이 10MB를 초과합니다.`); return; }
    const btn = $("dm-attach");
    btn.disabled = true;
    btn.classList.add("busy");
    try {
      const stored = await uploadStoredFile(db, "chatFiles", me.uid, file);
      const thumb = await makeChatThumb(file);
      await deliver("", stored, thumb);
    } catch (err) {
      alert("전송 실패: " + err.message);
    } finally {
      btn.disabled = false;
      btn.classList.remove("busy");
    }
  }
}
