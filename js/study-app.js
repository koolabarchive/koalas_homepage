// 스터디 목록 페이지 (study.html) — 멤버 전용
// 목록(모집/운영/종료)과 개설만 담당. 상세는 study-detail.html?id=... 로 이동.

import { auth, db, isConfigured } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, doc, getDoc, addDoc, setDoc, updateDoc, deleteDoc, onSnapshot,
  query, orderBy, serverTimestamp, arrayUnion,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

if (isConfigured) {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const fmtDate = (ts) => {
    if (!ts || !ts.toDate) return "";
    const d = ts.toDate();
    return d.getFullYear() + "." + String(d.getMonth() + 1).padStart(2, "0") + "." + String(d.getDate()).padStart(2, "0");
  };
  const pCount = (s) => (s.participantsUids || []).length;
  const MODE_LABEL = { online: "온라인", offline: "오프라인", hybrid: "온·오프라인" };
  const modeTag = (s) => (s.mode && MODE_LABEL[s.mode] ? " · " + MODE_LABEL[s.mode] : (s.meetingUrl ? " · 🎥 온라인" : ""));
  const openedOf = (s) => (s.openedDate ? s.openedDate.replaceAll("-", ".") : fmtDate(s.createdAt));
  const link = (id) => "study-detail.html?id=" + id;

  let me = null;
  let allStudies = [];
  const applicantsByStudy = {};   // {studyId: [{uid,name,status},...]}
  const appUnsubs = {};
  const autoActivated = new Set(); // 세션 중 중복 전환 방지

  const todayStr = () => {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  };
  // 모집 기간이 지난 recruiting 스터디는 "운영 중"으로 간주 (자동 전환)
  const isExpiredRecruiting = (s) => s.status === "recruiting" && s.recruitEnd && todayStr() > s.recruitEnd;
  const effStatus = (s) => (isExpiredRecruiting(s) ? "active" : s.status);
  const beforeStart = (s) => s.recruitStart && todayStr() < s.recruitStart;
  const pendingOf = (id) => (applicantsByStudy[id] || []).filter((a) => a.status === "pending");
  const slotsUsed = (s) => (s.participantsUids || []).length + pendingOf(s.id).length;
  const isFull = (s) => !!s.capacity && slotsUsed(s) >= s.capacity;
  const fmtMD = (d) => (d ? d.slice(5).replace("-", ".") : "");

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
    onSnapshot(query(collection(db, "studies"), orderBy("createdAt", "desc")), (snap) => {
      allStudies = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      syncApplicantSubs();
      autoActivateExpired();
      render();
    }, (err) => {
      $("recruit-list").innerHTML = `<div class="card"><p style="color:var(--danger);">불러오기 실패: ${esc(err.code || err.message)}</p></div>`;
    });
    bindCreateModal();
  }

  // 모집 중 스터디의 신청자 목록을 실시간 구독 (게이지·버튼 상태용)
  function syncApplicantSubs() {
    const recruitingIds = new Set(allStudies.filter((s) => s.status === "recruiting").map((s) => s.id));
    recruitingIds.forEach((id) => {
      if (appUnsubs[id]) return;
      appUnsubs[id] = onSnapshot(collection(db, "studies", id, "applicants"), (snap) => {
        applicantsByStudy[id] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        render();
      }, () => {});
    });
    Object.keys(appUnsubs).forEach((id) => {
      if (!recruitingIds.has(id)) { appUnsubs[id](); delete appUnsubs[id]; delete applicantsByStudy[id]; }
    });
  }

  // 모집 마감일이 지난 스터디: 리더·관리자가 페이지를 열면 실제 문서도 "운영 중"으로 전환
  function autoActivateExpired() {
    allStudies.forEach((s) => {
      if (!isExpiredRecruiting(s) || autoActivated.has(s.id)) return;
      if (me.role === "admin" || s.leaderUid === me.uid) {
        autoActivated.add(s.id);
        updateDoc(doc(db, "studies", s.id), { status: "active" }).catch(() => {});
      }
    });
  }

  function render() {
    const studies = allStudies;
    const recruiting = studies.filter((s) => effStatus(s) === "recruiting");
    $("recruit-list").innerHTML = recruiting.length
      ? recruiting.map(recruitCardHtml).join("")
      : '<div class="card"><p style="color:var(--muted);">모집 중인 스터디가 없습니다. 새 스터디를 개설해 보세요!</p></div>';
    bindRecruitActions();

    const active = studies.filter((s) => effStatus(s) === "active");
    $("active-grid").innerHTML = active.length
      ? active.map((s) => `
          <a href="${link(s.id)}" class="card study-card" style="display:block;">
            <span class="tag">운영 중</span>
            <h3>${esc(s.title)}</h3>
            <p>${esc(s.schedule || "")}</p>
            <div class="study-meta" style="margin-top:12px;">리더 <strong>${esc(s.leaderName)}</strong> · 참여 ${pCount(s)}명${modeTag(s)}</div>
          </a>`).join("")
      : '<div class="card"><p style="color:var(--muted);">운영 중인 스터디가 없습니다.</p></div>';

    const ended = studies.filter((s) => s.status === "ended");
    $("ended-list").innerHTML = ended.length
      ? ended.map((s) => `
          <a href="${link(s.id)}" class="pub-item" style="cursor:pointer; text-decoration:none;">
            <div class="pub-year">${openedOf(s)}</div>
            <div>
              <span class="pub-type">종료</span>
              <div class="pub-title">${esc(s.title)}</div>
              <div class="pub-meta">리더 ${esc(s.leaderName)} · 참여 ${pCount(s)}명 · 자료실 열람 가능</div>
            </div>
          </a>`).join("")
      : '<div class="pub-item"><div></div><div class="pub-meta">종료된 스터디가 없습니다.</div></div>';
  }

  // ----- 모집 카드 -----
  function recruitCardHtml(s) {
    const apps = applicantsByStudy[s.id] || [];
    const mine = apps.find((a) => a.uid === me.uid);
    const joined = (s.participantsUids || []).includes(me.uid);
    const canManage = me.role === "admin" || s.leaderUid === me.uid;
    const used = slotsUsed(s);
    const full = isFull(s);
    const notStarted = beforeStart(s);

    // 게이지
    let gauge = "";
    if (s.capacity) {
      const pct = Math.min(100, Math.round((used / s.capacity) * 100));
      gauge = `
        <div class="gauge"><div class="gauge-fill${full ? " full" : ""}" style="width:${pct}%;"></div></div>
        <div class="gauge-label">${used} / ${s.capacity}명 ${full ? '<span class="status pending" style="margin-left:6px;">모집 마감</span>' : ""}</div>`;
    } else {
      gauge = `<div class="gauge-label">현재 ${used}명 · 인원 제한 없음</div>`;
    }

    // 기간 표시
    const period = [s.recruitStart ? fmtMD(s.recruitStart) : "", s.recruitEnd ? fmtMD(s.recruitEnd) : ""].filter(Boolean).join(" ~ ");
    let dday = "";
    if (s.recruitEnd) {
      const diff = Math.ceil((new Date(s.recruitEnd) - new Date(todayStr())) / 86400000);
      dday = diff === 0 ? "오늘 마감" : `D-${diff}`;
    }

    // 내 상태에 따른 액션
    let action = "";
    if (joined) {
      action = '<span class="status approved">참여 중</span>';
    } else if (mine && mine.status === "pending") {
      action = `<span class="status pending">승인 대기 중</span> <button class="btn-sm" data-cancel="${s.id}">신청 취소</button>`;
    } else if (mine && mine.status === "approved") {
      action = '<span class="status approved">참여 확정</span>';
    } else if (mine && mine.status === "rejected") {
      action = '<span class="status member">신청이 승인되지 않았습니다</span>';
    } else if (notStarted) {
      action = `<span class="status member">모집 시작 전 (${fmtMD(s.recruitStart)}부터)</span>`;
    } else if (full) {
      action = '<button class="btn-sm" disabled>모집 마감</button>';
    } else {
      action = `<button class="btn-sm primary" data-apply="${s.id}">스터디 신청</button>`;
    }

    // 리더·관리자: 신청자 승인/거절
    let manage = "";
    if (canManage) {
      const pend = pendingOf(s.id);
      manage = `<div class="recruit-manage">
        <div class="rm-title">신청자 ${pend.length}명</div>
        ${pend.length ? pend.map((a) => `
          <div class="rm-row">
            <span>${esc(a.name)}</span>
            <span>
              <button class="btn-sm primary" data-approve="${s.id}:${a.uid}">승인</button>
              <button class="btn-sm danger" data-reject="${s.id}:${a.uid}">거절</button>
            </span>
          </div>`).join("") : '<div class="rm-row" style="color:var(--muted);">대기 중인 신청이 없습니다.</div>'}
      </div>`;
    }

    return `<div class="card recruit-card">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">
        <a href="${link(s.id)}" style="text-decoration:none; color:var(--ink);"><h3 style="font-size:1.05rem;">${esc(s.title)}</h3></a>
        ${dday ? `<span class="status ${dday === "오늘 마감" ? "pending" : "approved"}" style="flex:none;">${dday}</span>` : ""}
      </div>
      <div class="study-meta" style="margin:6px 0 4px;">리더 <strong>${esc(s.leaderName)}</strong>${s.schedule ? " · " + esc(s.schedule) : ""}${modeTag(s)}</div>
      ${period ? `<div class="study-meta">모집기간 ${esc(period)}</div>` : ""}
      ${s.desc ? `<p style="font-size:0.86rem; color:var(--muted); margin:8px 0 0; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">${esc(s.desc)}</p>` : ""}
      <div style="margin-top:12px;">${gauge}</div>
      <div class="recruit-actions">${action}</div>
      ${manage}
    </div>`;
  }

  function bindRecruitActions() {
    const box = $("recruit-list");
    box.querySelectorAll("[data-apply]").forEach((btn) => btn.addEventListener("click", async () => {
      const s = allStudies.find((x) => x.id === btn.dataset.apply);
      if (!s) return;
      if (isFull(s)) { alert("모집이 마감되었습니다."); return; }
      try {
        await setDoc(doc(db, "studies", s.id, "applicants", me.uid), {
          uid: me.uid, name: me.name, status: "pending", createdAt: serverTimestamp(),
        });
      } catch (err) { alert("신청 실패: " + err.message); }
    }));
    box.querySelectorAll("[data-cancel]").forEach((btn) => btn.addEventListener("click", async () => {
      if (!confirm("신청을 취소할까요?")) return;
      try { await deleteDoc(doc(db, "studies", btn.dataset.cancel, "applicants", me.uid)); }
      catch (err) { alert("취소 실패: " + err.message); }
    }));
    box.querySelectorAll("[data-approve]").forEach((btn) => btn.addEventListener("click", async () => {
      const [sid, uid] = btn.dataset.approve.split(":");
      const app = (applicantsByStudy[sid] || []).find((a) => a.uid === uid);
      if (!app) return;
      try {
        await updateDoc(doc(db, "studies", sid), {
          participantsUids: arrayUnion(uid),
          ["participantsNames." + uid]: app.name,
        });
        await updateDoc(doc(db, "studies", sid, "applicants", uid), { status: "approved" });
      } catch (err) { alert("승인 실패: " + err.message); }
    }));
    box.querySelectorAll("[data-reject]").forEach((btn) => btn.addEventListener("click", async () => {
      const [sid, uid] = btn.dataset.reject.split(":");
      if (!confirm("이 신청을 거절할까요? 자리가 다시 열립니다.")) return;
      try { await updateDoc(doc(db, "studies", sid, "applicants", uid), { status: "rejected" }); }
      catch (err) { alert("거절 실패: " + err.message); }
    }));
  }

  function bindCreateModal() {
    const modal = $("create-modal");
    // 진행 요일 선택 UI (월→일, JS getDay 값 기준)
    const DAYS = [
      { v: 1, l: "월" }, { v: 2, l: "화" }, { v: 3, l: "수" }, { v: 4, l: "목" },
      { v: 5, l: "금" }, { v: 6, l: "토" }, { v: 0, l: "일" },
    ];
    $("st-days").innerHTML = DAYS.map((d) =>
      `<label class="day-chip"><input type="checkbox" value="${d.v}" /><span>${d.l}</span></label>`
    ).join("");
    const todayStr = () => {
      const d = new Date();
      return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    };

    $("btn-create-study").addEventListener("click", () => {
      $("st-title").value = "";
      $("st-capacity").value = "";
      $("st-recruit-start").value = todayStr();
      $("st-recruit-end").value = "";
      $("st-schedule").value = "";
      $("st-desc").value = "";
      $("st-weeks").value = "";
      $("st-start").value = "";
      $("st-meeting").value = "";
      $("st-mode").value = "online";
      $("st-opened").value = todayStr();
      $("st-days").querySelectorAll("input").forEach((i) => (i.checked = false));
      $("create-modal-msg").className = "form-msg";
      modal.classList.add("open");
    });
    $("create-cancel").addEventListener("click", () => modal.classList.remove("open"));
    modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.remove("open"); });

    $("create-save").addEventListener("click", async () => {
      const msg = $("create-modal-msg");
      const title = $("st-title").value.trim();
      if (!title) { msg.textContent = "스터디 이름을 입력해 주세요."; msg.className = "form-msg error"; return; }
      const capacity = Math.max(0, parseInt($("st-capacity").value, 10) || 0) || null;
      if (capacity === 1) { msg.textContent = "최대 인원은 리더를 포함한 수라 2명 이상이어야 합니다."; msg.className = "form-msg error"; return; }
      const recruitStart = $("st-recruit-start").value || todayStr();
      const recruitEnd = $("st-recruit-end").value || "";
      if (recruitEnd && recruitEnd < recruitStart) { msg.textContent = "모집 마감일이 시작일보다 빠릅니다."; msg.className = "form-msg error"; return; }
      let meetingUrl = $("st-meeting").value.trim();
      if (meetingUrl && !/^https?:\/\//i.test(meetingUrl)) meetingUrl = "https://" + meetingUrl;
      try {
        const ref = await addDoc(collection(db, "studies"), {
          title,
          schedule: $("st-schedule").value.trim(),
          desc: $("st-desc").value.trim(),
          totalWeeks: $("st-weeks").value.trim(),
          startDate: $("st-start").value,
          mode: $("st-mode").value,
          openedDate: $("st-opened").value,
          days: [...$("st-days").querySelectorAll("input:checked")].map((i) => Number(i.value)),
          capacity,
          recruitStart,
          recruitEnd,
          meetingUrl,
          leaderUid: me.uid,
          leaderName: me.name,
          status: "recruiting",
          participantsUids: [me.uid],
          participantsNames: { [me.uid]: me.name },
          createdAt: serverTimestamp(),
        });
        location.href = "study-detail.html?id=" + ref.id;
      } catch (err) {
        msg.textContent = "개설 실패: " + err.message;
        msg.className = "form-msg error";
      }
    });
  }
}
