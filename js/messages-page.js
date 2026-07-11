// 메시지 페이지 (messages.html) — 멤버 간 1:1 DM
// 대화 ID는 두 uid를 정렬해 이은 값(uidA_uidB)이라 같은 상대와의 대화는 항상 하나로 모입니다.
// 안읽음 카운트는 dms 문서의 unread 맵(uid → 건수)으로 관리하고, 상단 ✉ 배지가 이를 합산합니다.

import { auth, db, isConfigured } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, onSnapshot,
  query, where, orderBy, serverTimestamp, increment,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { renderChatMessages, sendRoomMessage, markRoomRead, roomDisplayTitle, toggleMembersPop } from "./chat-room.js";

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

  function init() {
    // 대화 목록 실시간 구독 (1:1 DM + 팀 채팅방)
    onSnapshot(query(collection(db, "dms"), where("participants", "array-contains", me.uid)), (snap) => {
      convs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderConvList();
    }, (err) => {
      $("dm-conv-list").innerHTML = `<p style="color:var(--danger); font-size:0.86rem; padding:14px;">불러오기 실패: ${esc(err.code || err.message)}</p>`;
    });
    onSnapshot(query(collection(db, "rooms"), where("members", "array-contains", me.uid)), (snap) => {
      roomConvs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderConvList();
    }, () => {});

    // 새 메시지 모달
    $("btn-new-dm").addEventListener("click", openNewDm);
    $("nd-start").addEventListener("click", startNewDm);
    $("nd-cancel").addEventListener("click", () => $("new-dm-modal").classList.remove("open"));
    $("new-dm-modal").addEventListener("click", (e) => { if (e.target === $("new-dm-modal")) $("new-dm-modal").classList.remove("open"); });
    $("nd-search").addEventListener("input", renderNdList);

    // 입력·전송
    $("dm-send").addEventListener("click", sendMessage);
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
      const input = prompt("이 채팅방의 내 표시 이름을 입력하세요.
(비우면 기본 이름으로 돌아갑니다. 다른 멤버에게는 적용되지 않습니다.)", current);
      if (input === null) return;
      try {
        await updateDoc(doc(db, "rooms", roomId), { ["aliases." + me.uid]: input.trim() });
      } catch (err) { alert("변경 실패: " + err.message); }
    });

    // ?to=uid 로 바로 대화 열기 (구성원 페이지 등에서 연결용)
    const to = new URLSearchParams(location.search).get("to");
    if (to && to !== me.uid) openConversationWith(to);
  }

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
          sub = `<span class="dm-ref">👥 단체 채팅 · ${(c.members || []).length}명</span>`;
          avatar = "👥";
        } else {
          sub = `<span class="dm-ref">${c.parentType === "study" || c.type === "study" ? "📚" : "🧪"} ${esc(c.refTitle || "")}</span>`;
          avatar = "💬";
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
    $("dm-members-pop").style.display = "none";

    markRoomRead(db, roomId, me.uid);
    if (unsubThread) unsubThread();
    const box = $("dm-messages");
    box.innerHTML = '<p style="color:var(--muted); font-size:0.86rem; text-align:center; margin-top:40px;">불러오는 중…</p>';
    unsubThread = onSnapshot(
      query(collection(db, "rooms", roomId, "messages"), orderBy("createdAt", "asc")),
      (snap) => {
        renderChatMessages(box, snap.docs.map((d) => ({ id: d.id, ...d.data() })), me.uid);
        if (activeKey === "room:" + roomId) markRoomRead(db, roomId, me.uid);
      },
      (err) => {
        box.innerHTML = `<p style="color:var(--danger); font-size:0.86rem; text-align:center; margin-top:40px;">불러오기 실패: ${esc(err.code || err.message)}</p>`;
      }
    );
  }

  async function markRead(convId) {
    try { await updateDoc(doc(db, "dms", convId), { ["unread." + me.uid]: 0 }); } catch (_) {}
  }

  function renderMessages(msgs) {
    const box = $("dm-messages");
    if (!msgs.length) {
      box.innerHTML = '<p style="color:var(--muted); font-size:0.86rem; text-align:center; margin-top:40px;">첫 메시지를 보내 보세요.</p>';
      return;
    }
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
      return divider + `<div class="dm-msg${mine ? " mine" : ""}">
        <div class="dm-bubble">${esc(m.text)}</div>
        <div class="dm-msg-time" title="${fmtFull(m.createdAt)}">${fmtTime(m.createdAt)}</div>
      </div>`;
    }).join("");
    box.scrollTop = box.scrollHeight;
  }

  async function sendMessage() {
    if (!activeKey) return;
    const ta = $("dm-text");
    const text = ta.value.trim();
    if (!text) return;
    if (text.length > 2000) { alert("메시지는 2000자 이내로 보내 주세요."); return; }

    const [kind, id] = activeKey.split(":");
    if (kind === "room") {
      const r = roomConvs.find((x) => x.id === id);
      if (!r) return;
      ta.value = "";
      try { await sendRoomMessage(db, me, r, text); }
      catch (err) { alert("전송 실패: " + err.message); ta.value = text; }
      return;
    }

    const activeConvId = id;
    const c = convs.find((x) => x.id === activeConvId);
    const peer = c ? peerOf(c) : activeConvId.replace(me.uid, "").replace("_", "");
    ta.value = "";
    try {
      await addDoc(collection(db, "dms", activeConvId, "messages"), {
        text,
        senderUid: me.uid,
        senderName: me.name,
        createdAt: serverTimestamp(),
      });
      await updateDoc(doc(db, "dms", activeConvId), {
        lastMessage: text.length > 60 ? text.slice(0, 60) + "…" : text,
        lastAt: serverTimestamp(),
        lastSenderUid: me.uid,
        ["unread." + peer]: increment(1),
        ["names." + me.uid]: me.name, // 이름 변경 시 자연 갱신
      });
    } catch (err) {
      alert("전송 실패: " + err.message);
      ta.value = text;
    }
  }
}
