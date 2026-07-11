// 관리자 페이지 Firebase 연동
// - 접근 보호 / 회원 관리 / 공지·성과·프로젝트 CRUD / 대시보드 통계 / 사이트 설정 동기화
// Firebase 미설정 시 아무 것도 하지 않습니다 (데모 모드 유지).

import { auth, db, isConfigured } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc,
  onSnapshot, query, where, orderBy, serverTimestamp, runTransaction,
  arrayUnion, arrayRemove, deleteField,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  AFFILIATIONS, POSITIONS, STATUSES, fillSelect, resolveSelectValue, applySelectValue, bindEtcToggle, memberProfileFrom,
} from "./org-options.js";
import { initNoticeEditor, deleteNoticeAttachments } from "./notice-form.js";
import { uploadStoredFile, deleteStoredFile, fmtStoredSize } from "./file-store.js";

if (isConfigured) {
  window.__FB_ADMIN__ = true; // admin-demo.js의 데모 등록 핸들러 비활성화

  const CFG_KEY = "labSiteConfig";
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const fmtDate = (ts) => {
    if (!ts || !ts.toDate) return "—";
    const d = ts.toDate();
    return d.getFullYear() + "." + String(d.getMonth() + 1).padStart(2, "0") + "." + String(d.getDate()).padStart(2, "0");
  };
  const todayStr = () => {
    const d = new Date();
    return d.getFullYear() + "." + String(d.getMonth() + 1).padStart(2, "0") + "." + String(d.getDate()).padStart(2, "0");
  };
  const $ = (id) => document.getElementById(id);

  // 멤버 계정 체크박스 목록 HTML (uid 기반 연결용)
  function memberChecklistHtml(users, selectedUids) {
    const sel = new Set(selectedUids || []);
    const accounts = users.filter((u) => u.role === "member" || u.role === "admin");
    if (!accounts.length) return '<p style="color:var(--muted); font-size:0.84rem;">연결할 멤버 계정이 없습니다.</p>';
    return accounts.map((u) => `
      <label class="member-check">
        <input type="checkbox" value="${esc(u.id)}"${sel.has(u.id) ? " checked" : ""} />
        <span>${esc(u.name)} <small>${esc([u.position, u.affiliation].filter(Boolean).join(" · ") || u.email)}</small></span>
      </label>`).join("");
  }
  const checkedUids = (box) => [...box.querySelectorAll("input:checked")].map((i) => i.value);

  // 이미지 파일 → 512px 이하 JPEG Data URL (Firestore 문서에 직접 저장)
  function resizeImageToDataUrl(file, max = 512) {
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
        const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
        if (dataUrl.length > 900000) reject(new Error("압축 후에도 이미지가 너무 큽니다. 더 작은 사진을 사용해 주세요."));
        else resolve(dataUrl);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("이미지를 읽을 수 없습니다.")); };
      img.src = url;
    });
  }

  // 대시보드 집계용 상태
  const state = { users: [], posts: [], pubs: [], projects: [], certs: [] };

  // 실시간 구독 오류를 화면에 표시 (원인 파악용)
  const snapErr = (label, tbodyId, colspan) => (err) => {
    console.error("[" + label + "] 구독 오류:", err);
    const tbody = document.getElementById(tbodyId) || document.querySelector(tbodyId);
    if (tbody) tbody.innerHTML = `<tr><td colspan="${colspan}" style="color:var(--danger);">${label} 불러오기 실패: ${esc(err.code || "")} ${esc(err.message || "")}</td></tr>`;
  };

  // ================= 접근 보호 =================
  onAuthStateChanged(auth, async (user) => {
    if (!user) { location.href = "login.html"; return; }

    const snap = await getDoc(doc(db, "users", user.uid));
    const me = snap.exists() ? snap.data() : null;
    state.me = me ? { uid: user.uid, ...me } : null;
    if (!me || me.role !== "admin") {
      alert("관리자만 접근할 수 있는 페이지입니다.");
      location.href = "index.html";
      return;
    }

    const banner = $("demo-banner");
    if (banner) banner.style.display = "none";
    const userBox = document.querySelector(".admin-user");
    if (userBox) userBox.innerHTML = `<strong>${esc(me.name)}</strong><span>관리자 (admin)</span>`;

    const logoutBtn = document.querySelector('.gnb a[href="login.html"]');
    if (logoutBtn) {
      logoutBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        await signOut(auth);
        location.href = "index.html";
      });
    }

    [initMembers, initPeople, initNotices, initPublications, initProjects, initCertificates, initSiteConfigSync]
      .forEach((fn) => { try { fn(); } catch (e) { console.error(fn.name + " 초기화 오류:", e); } });
  });

  // 사이드 메뉴 대기 건수 뱃지
  function setNavCount(panel, n) {
    const navBtn = document.querySelector(`.admin-nav button[data-panel="${panel}"]`);
    if (!navBtn) return;
    let badge = navBtn.querySelector(".count");
    if (n > 0) {
      if (!badge) { badge = document.createElement("span"); badge.className = "count"; navBtn.appendChild(badge); }
      badge.textContent = n;
    } else if (badge) badge.remove();
  }

  // ================= 대시보드 =================
  function renderDashboard() {
    const activeMembers = state.users.filter((u) => u.role === "member" || u.role === "admin").length;
    const pendingUsers = state.users.filter((u) => u.role === "pending");
    const activeProjects = state.projects.filter((p) => p.status === "진행 중").length;
    const pendingPubs = state.pubs.filter((p) => p.status === "pending");

    if ($("stat-members")) {
      $("stat-members").textContent = activeMembers;
      $("stat-members-sub").textContent = pendingUsers.length ? `승인 대기 ${pendingUsers.length}명` : "승인 대기 없음";
      $("stat-projects").textContent = activeProjects;
      $("stat-projects-sub").textContent = `전체 ${state.projects.length}건`;
      $("stat-pubs").textContent = state.pubs.length;
      $("stat-pubs-sub").textContent = pendingPubs.length ? `검수 대기 ${pendingPubs.length}건` : "검수 대기 없음";
      const issuedCerts = state.certs.filter((c) => c.status === "issued").length;
      const requestedCerts = state.certs.filter((c) => c.status === "requested").length;
      $("stat-certs").textContent = issuedCerts;
      $("stat-certs-sub").textContent = requestedCerts ? `신청 대기 ${requestedCerts}건` : "신청 대기 없음";
    }

    const tbody = $("pending-tbody");
    if (tbody) {
      const rows = [];
      pendingUsers.forEach((u) => rows.push(
        `<tr><td>가입 신청</td><td>${esc(u.name)} <span class="sub">${esc(u.affiliation || "")}</span></td><td>${fmtDate(u.createdAt)}</td><td><span class="status pending">대기</span></td></tr>`
      ));
      pendingPubs.forEach((p) => rows.push(
        `<tr><td>성과 등록</td><td>${esc(p.type)} — ${esc(p.title)}</td><td>${fmtDate(p.createdAt)}</td><td><span class="status pending">검수 대기</span></td></tr>`
      ));
      state.certs.filter((c) => c.status === "requested").forEach((c) => rows.push(
        `<tr><td>확인서</td><td>${esc(c.requesterName)} — ${esc(c.projectTitle)}</td><td>${fmtDate(c.createdAt)}</td><td><span class="status pending">신청</span></td></tr>`
      ));
      tbody.innerHTML = rows.join("") || '<tr><td colspan="4" style="color:var(--muted);">처리 대기 항목이 없습니다.</td></tr>';
    }
  }

  // ================= 회원 관리 =================
  function initMembers() {
    const tbody = document.querySelector("#member-table tbody");
    if (!tbody) return;

    let invites = [];

    const subInfo = (x) => {
      const bits = [x.position, x.memberStatus].filter(Boolean).map(esc);
      return bits.length ? `<span class="sub">${bits.join(" · ")}</span>` : "";
    };

    const ROLE_BADGE = {
      admin:    '<span class="status issued">관리자</span>',
      member:   '<span class="status member">멤버</span>',
      pending:  '<span class="status pending">승인 대기</span>',
      rejected: '<span class="status rejected">거절됨</span>',
    };

    function render() {
      const rows = [];

      invites.forEach((iv) => {
        rows.push(`<tr>
          <td class="cell-name">${esc(iv.name)}</td>
          <td>${esc(iv.affiliation || "—")}${subInfo(iv)}</td>
          <td>${esc(iv.id)}</td>
          <td>${fmtDate(iv.createdAt)}</td>
          <td><span class="status approved">사전 등록 (${iv.role === "admin" ? "관리자" : "멤버"})</span></td>
          <td class="cell-actions"><button class="btn-sm danger" data-act="invite-del" data-id="${esc(iv.id)}">등록 취소</button></td>
        </tr>`);
      });

      const sorted = [...state.users].sort((a, b) => {
        const w = (r) => (r === "pending" ? 0 : r === "member" ? 1 : r === "admin" ? 2 : 3);
        return w(a.role) - w(b.role);
      });

      sorted.forEach((u) => {
        let actions = "";
        if (u.role === "pending") {
          actions = `<button class="btn-sm primary" data-act="approve" data-id="${u.id}">승인</button>
                     <button class="btn-sm danger" data-act="reject" data-id="${u.id}">거절</button>`;
        } else if (u.role === "member") {
          actions = `<button class="btn-sm" data-act="make-admin" data-id="${u.id}">관리자로 변경</button>`;
        } else if (u.role === "admin") {
          actions = auth.currentUser && u.id !== auth.currentUser.uid
            ? `<button class="btn-sm" data-act="make-member" data-id="${u.id}">멤버로 변경</button>` : "";
        } else if (u.role === "rejected") {
          actions = `<button class="btn-sm primary" data-act="approve" data-id="${u.id}">재승인</button>`;
        }
        actions += `<button class="btn-sm" data-act="edit" data-id="${u.id}">정보 수정</button>`;
        rows.push(`<tr>
          <td class="cell-name">${esc(u.name)}</td>
          <td>${esc(u.affiliation || "—")}${subInfo(u)}</td>
          <td>${esc(u.email)}</td>
          <td>${fmtDate(u.createdAt)}</td>
          <td>${ROLE_BADGE[u.role] || esc(u.role)}</td>
          <td class="cell-actions">${actions}</td>
        </tr>`);
      });

      tbody.innerHTML = rows.join("") || '<tr><td colspan="6" style="color:var(--muted);">아직 데이터가 없습니다.</td></tr>';
      setNavCount("members", state.users.filter((u) => u.role === "pending").length);
    }

    onSnapshot(query(collection(db, "users"), orderBy("createdAt", "desc")), (snap) => {
      state.users = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      render();
      renderDashboard();
    }, snapErr("회원", "#member-table tbody", 6));
    onSnapshot(collection(db, "invites"), (snap) => {
      invites = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      render();
    }, snapErr("사전 등록", "#member-table tbody", 6));

    // 승인된 계정에 연동 프로필이 없으면 구성원 문서를 자동 생성
    async function ensureMemberProfile(uid) {
      try {
        const existing = await getDocs(query(collection(db, "members"), where("linkedUid", "==", uid)));
        if (!existing.empty) return;
        const u = state.users.find((x) => x.id === uid);
        if (!u) return;
        await addDoc(collection(db, "members"), {
          ...memberProfileFrom({ ...u, uid }),
          createdAt: serverTimestamp(),
        });
      } catch (err) {
        console.warn("구성원 프로필 자동 생성 실패:", err.message);
      }
    }

    tbody.addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-act]");
      if (!btn) return;
      const { act, id } = btn.dataset;
      try {
        if (act === "approve") {
          await updateDoc(doc(db, "users", id), { role: "member" });
          await ensureMemberProfile(id); // 구성원 프로필 자동 생성 + 연동
        }
        if (act === "reject" && confirm("이 가입 신청을 거절할까요?"))
          await updateDoc(doc(db, "users", id), { role: "rejected" });
        if (act === "make-admin" && confirm("이 멤버에게 관리자 권한을 부여할까요?"))
          await updateDoc(doc(db, "users", id), { role: "admin" });
        if (act === "make-member" && confirm("이 관리자의 권한을 멤버로 변경할까요?"))
          await updateDoc(doc(db, "users", id), { role: "member" });
        if (act === "invite-del" && confirm("사전 등록을 취소할까요?"))
          await deleteDoc(doc(db, "invites", id));
        if (act === "edit") openMemberEdit(id);
      } catch (err) {
        alert("처리 중 오류가 발생했습니다: " + err.message);
      }
    });

    // ----- 회원 직접 등록 모달 -----
    fillSelect($("m-affil"), AFFILIATIONS, "소속 선택");
    fillSelect($("m-position"), POSITIONS, "직책 선택");
    fillSelect($("m-status"), STATUSES, "상태 선택");
    bindEtcToggle($("m-affil"), $("m-affil-etc-wrap"), $("m-affil-etc"));

    const saveBtn = $("member-save");
    if (saveBtn) {
      saveBtn.addEventListener("click", async () => {
        const name = $("m-name").value.trim();
        const email = $("m-email").value.trim().toLowerCase();
        const affiliation = resolveSelectValue($("m-affil"), $("m-affil-etc"));
        const position = $("m-position").value || "";
        const memberStatus = $("m-status").value || "";
        const role = $("m-role").value;
        const msg = $("member-modal-msg");

        if (!name || !email) { msg.textContent = "이름과 이메일을 입력해 주세요."; msg.className = "form-msg error"; return; }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg.textContent = "이메일 형식을 확인해 주세요."; msg.className = "form-msg error"; return; }
        if (!affiliation) { msg.textContent = "소속을 선택해 주세요. '기타'는 직접 입력이 필요합니다."; msg.className = "form-msg error"; return; }

        try {
          await setDoc(doc(db, "invites", email), { name, affiliation, position, memberStatus, role, createdAt: serverTimestamp() });
          $("member-modal").classList.remove("open");
        } catch (err) {
          msg.textContent = "저장 실패: " + err.message;
          msg.className = "form-msg error";
        }
      });
    }

    // ----- 회원 정보 수정 모달 -----
    fillSelect($("me-affil"), AFFILIATIONS, "소속 선택");
    fillSelect($("me-position"), POSITIONS, "직책 선택");
    fillSelect($("me-status"), STATUSES, "상태 선택");
    bindEtcToggle($("me-affil"), $("me-affil-etc-wrap"), $("me-affil-etc"));

    const editModal = $("member-edit-modal");
    let editingUid = null;

    function openMemberEdit(uid) {
      const u = state.users.find((x) => x.id === uid);
      if (!u) return;
      editingUid = uid;
      $("me-name").value = u.name || "";
      $("me-email").value = u.email || "";
      applySelectValue($("me-affil"), $("me-affil-etc"), $("me-affil-etc-wrap"), u.affiliation || "", AFFILIATIONS);
      if (u.position && POSITIONS.includes(u.position)) $("me-position").value = u.position;
      else if (u.position) $("me-position").value = "기타";
      else $("me-position").selectedIndex = 0;
      if (u.memberStatus && STATUSES.includes(u.memberStatus)) $("me-status").value = u.memberStatus;
      else if (u.memberStatus) $("me-status").value = "기타";
      else $("me-status").selectedIndex = 0;
      $("member-edit-msg").className = "form-msg";
      editModal.classList.add("open");
    }

    $("me-cancel").addEventListener("click", () => editModal.classList.remove("open"));
    editModal.addEventListener("click", (e) => { if (e.target === editModal) editModal.classList.remove("open"); });

    $("me-save").addEventListener("click", async () => {
      const msg = $("member-edit-msg");
      const name = $("me-name").value.trim();
      const affiliation = resolveSelectValue($("me-affil"), $("me-affil-etc"));
      const position = $("me-position").value || "";
      const memberStatus = $("me-status").value || "";
      if (!name) { msg.textContent = "이름을 입력해 주세요."; msg.className = "form-msg error"; return; }
      if (!affiliation) { msg.textContent = "소속을 선택해 주세요. '기타'는 직접 입력이 필요합니다."; msg.className = "form-msg error"; return; }
      try {
        await updateDoc(doc(db, "users", editingUid), { name, affiliation, position, memberStatus });
        // 이 계정과 연동된 구성원 프로필이 있으면 이름·소속 동기화
        try {
          const linked = await getDocs(query(collection(db, "members"), where("linkedUid", "==", editingUid)));
          for (const d of linked.docs) {
            await updateDoc(d.ref, {
              name,
              title: [position, affiliation].filter(Boolean).join(" · "),
            });
          }
        } catch (_) { /* 프로필 동기화 실패는 치명적이지 않음 */ }
        editModal.classList.remove("open");
      } catch (err) {
        msg.textContent = "저장 실패: " + err.message;
        msg.className = "form-msg error";
      }
    });
  }

  // ================= 공지 관리 =================
  function initNotices() {
    const tbody = $("notice-tbody");
    if (!tbody) return;

    // 작성·수정 모달은 공지 페이지와 공용 모듈(notice-form.js)을 사용
    const editor = initNoticeEditor(db, () => state.me);

    function render() {
      const rows = state.posts.map((p) => `<tr>
        <td>${p.badge ? '<span class="badge" style="font-size:0.68rem;font-weight:700;color:var(--danger);margin-right:6px;">' + esc(p.badge) + "</span>" : ""}${esc(p.title)}${(p.attachments || []).length ? ` <span class="sub" style="display:inline;">📎 ${(p.attachments || []).length}</span>` : ""}</td>
        <td>${esc(p.authorName || "—")}</td>
        <td>${esc(p.date || "")}</td>
        <td><span class="status ${p.scope === "public" ? "approved" : "member"}">${p.scope === "public" ? "공개" : "멤버 전용"}</span></td>
        <td>${p.slider && p.scope === "public" ? '<span class="status issued">노출</span>' : "—"}</td>
        <td class="cell-actions">
          <button class="btn-sm" data-act="edit" data-id="${p.id}">수정</button>
          <button class="btn-sm danger" data-act="del" data-id="${p.id}">삭제</button>
        </td>
      </tr>`);
      tbody.innerHTML = rows.join("") || '<tr><td colspan="6" style="color:var(--muted);">등록된 공지가 없습니다. "새 공지 작성"으로 시작하세요.</td></tr>';
    }

    onSnapshot(query(collection(db, "posts"), orderBy("date", "desc")), (snap) => {
      state.posts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      render();
      renderDashboard();
    }, snapErr("공지", "notice-tbody", 6));

    $("btn-add-notice").addEventListener("click", () => editor.open(null));

    tbody.addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-act]");
      if (!btn) return;
      const post = state.posts.find((p) => p.id === btn.dataset.id);
      if (btn.dataset.act === "edit" && post) editor.open(post);
      if (btn.dataset.act === "del" && post && confirm(`"${post.title}" 공지를 삭제할까요? 첨부파일도 함께 삭제됩니다.`)) {
        try {
          await deleteNoticeAttachments(db, post.attachments);
          await deleteDoc(doc(db, "posts", post.id));
        } catch (err) { alert("삭제 실패: " + err.message); }
      }
    });
  }

  // ================= 성과 검수/관리 =================
  function initPublications() {
    const tbody = $("pub-tbody");
    if (!tbody) return;

    const STATUS_BADGE = {
      pending:  '<span class="status pending">검수 대기</span>',
      approved: '<span class="status approved">게시 중</span>',
      internal: '<span class="status member">비공개</span>',
    };

    function render() {
      const sorted = [...state.pubs].sort((a, b) => {
        const w = (s) => (s === "pending" ? 0 : 1);
        if (w(a.status) !== w(b.status)) return w(a.status) - w(b.status);
        return (parseInt(b.year) || 0) - (parseInt(a.year) || 0);
      });
      const rows = sorted.map((p) => {
        let actions = "";
        if (p.status === "pending") {
          actions = `<button class="btn-sm primary" data-act="approve" data-id="${p.id}">승인·게시</button>
                     <button class="btn-sm" data-act="hold" data-id="${p.id}">비공개 보관</button>`;
        } else if (p.status === "approved") {
          actions = `<button class="btn-sm" data-act="unpublish" data-id="${p.id}">비공개 전환</button>`;
        } else {
          actions = `<button class="btn-sm primary" data-act="approve" data-id="${p.id}">게시하기</button>`;
        }
        actions += ` <button class="btn-sm" data-act="link" data-id="${p.id}">관리</button>`;
        actions += ` <button class="btn-sm danger" data-act="del" data-id="${p.id}">삭제</button>`;
        const linkedCount = (p.memberUids || []).length;
        return `<tr>
          <td>${esc(p.type)}</td>
          <td>${esc(p.title)}${linkedCount ? ` <span class="sub" style="display:inline;">🔗 ${linkedCount}명</span>` : ""}${p.file ? ' <span class="sub" style="display:inline;">📎</span>' : ""}${p.link ? ' <span class="sub" style="display:inline;">↗</span>' : ""}${p.meta ? ' <span class="sub">' + esc(p.meta) + "</span>" : ""}</td>
          <td>${esc(p.createdByName || "—")}</td>
          <td>${STATUS_BADGE[p.status] || esc(p.status)}</td>
          <td class="cell-actions">${actions}</td>
        </tr>`;
      });
      tbody.innerHTML = rows.join("") || '<tr><td colspan="5" style="color:var(--muted);">등록된 성과가 없습니다. "성과 직접 등록"으로 시작하세요.</td></tr>';
      setNavCount("pubs", state.pubs.filter((p) => p.status === "pending").length);
    }

    onSnapshot(collection(db, "publications"), (snap) => {
      state.pubs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      render();
      renderDashboard();
    }, snapErr("성과", "pub-tbody", 5));

    tbody.addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-act]");
      if (!btn) return;
      const { act, id } = btn.dataset;
      const pub = state.pubs.find((p) => p.id === id);
      if (act === "link" && pub) { openLinkModal(pub); return; }
      try {
        if (act === "approve") await updateDoc(doc(db, "publications", id), { visible: true, status: "approved" });
        if (act === "unpublish" || act === "hold") await updateDoc(doc(db, "publications", id), { visible: false, status: "internal" });
        if (act === "del" && pub && confirm(`"${pub.title}" 성과를 삭제할까요?${pub.file ? "\n첨부된 원문 파일도 함께 삭제됩니다." : ""}`)) {
          if (pub.file) { try { await deleteStoredFile(db, "pubFiles", pub.file.fileId); } catch (_) {} }
          await deleteDoc(doc(db, "publications", id));
        }
      } catch (err) {
        alert("처리 실패: " + err.message);
      }
    });

    // ----- 성과 관리 모달 (멤버 연결 · 링크 · 원문 파일) -----
    const linkModal = $("pub-link-modal");
    let linkingPub = null;
    let plRemoveFile = false;

    function renderPlFile() {
      const box = $("pl-file-current");
      const f = !plRemoveFile && linkingPub?.file;
      box.innerHTML = f
        ? `<div class="file-row">📎 <span class="f-name">${esc(f.name)}</span><span class="f-size">${fmtStoredSize(f.size)}</span>
             <button type="button" class="att-remove" id="pl-file-remove" title="파일 삭제">✕</button></div>`
        : "";
      const rm = $("pl-file-remove");
      if (rm) rm.addEventListener("click", () => { plRemoveFile = true; renderPlFile(); });
    }

    function openLinkModal(p) {
      linkingPub = p;
      plRemoveFile = false;
      $("pub-link-sub").textContent = p.title;
      $("pub-link-members").innerHTML = memberChecklistHtml(state.users, p.memberUids);
      $("pl-link").value = p.link || "";
      $("pl-file").value = "";
      renderPlFile();
      $("pub-link-msg").className = "form-msg";
      linkModal.classList.add("open");
    }
    $("pub-link-cancel").addEventListener("click", () => linkModal.classList.remove("open"));
    linkModal.addEventListener("click", (e) => { if (e.target === linkModal) linkModal.classList.remove("open"); });
    $("pub-link-save").addEventListener("click", async () => {
      const msg = $("pub-link-msg");
      const btn = $("pub-link-save");
      let link = $("pl-link").value.trim();
      if (link && !/^https?:\/\//i.test(link)) link = "https://" + link;
      btn.disabled = true;
      try {
        let file = plRemoveFile ? null : (linkingPub.file || null);
        const newFile = $("pl-file").files[0];
        if (newFile) {
          btn.textContent = "파일 업로드 중…";
          file = await uploadStoredFile(db, "pubFiles", auth.currentUser.uid, newFile);
        }
        // 교체·삭제된 기존 파일 정리
        if (linkingPub.file && (plRemoveFile || newFile)) {
          try { await deleteStoredFile(db, "pubFiles", linkingPub.file.fileId); } catch (_) {}
        }
        btn.textContent = "저장 중…";
        await updateDoc(doc(db, "publications", linkingPub.id), {
          memberUids: checkedUids($("pub-link-members")),
          link,
          file,
        });
        linkModal.classList.remove("open");
      } catch (err) {
        msg.textContent = "저장 실패: " + err.message;
        msg.className = "form-msg error";
      } finally {
        btn.disabled = false;
        btn.textContent = "저장";
      }
    });

    // 새 성과 등록 모달이 열릴 때 멤버 체크박스 채움 (열기 자체는 admin-demo.js 공용 핸들러)
    $("btn-add-pub").addEventListener("click", () => {
      $("p-members").innerHTML = memberChecklistHtml(state.users, []);
    });

    // 성과 직접 등록 (데모 핸들러는 __FB_ADMIN__ 플래그로 양보)
    $("pub-save").addEventListener("click", async () => {
      const title = $("p-title").value.trim();
      const msg = $("pub-modal-msg");
      if (!title) { msg.textContent = "제목을 입력해 주세요."; msg.className = "form-msg error"; return; }

      const visible = $("p-visible").value === "게시";
      const btn = $("pub-save");
      const authors = $("p-authors").value.trim();
      const venue = $("p-venue").value.trim();
      const volume = $("p-volume").value.trim();
      let link = $("p-link").value.trim();
      if (link && !/^https?:\/\//i.test(link)) link = "https://" + link;

      btn.disabled = true;
      try {
        let file = null;
        const f = $("p-file").files[0];
        if (f) {
          btn.textContent = "파일 업로드 중…";
          file = await uploadStoredFile(db, "pubFiles", auth.currentUser.uid, f);
        }
        btn.textContent = "등록 중…";
        await addDoc(collection(db, "publications"), {
          type: $("p-type").value,
          title,
          authors,
          venue,
          volume,
          link,
          file,
          meta: [authors, venue, volume].filter(Boolean).join(" · "),
          year: $("p-year").value.trim() || String(new Date().getFullYear()),
          visible,
          status: visible ? "approved" : "internal",
          memberUids: checkedUids($("p-members")),
          createdByName: "관리자 등록",
          createdAt: serverTimestamp(),
        });
        $("pub-modal").classList.remove("open");
      } catch (err) {
        msg.textContent = "저장 실패: " + err.message;
        msg.className = "form-msg error";
      } finally {
        btn.disabled = false;
        btn.textContent = "등록";
      }
    });
  }

  // ================= 프로젝트 관리 =================
  function initProjects() {
    const tbody = $("project-tbody");
    if (!tbody) return;

    const modal = $("project-modal");
    let editingId = null;

    const STATUS_CLS = { "진행 중": "approved", "준비 중": "pending", "종료": "member" };

    function render() {
      const rows = state.projects.map((p) => {
        const n = (p.participantsUids || []).length;
        return `<tr>
        <td>${esc(p.title)}${p.meta ? ' <span class="sub">' + esc(p.meta) + "</span>" : ""}${p.public === false ? ' <span class="sub">(비공개)</span>' : ""}</td>
        <td>${esc(p.period || "—")}</td>
        <td>${n ? n + "명" : (p.memberCount ? p.memberCount + "명" : "—")}</td>
        <td><span class="status ${STATUS_CLS[p.status] || "member"}">${esc(p.status)}</span></td>
        <td class="cell-actions">
          <a class="btn-sm" href="project.html?id=${p.id}" target="_blank" style="display:inline-block;">페이지</a>
          <button class="btn-sm primary" data-act="people" data-id="${p.id}">참여자</button>
          <button class="btn-sm" data-act="edit" data-id="${p.id}">수정</button>
          <button class="btn-sm danger" data-act="del" data-id="${p.id}">삭제</button>
        </td>
      </tr>`;});
      tbody.innerHTML = rows.join("") || '<tr><td colspan="5" style="color:var(--muted);">등록된 프로젝트가 없습니다. "새 프로젝트"로 시작하세요.</td></tr>';
    }

    onSnapshot(query(collection(db, "projects"), orderBy("createdAt", "desc")), (snap) => {
      state.projects = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      render();
      renderDashboard();
    }, snapErr("프로젝트", "project-tbody", 5));

    // 연구 분야 태그 옵션 (사이트 편집의 연구 분야 목록과 동기화)
    function fieldTags() {
      try { return (window.ContentStore.load().research || []).map((a) => a.tag || a.title).filter(Boolean); }
      catch (_) { return []; }
    }

    function openModal(p) {
      editingId = p ? p.id : null;
      $("project-modal-title").textContent = p ? "프로젝트 수정" : "프로젝트 등록";
      $("j-title").value = p ? p.title : "";
      $("j-intro").value = p ? (p.intro || "") : "";
      $("j-meta").value = p ? (p.meta || "") : "";
      $("j-period").value = p ? (p.period || "") : "";
      $("j-status").value = p ? p.status : "진행 중";
      $("j-count").value = p && p.memberCount ? p.memberCount : "";
      $("j-public").checked = p ? p.public !== false : true;
      $("j-recruiting").checked = p ? !!p.recruiting : false;
      const selected = new Set(p && Array.isArray(p.fields) ? p.fields : []);
      $("j-fields").innerHTML = fieldTags().map((t) =>
        `<label class="day-chip"><input type="checkbox" value="${esc(t)}"${selected.has(t) ? " checked" : ""} /><span>${esc(t)}</span></label>`
      ).join("") || '<span class="hint">사이트 편집 → 연구 분야에서 분야를 먼저 등록해 주세요.</span>';
      $("project-modal-msg").className = "form-msg";
      modal.classList.add("open");
    }

    $("btn-add-project").addEventListener("click", () => openModal(null));
    $("project-cancel").addEventListener("click", () => modal.classList.remove("open"));
    modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.remove("open"); });

    tbody.addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-act]");
      if (!btn) return;
      const p = state.projects.find((x) => x.id === btn.dataset.id);
      if (btn.dataset.act === "people" && p) openPeopleManager(p.id);
      if (btn.dataset.act === "edit" && p) openModal(p);
      if (btn.dataset.act === "del" && p && confirm(`"${p.title}" 프로젝트를 삭제할까요?`)) {
        try { await deleteDoc(doc(db, "projects", p.id)); }
        catch (err) { alert("삭제 실패: " + err.message); }
      }
    });

    // ---------- 참여자 관리 ----------
    let pmProjectId = null;
    let unsubRequests = null;
    const pmModal = $("pm-modal");

    function pmProject() { return state.projects.find((x) => x.id === pmProjectId); }

    function openPeopleManager(projectId) {
      pmProjectId = projectId;
      renderPmCurrent();
      renderPmAddSelect();
      watchRequests();
      $("pm-msg").className = "form-msg";
      pmModal.classList.add("open");
    }
    function closePeopleManager() {
      pmProjectId = null;
      if (unsubRequests) { unsubRequests(); unsubRequests = null; }
      pmModal.classList.remove("open");
    }
    $("pm-close").addEventListener("click", closePeopleManager);
    pmModal.addEventListener("click", (e) => { if (e.target === pmModal) closePeopleManager(); });

    function renderPmCurrent() {
      const p = pmProject();
      if (!p) return;
      $("pm-title").textContent = "참여자 관리 — " + p.title;
      const box = $("pm-current");
      const uids = p.participantsUids || [];
      if (!uids.length) {
        box.innerHTML = '<p style="color:var(--muted); font-size:0.86rem;">아직 참여자가 없습니다.</p>';
        return;
      }
      const leaders = new Set(p.leaderUids || []);
      box.innerHTML = uids.map((uid) => {
        const name = (p.participantsNames || {})[uid] || uid;
        const role = (p.participantsRoles || {})[uid] || "";
        const isLd = leaders.has(uid);
        return `<div class="material-item">
          <div><strong>${esc(name)}</strong>${isLd ? ' <span class="status approved" style="margin-left:6px;">리더</span>' : ""}
            <input type="text" value="${esc(role)}" data-role-uid="${esc(uid)}" placeholder="역할 (예: 리더, 부리더, 연구보조원)"
              style="margin-left:10px; padding:5px 9px; border:1px solid var(--line); border-radius:6px; font-size:0.82rem; font-family:var(--font-body); width:200px;" />
          </div>
          <div class="m-side">
            <button class="btn-sm${isLd ? "" : " primary"}" data-pm-leader="${esc(uid)}">${isLd ? "리더 해제" : "리더 지정"}</button>
            <button class="btn-sm" data-pm-save="${esc(uid)}">역할 저장</button>
            <button class="btn-sm danger" data-pm-remove="${esc(uid)}">제외</button>
          </div>
        </div>`;
      }).join("");

      box.querySelectorAll("button[data-pm-leader]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const uid = btn.dataset.pmLeader;
          const isLd = (pmProject().leaderUids || []).includes(uid);
          try {
            await updateDoc(doc(db, "projects", pmProjectId), {
              leaderUids: isLd ? arrayRemove(uid) : arrayUnion(uid),
            });
          } catch (err) { alert("변경 실패: " + err.message); }
        });
      });

      box.querySelectorAll("button[data-pm-save]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const uid = btn.dataset.pmSave;
          const input = box.querySelector(`input[data-role-uid="${uid}"]`);
          try {
            await updateDoc(doc(db, "projects", pmProjectId), { ["participantsRoles." + uid]: input.value.trim() });
            btn.textContent = "저장됨";
            setTimeout(() => (btn.textContent = "역할 저장"), 1200);
          } catch (err) { alert("저장 실패: " + err.message); }
        });
      });
      box.querySelectorAll("button[data-pm-remove]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const uid = btn.dataset.pmRemove;
          const p2 = pmProject();
          const name = (p2.participantsNames || {})[uid] || "이 참여자";
          if (!confirm(name + " 님을 프로젝트에서 제외할까요?")) return;
          try {
            await updateDoc(doc(db, "projects", pmProjectId), {
              participantsUids: arrayRemove(uid),
              leaderUids: arrayRemove(uid),
              ["participantsNames." + uid]: deleteField(),
              ["participantsRoles." + uid]: deleteField(),
            });
          } catch (err) { alert("제외 실패: " + err.message); }
        });
      });
    }

    function renderPmAddSelect() {
      const p = pmProject();
      if (!p) return;
      const current = new Set(p.participantsUids || []);
      const candidates = state.users.filter((u) => (u.role === "member" || u.role === "admin") && !current.has(u.id));
      $("pm-add-select").innerHTML = candidates.length
        ? candidates.map((u) => `<option value="${u.id}">${esc(u.name)} (${esc(u.affiliation || "")})</option>`).join("")
        : '<option value="">추가할 수 있는 멤버가 없습니다</option>';
    }

    async function addParticipant(uid, name, role) {
      await updateDoc(doc(db, "projects", pmProjectId), {
        participantsUids: arrayUnion(uid),
        ["participantsNames." + uid]: name,
        ["participantsRoles." + uid]: role || "",
      });
    }

    $("pm-add-btn").addEventListener("click", async () => {
      const uid = $("pm-add-select").value;
      if (!uid || !pmProjectId) return;
      const u = state.users.find((x) => x.id === uid);
      try {
        await addParticipant(uid, u ? u.name : uid, $("pm-add-role").value.trim());
        $("pm-add-role").value = "";
      } catch (err) {
        $("pm-msg").textContent = "추가 실패: " + err.message;
        $("pm-msg").className = "form-msg error";
      }
    });

    function watchRequests() {
      if (unsubRequests) unsubRequests();
      const box = $("pm-requests");
      box.innerHTML = '<p style="color:var(--muted); font-size:0.86rem;">불러오는 중…</p>';
      unsubRequests = onSnapshot(collection(db, "projects", pmProjectId, "joinRequests"), (snap) => {
        const reqs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        if (!reqs.length) {
          box.innerHTML = '<p style="color:var(--muted); font-size:0.86rem;">대기 중인 참여 신청이 없습니다.</p>';
          return;
        }
        box.innerHTML = reqs.map((r) => `<div class="material-item">
          <div><strong>${esc(r.name)}</strong> <span class="m-note">희망 역할: ${esc(r.role || "미기재")}</span></div>
          <div class="m-side">
            <button class="btn-sm primary" data-req-ok="${esc(r.id)}">승인</button>
            <button class="btn-sm danger" data-req-no="${esc(r.id)}">거절</button>
          </div>
        </div>`).join("");

        box.querySelectorAll("button[data-req-ok]").forEach((btn) => {
          btn.addEventListener("click", async () => {
            const r = reqs.find((x) => x.id === btn.dataset.reqOk);
            try {
              await addParticipant(r.id, r.name, r.role || "");
              await deleteDoc(doc(db, "projects", pmProjectId, "joinRequests", r.id));
            } catch (err) { alert("승인 실패: " + err.message); }
          });
        });
        box.querySelectorAll("button[data-req-no]").forEach((btn) => {
          btn.addEventListener("click", async () => {
            if (!confirm("이 참여 신청을 거절할까요?")) return;
            try { await deleteDoc(doc(db, "projects", pmProjectId, "joinRequests", btn.dataset.reqNo)); }
            catch (err) { alert("처리 실패: " + err.message); }
          });
        });
      }, (err) => {
        box.innerHTML = `<p style="color:var(--danger); font-size:0.86rem;">신청 목록 불러오기 실패: ${esc(err.code || err.message)}</p>`;
      });
    }

    // 프로젝트 스냅샷 갱신 시 열린 관리창도 갱신
    const _origRender = render;
    render = function () {
      _origRender();
      if (pmProjectId) { renderPmCurrent(); renderPmAddSelect(); }
    };

    $("project-save").addEventListener("click", async () => {
      const title = $("j-title").value.trim();
      const msg = $("project-modal-msg");
      if (!title) { msg.textContent = "프로젝트명을 입력해 주세요."; msg.className = "form-msg error"; return; }

      const data = {
        title,
        intro: $("j-intro").value.trim(),
        meta: $("j-meta").value.trim(),
        period: $("j-period").value.trim(),
        status: $("j-status").value,
        memberCount: $("j-count").value.trim(),
        public: $("j-public").checked,
        recruiting: $("j-recruiting").checked,
        fields: [...$("j-fields").querySelectorAll("input:checked")].map((i) => i.value),
        updatedAt: serverTimestamp(),
      };
      try {
        if (editingId) await updateDoc(doc(db, "projects", editingId), data);
        else await addDoc(collection(db, "projects"), { ...data, createdAt: serverTimestamp() });
        modal.classList.remove("open");
      } catch (err) {
        msg.textContent = "저장 실패: " + err.message;
        msg.className = "form-msg error";
      }
    });
  }


  // ================= 구성원 페이지 관리 (공개 프로필) =================
  function initPeople() {
    const tbody = $("people-tbody");
    if (!tbody) return;

    const modal = $("people-modal");
    let editingId = null;
    let people = [];

    const GROUP_LABEL = { professor: "지도교수", phd: "박사과정", ms: "석사과정", alumni: "졸업생" };
    const GROUP_ORDER = { professor: 0, phd: 1, ms: 2, alumni: 3 };

    const sortPeople = (list) => [...list].sort((a, b) => {
      if (GROUP_ORDER[a.group] !== GROUP_ORDER[b.group]) return GROUP_ORDER[a.group] - GROUP_ORDER[b.group];
      return (a.order || 0) - (b.order || 0);
    });

    function render() {
      const sorted = sortPeople(people);
      const rows = sorted.map((p, idx) => {
        // 같은 그룹 내 이동 가능 여부
        const prev = sorted[idx - 1];
        const next = sorted[idx + 1];
        const canUp = prev && prev.group === p.group;
        const canDown = next && next.group === p.group;
        const note = p.group === "alumni" ? [p.year, p.meta].filter(Boolean).join(" · ") : (p.interest || "");
        const linkedUser = p.linkedUid ? state.users.find((u) => u.id === p.linkedUid) : null;
        return `<tr>
          <td class="cell-name">${esc(p.name)}${linkedUser ? `<span class="sub">🔗 ${esc(linkedUser.name)} 계정</span>` : `<span class="sub" style="color:var(--danger);">계정 미연동</span>`}</td>
          <td>${GROUP_LABEL[p.group] || esc(p.group)}</td>
          <td>${esc(p.title || "—")}</td>
          <td>${esc(note || "—")}</td>
          <td class="cell-actions">
            <button class="btn-sm" data-act="up" data-id="${p.id}" ${canUp ? "" : "disabled"}>↑</button>
            <button class="btn-sm" data-act="down" data-id="${p.id}" ${canDown ? "" : "disabled"}>↓</button>
            <button class="btn-sm" data-act="edit" data-id="${p.id}">수정</button>
            <button class="btn-sm danger" data-act="del" data-id="${p.id}">삭제</button>
          </td>
        </tr>`;
      });
      tbody.innerHTML = rows.join("") || '<tr><td colspan="5" style="color:var(--muted);">등록된 구성원이 없습니다. "구성원 추가"로 시작하세요.</td></tr>';
    }

    onSnapshot(collection(db, "members"), (snap) => {
      people = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      render();
    }, snapErr("구성원 프로필", "people-tbody", 5));

    // 졸업생 선택 시 전용 필드 표시
    $("pp-group").addEventListener("change", () => {
      const isAlumni = $("pp-group").value === "alumni";
      $("pp-alumni-fields").style.display = isAlumni ? "" : "none";
      $("pp-interest-field").style.display = isAlumni ? "none" : "";
    });

    let pendingPhoto = null;   // 새로 선택한 사진 Data URL
    let removePhoto = false;   // 현재 사진 삭제 여부

    function renderPhotoPreview(current) {
      const box = $("pp-photo-preview");
      const src = pendingPhoto || (!removePhoto && current) || "";
      box.innerHTML = src
        ? `<div class="file-row" style="align-items:center;">
             <img src="${src}" alt="사진 미리보기" style="width:48px; height:48px; object-fit:cover; border-radius:50%; border:1px solid var(--line);" />
             <span class="f-name">${pendingPhoto ? "새 사진 (저장 시 적용)" : "현재 사진"}</span>
             <button type="button" class="att-remove" id="pp-photo-clear" title="사진 제거">✕</button>
           </div>`
        : "";
      const clearBtn = $("pp-photo-clear");
      if (clearBtn) clearBtn.addEventListener("click", () => {
        pendingPhoto = null;
        removePhoto = true;
        $("pp-photo-file").value = "";
        renderPhotoPreview(current);
      });
    }

    $("pp-photo-file").addEventListener("change", async () => {
      const file = $("pp-photo-file").files[0];
      if (!file) return;
      const msg = $("people-modal-msg");
      try {
        pendingPhoto = await resizeImageToDataUrl(file);
        removePhoto = false;
        msg.className = "form-msg";
      } catch (err) {
        $("pp-photo-file").value = "";
        msg.textContent = err.message;
        msg.className = "form-msg error";
      }
      const p = people.find((x) => x.id === editingId);
      renderPhotoPreview(p ? (p.photoData || p.photoUrl) : "");
    });

    // 계정 연결 시 비어 있는 이름·소속 자동 채움
    $("pp-linked").addEventListener("change", () => {
      const u = state.users.find((x) => x.id === $("pp-linked").value);
      if (!u) return;
      if (!$("pp-name").value.trim()) $("pp-name").value = u.name || "";
      if (!$("pp-title").value.trim()) {
        $("pp-title").value = [u.position, u.affiliation].filter(Boolean).join(" · ");
      }
    });

    // 연구 분야 태그 옵션 (사이트 편집의 연구 분야 목록과 동기화)
    function fieldTags() {
      try { return (window.ContentStore.load().research || []).map((a) => a.tag || a.title).filter(Boolean); }
      catch (_) { return []; }
    }

    function openModal(p) {
      editingId = p ? p.id : null;
      pendingPhoto = null;
      removePhoto = false;
      $("people-modal-title").textContent = p ? "구성원 수정" : "구성원 추가";
      $("pp-name").value = p ? p.name : "";
      $("pp-group").value = p ? p.group : "phd";
      $("pp-title").value = p ? (p.title || "") : "";
      $("pp-interest").value = p ? (p.interest || "") : "";
      $("pp-year").value = p ? (p.year || "") : "";
      $("pp-meta").value = p ? (p.meta || "") : "";
      // 멤버 계정 연결 옵션 (승인된 멤버·관리자)
      const accounts = state.users.filter((u) => u.role === "member" || u.role === "admin");
      $("pp-linked").innerHTML = '<option value="">연결 안 함</option>' + accounts.map((u) =>
        `<option value="${esc(u.id)}"${p && p.linkedUid === u.id ? " selected" : ""}>${esc(u.name)} (${esc(u.email)})</option>`
      ).join("");
      $("pp-photo-file").value = "";
      renderPhotoPreview(p ? (p.photoData || p.photoUrl) : "");
      $("pp-group").dispatchEvent(new Event("change"));
      $("people-modal-msg").className = "form-msg";
      modal.classList.add("open");
    }

    $("btn-add-person").addEventListener("click", () => openModal(null));
    $("people-cancel").addEventListener("click", () => modal.classList.remove("open"));
    modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.remove("open"); });

    tbody.addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-act]");
      if (!btn || btn.disabled) return;
      const p = people.find((x) => x.id === btn.dataset.id);
      if (!p) return;

      if (btn.dataset.act === "edit") openModal(p);
      if (btn.dataset.act === "del" && confirm(`"${p.name}" 님을 구성원 페이지에서 삭제할까요?`)) {
        try { await deleteDoc(doc(db, "members", p.id)); }
        catch (err) { alert("삭제 실패: " + err.message); }
      }
      // 같은 그룹 내 순서 교환
      if (btn.dataset.act === "up" || btn.dataset.act === "down") {
        const groupList = sortPeople(people).filter((x) => x.group === p.group);
        const i = groupList.findIndex((x) => x.id === p.id);
        const j = btn.dataset.act === "up" ? i - 1 : i + 1;
        if (j < 0 || j >= groupList.length) return;
        const other = groupList[j];
        try {
          await updateDoc(doc(db, "members", p.id), { order: other.order || 0 });
          await updateDoc(doc(db, "members", other.id), { order: p.order || 0 });
        } catch (err) { alert("순서 변경 실패: " + err.message); }
      }
    });

    $("people-save").addEventListener("click", async () => {
      const name = $("pp-name").value.trim();
      const msg = $("people-modal-msg");
      if (!name) { msg.textContent = "이름을 입력해 주세요."; msg.className = "form-msg error"; return; }

      const current = people.find((x) => x.id === editingId);
      const data = {
        name,
        group: $("pp-group").value,
        title: $("pp-title").value.trim(),
        interest: $("pp-interest").value.trim(),
        year: $("pp-year").value.trim(),
        meta: $("pp-meta").value.trim(),
        linkedUid: $("pp-linked").value || "",
        photoData: pendingPhoto || (removePhoto ? "" : (current?.photoData || "")),
        photoUrl: removePhoto ? "" : (current?.photoUrl || ""),
        updatedAt: serverTimestamp(),
      };
      try {
        if (editingId) {
          await updateDoc(doc(db, "members", editingId), data);
        } else {
          await addDoc(collection(db, "members"), { ...data, order: Date.now(), createdAt: serverTimestamp() });
        }
        modal.classList.remove("open");
      } catch (err) {
        msg.textContent = "저장 실패: " + err.message;
        msg.className = "form-msg error";
      }
    });
  }


  // ================= 연구참여확인서 발급 =================
  function initCertificates() {
    const tbody = $("cert-tbody");
    if (!tbody) return;

    const STATUS = {
      requested: '<span class="status pending">신청</span>',
      issued:    '<span class="status issued">발급 완료</span>',
      rejected:  '<span class="status rejected">반려</span>',
    };

    function certPdfData(c) {
      return {
        certNo: c.certNo,
        name: c.requesterName,
        affiliation: c.affiliation,
        projectTitle: c.projectTitle,
        role: c.role,
        period: c.period,
        issuedDate: c.issuedAt && c.issuedAt.toDate
          ? `${c.issuedAt.toDate().getFullYear()}년 ${c.issuedAt.toDate().getMonth() + 1}월 ${c.issuedAt.toDate().getDate()}일`
          : "",
      };
    }

    function render() {
      const sorted = [...state.certs].sort((a, b) => {
        const w = (s) => (s === "requested" ? 0 : 1);
        if (w(a.status) !== w(b.status)) return w(a.status) - w(b.status);
        return (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);
      });
      const rows = sorted.map((c) => {
        let actions = "";
        if (c.status === "requested") {
          actions = `<button class="btn-sm primary" data-act="issue" data-id="${c.id}">승인·발급</button>
                     <button class="btn-sm danger" data-act="reject" data-id="${c.id}">반려</button>`;
        } else if (c.status === "issued") {
          actions = `<button class="btn-sm" data-act="pdf" data-id="${c.id}">PDF 다시 받기</button>`;
        }
        actions += ` <button class="btn-sm danger" data-act="cert-del" data-id="${c.id}">삭제</button>`;
        return `<tr>
          <td>${esc(c.certNo || "—")}</td>
          <td>${esc(c.requesterName)}</td>
          <td>${esc(c.projectTitle)} <span class="sub">${esc(c.role)}${c.purpose ? " · 용도: " + esc(c.purpose) : ""}</span></td>
          <td>${esc(c.period)}</td>
          <td>${STATUS[c.status] || esc(c.status)}</td>
          <td class="cell-actions">${actions}</td>
        </tr>`;
      });
      tbody.innerHTML = rows.join("") || '<tr><td colspan="6" style="color:var(--muted);">확인서 신청 내역이 없습니다.</td></tr>';
      setNavCount("certs", state.certs.filter((c) => c.status === "requested").length);
    }

    onSnapshot(collection(db, "certificates"), (snap) => {
      state.certs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      render();
      renderDashboard();
    }, snapErr("확인서", "cert-tbody", 6));

    tbody.addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-act]");
      if (!btn) return;
      const { act, id } = btn.dataset;
      const cert = state.certs.find((c) => c.id === id);
      if (!cert) return;

      try {
        if (act === "cert-del") {
          const label = cert.certNo ? `발급번호 ${cert.certNo}` : "미발급(신청/반려) 건";
          if (!confirm(`${cert.requesterName} 님의 확인서 내역을 삭제할까요?\n${label}\n\n삭제하면 되돌릴 수 없습니다.`)) return;
          await runTransaction(db, async (tx) => {
            const counterRef = doc(db, "counters", "certificates");
            // 가장 최근 발급 건이면 발급번호 카운터를 한 칸 되돌려 번호가 낭비되지 않게 함
            const m = /^HJK-(\d{4})-(\d{4})$/.exec(cert.certNo || "");
            if (m) {
              const certYear = Number(m[1]);
              const certSeq = Number(m[2]);
              const counterSnap = await tx.get(counterRef);
              if (counterSnap.exists()
                  && counterSnap.data().year === certYear
                  && counterSnap.data().seq === certSeq) {
                tx.set(counterRef, { year: certYear, seq: certSeq - 1 });
              }
            }
            tx.delete(doc(db, "certificates", id));
          });
          return;
        }
        if (act === "issue") {
          if (!confirm(`${cert.requesterName} 님의 확인서를 발급할까요?\n프로젝트: ${cert.projectTitle}\n기간: ${cert.period} / 역할: ${cert.role}`)) return;

          // 발급번호 트랜잭션 채번 (연도별 순번, 동시 발급에도 중복 없음)
          const certNo = await runTransaction(db, async (tx) => {
            const counterRef = doc(db, "counters", "certificates");
            const counterSnap = await tx.get(counterRef);
            const year = new Date().getFullYear();
            let seq = 1;
            if (counterSnap.exists() && counterSnap.data().year === year) {
              seq = counterSnap.data().seq + 1;
            }
            tx.set(counterRef, { year, seq });
            return `HJK-${year}-${String(seq).padStart(4, "0")}`;
          });

          await updateDoc(doc(db, "certificates", id), {
            status: "issued",
            certNo,
            issuedAt: serverTimestamp(),
            issuedBy: auth.currentUser.uid,
          });
          alert(`발급 완료: ${certNo}\n신청자의 마이페이지에서 PDF를 내려받을 수 있으며, 여기서도 "PDF 다시 받기"로 출력할 수 있습니다.`);
        }
        if (act === "reject" && confirm("이 신청을 반려할까요?")) {
          await updateDoc(doc(db, "certificates", id), { status: "rejected" });
        }
        if (act === "pdf") {
          window.generateCertificatePDF(certPdfData(cert));
        }
      } catch (err) {
        alert("처리 실패: " + err.message);
      }
    });
  }

  // ================= 사이트 설정 동기화 =================
  function initSiteConfigSync() {
    // 키 순서와 무관한 안정 직렬화 (Firestore는 키 순서를 재정렬해 반환하므로 필수)
    const stableStr = (v) => {
      if (Array.isArray(v)) return "[" + v.map(stableStr).join(",") + "]";
      if (v && typeof v === "object")
        return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + stableStr(v[k])).join(",") + "}";
      return JSON.stringify(v);
    };
  
    async function syncSiteConfig() {
      try {
        const snap = await getDoc(doc(db, "siteConfig", "main"));
        if (!snap.exists()) return;
        const remote = snap.data();
        let local = null;
        try { local = JSON.parse(localStorage.getItem(CFG_KEY)); } catch (_) {}
  
        if (stableStr(remote) !== stableStr(local)) {
          localStorage.setItem(CFG_KEY, JSON.stringify(remote));
          // 자동 새로고침은 세션당 1회로 제한 — 어떤 경우에도 무한 루프 불가
          if (!sessionStorage.getItem("cfgSyncedOnce")) {
            sessionStorage.setItem("cfgSyncedOnce", "1");
            location.reload();
          }
        }
      } catch (_) {}
    }

    syncSiteConfig();

    const push = () => setTimeout(async () => {
      try {
        const cfg = JSON.parse(localStorage.getItem(CFG_KEY));
        // merge: 사이트 편집에 없는 필드(수상 내역 등)를 보존
        if (cfg) await setDoc(doc(db, "siteConfig", "main"), cfg, { merge: true });
      } catch (err) {
        alert("사이트 설정 저장(서버 반영) 실패: " + err.message);
      }
    }, 50);

    ["site-save", "site-reset", "menu-save", "menu-reset", "research-save", "research-reset"].forEach((id) => {
      const el = $(id);
      if (el) el.addEventListener("click", push);
    });
  }
}
