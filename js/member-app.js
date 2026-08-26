// 멤버 대시보드 (dashboard.html)
// - 접근 보호: 승인된 멤버/관리자만
// - 연구참여확인서: 신청, 내역 확인, 발급 완료 시 PDF 다운로드
// - 성과 등록: 검수 대기 상태로 등록, 내 성과 상태 확인
// - 연구실 프로젝트 열람 (비공개 포함)

import { auth, db, isConfigured } from "./firebase-config.js";
import { uploadStoredFile } from "./file-store.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc, onSnapshot,
  query, where, orderBy, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  sendPasswordResetEmail, EmailAuthProvider, reauthenticateWithCredential, updatePassword,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  AFFILIATIONS, POSITIONS, STATUSES, fillSelect, resolveSelectValue, applySelectValue, bindEtcToggle,
  memberProfileFrom, resizeImageToDataUrl,
} from "./org-options.js";

if (!isConfigured) {
  document.getElementById("my-info").textContent = "Firebase 연동 후 사용할 수 있는 페이지입니다.";
} else {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const fmtDate = (ts) => {
    if (!ts || !ts.toDate) return "—";
    const d = ts.toDate();
    return d.getFullYear() + "." + String(d.getMonth() + 1).padStart(2, "0") + "." + String(d.getDate()).padStart(2, "0");
  };

  onAuthStateChanged(auth, async (user) => {
    if (!user) { location.href = "login.html"; return; }

    const snap = await getDoc(doc(db, "users", user.uid));
    const me = snap.exists() ? { uid: user.uid, ...snap.data() } : null;
    if (!me || (me.role !== "member" && me.role !== "admin")) {
      alert("승인된 멤버만 이용할 수 있는 페이지입니다.");
      location.href = "index.html";
      return;
    }

    const renderMyInfo = () => {
      $("my-info").innerHTML = `${esc(me.name)} · ${esc(me.affiliation || "")}${me.position ? " · " + esc(me.position) : ""}${me.memberStatus ? " · " + esc(me.memberStatus) : ""} · ${me.role === "admin" ? "관리자" : "멤버"}`;
      // 사이드바 사용자 박스 (관리자 페이지와 같은 형태)
      const sideName = $("side-user-name");
      if (sideName) sideName.textContent = me.name || "—";
      const sideRole = $("side-user-role");
      if (sideRole) sideRole.textContent = me.role === "admin" ? "관리자" : "멤버";
    };
    renderMyInfo();
    initMyProfile(me, renderMyInfo);

    initCertificates(me);
    initMyPublications(me);
    initMyStudies(me);
    initMyInquiries(me);
    initProjects(me);
  });

  // ================= 연구참여확인서 =================
  // ----- 내 정보 수정 (계정 프로필: 이름·소속·직책·상태) -----
  // 모달이 아니라 "내 정보" 패널 안의 인라인 폼입니다. 저장·비밀번호 변경
  // 결과도 팝업 없이 폼 아래에 바로 표시됩니다.
  function initMyProfile(me, onSaved) {
    if (!$("me2-name")) return;

    fillSelect($("me2-affil"), AFFILIATIONS, "소속 선택");
    fillSelect($("me2-position"), POSITIONS, "직책 선택");
    fillSelect($("me2-status"), STATUSES, "상태 선택");
    bindEtcToggle($("me2-affil"), $("me2-affil-etc-wrap"), $("me2-affil-etc"));

    // ----- 프로필 사진 (구성원 공개 프로필 members.photoData) -----
    let myProfile = null;        // 내 계정에 연결된 구성원 프로필 문서
    let pendingPhoto = null;     // 새로 고른 사진 (저장 시 적용)
    let removePhoto = false;

    function renderPhotoPreview() {
      const box = $("me2-photo-preview");
      const current = myProfile ? (myProfile.photoData || myProfile.photoUrl || "") : "";
      const src = pendingPhoto || (!removePhoto && current) || "";
      box.innerHTML = src
        ? `<div class="file-row" style="align-items:center;">
             <img src="${src}" alt="사진 미리보기" style="width:48px; height:48px; object-fit:cover; border-radius:50%; border:1px solid var(--line);" />
             <span class="f-name">${pendingPhoto ? "새 사진 (저장 시 적용)" : "현재 사진"}</span>
             <button type="button" class="att-remove" id="me2-photo-clear" title="사진 제거">✕</button>
           </div>`
        : '<p class="hint" style="margin:0;">등록된 사진이 없습니다. 파일을 선택하면 저장 시 적용됩니다.</p>';
      const clearBtn = $("me2-photo-clear");
      if (clearBtn) clearBtn.addEventListener("click", () => {
        pendingPhoto = null;
        removePhoto = true;
        $("me2-photo-file").value = "";
        renderPhotoPreview();
      });
    }

    $("me2-photo-file").addEventListener("change", async () => {
      const file = $("me2-photo-file").files[0];
      if (!file) return;
      const msg = $("me2-msg");
      try {
        pendingPhoto = await resizeImageToDataUrl(file);
        removePhoto = false;
        msg.className = "form-msg";
      } catch (err) {
        $("me2-photo-file").value = "";
        msg.textContent = err.message;
        msg.className = "form-msg error";
      }
      renderPhotoPreview();
    });

    async function loadMyProfile() {
      try {
        const snap = await getDocs(query(collection(db, "members"), where("linkedUid", "==", me.uid)));
        myProfile = snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
      } catch (_) { myProfile = null; }
    }

    // 사진 변경분을 구성원 프로필에 반영 (프로필이 없으면 새로 만듦)
    async function savePhotoIfChanged() {
      if (!pendingPhoto && !removePhoto) return;
      const photoData = pendingPhoto || "";
      if (myProfile) {
        // 보안 규칙상 본인은 사진 필드만 수정할 수 있습니다
        await updateDoc(doc(db, "members", myProfile.id), { photoData, photoUrl: "" });
        Object.assign(myProfile, { photoData, photoUrl: "" });
      } else if (photoData) {
        const ref = await addDoc(collection(db, "members"), {
          ...memberProfileFrom(me),
          photoData,
          createdAt: serverTimestamp(),
        });
        myProfile = { id: ref.id, ...memberProfileFrom(me), photoData };
      }
      pendingPhoto = null;
      removePhoto = false;
    }

    // 페이지에 들어오면 바로 현재 정보를 채워 보여 줍니다
    (async () => {
      await loadMyProfile();
      renderPhotoPreview();
      $("me2-name").value = me.name || "";
      applySelectValue($("me2-affil"), $("me2-affil-etc"), $("me2-affil-etc-wrap"), me.affiliation || "", AFFILIATIONS);
      $("me2-position").value = me.position || "";
      $("me2-status").value = me.memberStatus || "";
      $("me2-email").value = me.email || "";
    })();

    $("me2-save").addEventListener("click", async () => {
      const msg = $("me2-msg");
      const name = $("me2-name").value.trim();
      if (!name) { msg.textContent = "이름을 입력해 주세요."; msg.className = "form-msg error"; return; }
      const saveBtn = $("me2-save");
      saveBtn.disabled = true;
      try {
        const affiliation = resolveSelectValue($("me2-affil"), $("me2-affil-etc"));
        const position = $("me2-position").value;
        const memberStatus = $("me2-status").value;
        // 보안 규칙상 본인은 role을 제외한 프로필만 수정할 수 있습니다
        await updateDoc(doc(db, "users", me.uid), { name, affiliation, position, memberStatus });
        Object.assign(me, { name, affiliation, position, memberStatus });
        await savePhotoIfChanged();
        renderPhotoPreview();
        onSaved && onSaved();
        msg.textContent = "저장되었습니다.";
        msg.className = "form-msg ok";
      } catch (err) {
        msg.textContent = "저장 실패: " + err.message;
        msg.className = "form-msg error";
      } finally {
        saveBtn.disabled = false;
      }
    });

    // ----- 비밀번호 변경: 현재/새 비밀번호를 직접 입력해 즉시 변경 -----
    $("me2-pw-change").addEventListener("click", async () => {
      const msg = $("me2-pw-msg");
      const say = (t, cls) => { msg.textContent = t; msg.className = "form-msg " + cls; };
      const current = $("me2-pw-current").value;
      const nw = $("me2-pw-new").value;
      const nw2 = $("me2-pw-new2").value;
      if (!current) return say("현재 비밀번호를 입력해 주세요.", "error");
      if (nw.length < 6) return say("새 비밀번호는 6자 이상이어야 합니다.", "error");
      if (nw !== nw2) return say("새 비밀번호가 서로 일치하지 않습니다.", "error");
      if (nw === current) return say("현재 비밀번호와 다른 비밀번호를 입력해 주세요.", "error");
      const btn = $("me2-pw-change");
      btn.disabled = true;
      try {
        // 보안상 비밀번호 변경 전 현재 비밀번호로 재인증이 필요합니다
        const cred = EmailAuthProvider.credential(me.email, current);
        await reauthenticateWithCredential(auth.currentUser, cred);
        await updatePassword(auth.currentUser, nw);
        $("me2-pw-current").value = $("me2-pw-new").value = $("me2-pw-new2").value = "";
        say("비밀번호가 변경되었습니다. 다음 로그인부터 새 비밀번호를 사용하세요.", "ok");
      } catch (err) {
        if (err.code === "auth/wrong-password" || err.code === "auth/invalid-credential")
          say("현재 비밀번호가 올바르지 않습니다.", "error");
        else if (err.code === "auth/weak-password")
          say("새 비밀번호가 너무 단순합니다. 더 길거나 복잡하게 정해 주세요.", "error");
        else if (err.code === "auth/too-many-requests")
          say("시도가 너무 많았습니다. 잠시 후 다시 시도해 주세요.", "error");
        else say("변경 실패: " + err.message, "error");
      } finally {
        btn.disabled = false;
      }
    });

    $("me2-pw-reset").addEventListener("click", async () => {
      const msg = $("me2-pw-msg");
      try {
        await sendPasswordResetEmail(auth, me.email);
        msg.textContent = "재설정 메일을 보냈습니다. 받은편지함(스팸함 포함)을 확인해 주세요.";
        msg.className = "form-msg ok";
      } catch (err) {
        msg.textContent = "메일 전송 실패: " + err.message;
        msg.className = "form-msg error";
      }
    });
  }

  function initCertificates(me) {
    const tbody = $("my-cert-tbody");
    const modal = $("cert-modal");
    let myCerts = [];
    let projects = [];

    const STATUS = {
      requested: '<span class="status pending">신청 접수</span>',
      issued:    '<span class="status issued">발급 완료</span>',
      rejected:  '<span class="status rejected">반려</span>',
    };

    function render() {
      const sorted = [...myCerts].sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      const rows = sorted.map((c) => `<tr>
        <td>${esc(c.certNo || "—")}</td>
        <td>${esc(c.projectTitle)}</td>
        <td>${esc(c.role)}</td>
        <td>${esc(c.period)}</td>
        <td>${STATUS[c.status] || esc(c.status)}</td>
        <td>${c.status === "issued" ? `<button class="btn-sm primary" data-act="pdf" data-id="${c.id}">PDF 다운로드</button>` : "—"}</td>
      </tr>`);
      tbody.innerHTML = rows.join("") || '<tr><td colspan="6" style="color:var(--muted);">신청 내역이 없습니다.</td></tr>';
    }

    onSnapshot(query(collection(db, "certificates"), where("requesterUid", "==", me.uid)), (snap) => {
      myCerts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      render();
    });

    tbody.addEventListener("click", (e) => {
      const btn = e.target.closest('button[data-act="pdf"]');
      if (!btn) return;
      const c = myCerts.find((x) => x.id === btn.dataset.id);
      if (!c) return;
      window.generateCertificatePDF({
        certNo: c.certNo,
        name: c.requesterName,
        affiliation: c.affiliation,
        projectTitle: c.projectTitle,
        role: c.role,
        period: c.period,
        issuedDate: c.issuedAt && c.issuedAt.toDate
          ? `${c.issuedAt.toDate().getFullYear()}년 ${c.issuedAt.toDate().getMonth() + 1}월 ${c.issuedAt.toDate().getDate()}일`
          : "",
      });
    });

    // 신청 모달
    $("btn-apply-cert").addEventListener("click", async () => {
      // 프로젝트 목록 로드 (최초 1회)
      if (!projects.length) {
        try {
          const snap = await getDocs(collection(db, "projects"));
          projects = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        } catch (_) {}
      }
      const sel = $("c-project");
      sel.innerHTML = projects.length
        ? projects.map((p) => `<option value="${p.id}">${esc(p.title)}</option>`).join("")
        : '<option value="">등록된 프로젝트가 없습니다</option>';
      const prefillRole = () => {
        const p = projects.find((x) => x.id === sel.value);
        const assigned = p && p.participantsRoles ? p.participantsRoles[me.uid] : "";
        if (assigned && !$("c-role").value.trim()) $("c-role").value = assigned;
      };
      sel.onchange = prefillRole;
      prefillRole();
      $("c-role").value = "";
      $("c-period").value = "";
      $("c-purpose").value = "";
      $("cert-modal-msg").className = "form-msg";
      modal.classList.add("open");
    });

    $("cert-cancel").addEventListener("click", () => modal.classList.remove("open"));
    modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.remove("open"); });

    $("cert-submit").addEventListener("click", async () => {
      const msg = $("cert-modal-msg");
      const projectId = $("c-project").value;
      const role = $("c-role").value.trim();
      const period = $("c-period").value.trim();
      if (!projectId) { msg.textContent = "신청할 프로젝트가 없습니다. 관리자에게 문의해 주세요."; msg.className = "form-msg error"; return; }
      if (!role || !period) { msg.textContent = "참여 역할과 기간을 입력해 주세요."; msg.className = "form-msg error"; return; }

      const project = projects.find((p) => p.id === projectId);
      try {
        await addDoc(collection(db, "certificates"), {
          requesterUid: me.uid,
          requesterName: me.name,
          affiliation: me.affiliation || "",
          projectId,
          projectTitle: project ? project.title : "",
          role,
          period,
          purpose: $("c-purpose").value.trim(),
          status: "requested",
          createdAt: serverTimestamp(),
        });
        modal.classList.remove("open");
      } catch (err) {
        msg.textContent = "신청 실패: " + err.message;
        msg.className = "form-msg error";
      }
    });
  }

  // ================= 내 연구 성과 =================
  function initMyPublications(me) {
    const tbody = $("my-pub-tbody");
    const modal = $("mypub-modal");
    let myPubs = [];

    const STATUS = {
      pending:  '<span class="status pending">검수 대기</span>',
      approved: '<span class="status approved">게시 중</span>',
      internal: '<span class="status member">비공개 보관</span>',
    };

    function render() {
      const sorted = [...myPubs].sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      const rows = sorted.map((p) => `<tr>
        <td>${esc(p.type)}</td>
        <td>${esc(p.title)}${p.meta ? ' <span class="sub">' + esc(p.meta) + "</span>" : ""}</td>
        <td>${esc(p.year || "")}</td>
        <td>${STATUS[p.status] || esc(p.status)}</td>
      </tr>`);
      tbody.innerHTML = rows.join("") || '<tr><td colspan="4" style="color:var(--muted);">등록한 성과가 없습니다.</td></tr>';
    }

    onSnapshot(query(collection(db, "publications"), where("createdByUid", "==", me.uid)), (snap) => {
      myPubs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      render();
    });

    $("btn-add-mypub").addEventListener("click", () => {
      $("mp-title").value = "";
      $("mp-authors").value = "";
      $("mp-venue").value = "";
      $("mp-volume").value = "";
      $("mp-link").value = "";
      $("mp-file").value = "";
      $("mp-year").value = String(new Date().getFullYear());
      $("mp-type").selectedIndex = 0;
      $("mypub-modal-msg").className = "form-msg";
      modal.classList.add("open");
    });
    $("mypub-cancel").addEventListener("click", () => modal.classList.remove("open"));
    modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.remove("open"); });

    $("mypub-submit").addEventListener("click", async () => {
      const msg = $("mypub-modal-msg");
      const btn = $("mypub-submit");
      const title = $("mp-title").value.trim();
      if (!title) { msg.textContent = "제목을 입력해 주세요."; msg.className = "form-msg error"; return; }

      const authors = $("mp-authors").value.trim();
      const venue = $("mp-venue").value.trim();
      const volume = $("mp-volume").value.trim();
      let link = $("mp-link").value.trim();
      if (link && !/^https?:\/\//i.test(link)) link = "https://" + link;

      btn.disabled = true;
      try {
        let file = null;
        const f = $("mp-file").files[0];
        if (f) {
          btn.textContent = "파일 업로드 중…";
          file = await uploadStoredFile(db, "pubFiles", me.uid, f);
        }
        btn.textContent = "등록 중…";
        await addDoc(collection(db, "publications"), {
          type: $("mp-type").value,
          title,
          authors,
          venue,
          volume,
          link,
          file,
          // 기존 화면 호환용 서지정보 문자열 (저자 · 게재지 · 권호페이지)
          meta: [authors, venue, volume].filter(Boolean).join(" · "),
          year: $("mp-year").value.trim() || String(new Date().getFullYear()),
          visible: false,
          status: "pending",
          createdByUid: me.uid,
          createdByName: me.name,
          memberUids: [me.uid],
          createdAt: serverTimestamp(),
        });
        modal.classList.remove("open");
      } catch (err) {
        msg.textContent = "등록 실패: " + err.message;
        msg.className = "form-msg error";
      } finally {
        btn.disabled = false;
        btn.textContent = "검수 요청";
      }
    });
  }


  // ================= 연구 참가 신청·문의 (프로젝트 리더용) =================
  function initMyInquiries(me) {
    const secEl = $("my-inquiries-section");
    const box = $("my-inquiries");
    if (!secEl || !box) return;

    // 표시 여부를 사이드바의 "신청·문의" 버튼과 함께 토글합니다.
    // (아래 코드는 section.style.display 만 조작하므로 여기서 한 번에 연동)
    const section = {
      style: {
        get display() { return secEl.style.display; },
        set display(v) {
          secEl.style.display = v;
          const b = document.querySelector('.admin-nav button[data-panel="inquiries"]');
          if (b) b.style.display = v === "none" ? "none" : "";
        },
      },
    };

    const fmtDT = (ts) => {
      if (!ts || !ts.toDate) return "";
      const d = ts.toDate();
      const p = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    };

    const badge = $("my-inq-count");
    const updateBadge = (byProject) => {
      if (!badge) return;
      const total = Object.values(byProject).reduce((n, arr) => n + arr.length, 0);
      badge.textContent = total || "";
      badge.style.display = total ? "" : "none";
    };

    // 관리자: 전체 프로젝트의 문의를 한 번에 구독
    if (me.role === "admin") {
      onSnapshot(collection(db, "projectInquiries"), (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        section.style.display = "";
        const byProject = {};
        items.forEach((q) => { (byProject[q.projectId] = byProject[q.projectId] || []).push(q); });
        updateBadge(byProject);
        if (!items.length) {
          box.innerHTML = '<p style="color:var(--muted); font-size:0.9rem;">접수된 신청·문의가 없습니다.</p>';
          return;
        }
        box.innerHTML = Object.entries(byProject).map(([pid, list]) => `
          <div style="margin-bottom:22px;">
            <div style="font-size:0.9rem; font-weight:700; margin-bottom:8px;">
              <a href="project.html?id=${pid}" style="color:var(--ink);">${esc(list[0].projectTitle || "프로젝트")}</a>
              <span class="status pending" style="margin-left:8px;">${list.length}건</span>
            </div>
            <div class="board-list">${list.map((q) => `
              <div class="board-item">
                <div class="b-row static">
                  <span class="b-title">${esc(q.name)} <small style="font-weight:500; color:var(--muted);">${esc(q.contact)}</small></span>
                  <span class="b-meta">${fmtDT(q.createdAt)}
                    <button class="btn-sm danger" data-inq-del="${q.id}" style="margin-left:8px;">삭제</button></span>
                </div>
                ${q.message ? `<div class="b-detail"><div class="b-body">${esc(q.message)}</div></div>` : ""}
              </div>`).join("")}</div>
          </div>`).join("");
        box.querySelectorAll("button[data-inq-del]").forEach((btn) => {
          btn.addEventListener("click", async () => {
            if (!confirm("이 신청·문의를 삭제할까요?")) return;
            try { await deleteDoc(doc(db, "projectInquiries", btn.dataset.inqDel)); }
            catch (err) { alert("삭제 실패: " + err.message); }
          });
        });
      }, () => { section.style.display = "none"; });
      return;
    }

    // 내가 리더인 프로젝트 구독 → 각 프로젝트의 문의 구독
    let inqUnsubs = [];
    onSnapshot(query(collection(db, "projects"), where("leaderUids", "array-contains", me.uid)), (snap) => {
      inqUnsubs.forEach((u) => u());
      inqUnsubs = [];
      const projects = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (!projects.length) { section.style.display = "none"; return; }
      section.style.display = "";

      const byProject = {};
      const renderAll = () => {
        updateBadge(byProject);
        const blocks = projects.map((p) => {
          const items = byProject[p.id] || [];
          const rows = items.length ? items.map((q) => `
            <div class="board-item">
              <div class="b-row static">
                <span class="b-title">${esc(q.name)} <small style="font-weight:500; color:var(--muted);">${esc(q.contact)}</small></span>
                <span class="b-meta">${fmtDT(q.createdAt)}
                  <button class="btn-sm danger" data-inq-del="${q.id}" style="margin-left:8px;">삭제</button></span>
              </div>
              ${q.message ? `<div class="b-detail"><div class="b-body">${esc(q.message)}</div></div>` : ""}
            </div>`).join("")
            : '<p style="color:var(--muted); font-size:0.86rem; padding:8px 4px;">접수된 신청·문의가 없습니다.</p>';
          return `<div style="margin-bottom:22px;">
            <div style="font-size:0.9rem; font-weight:700; margin-bottom:8px;">
              <a href="project.html?id=${p.id}" style="color:var(--ink);">${esc(p.title)}</a>
              ${items.length ? `<span class="status pending" style="margin-left:8px;">${items.length}건</span>` : ""}
            </div>
            <div class="board-list">${rows}</div>
          </div>`;
        }).join("");
        box.innerHTML = blocks;
        box.querySelectorAll("button[data-inq-del]").forEach((btn) => {
          btn.addEventListener("click", async () => {
            if (!confirm("이 신청·문의를 삭제할까요?")) return;
            try { await deleteDoc(doc(db, "projectInquiries", btn.dataset.inqDel)); }
            catch (err) { alert("삭제 실패: " + err.message); }
          });
        });
      };

      projects.forEach((p) => {
        const un = onSnapshot(query(collection(db, "projectInquiries"), where("projectId", "==", p.id)), (isnap) => {
          byProject[p.id] = isnap.docs.map((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
          renderAll();
        }, () => { byProject[p.id] = []; renderAll(); });
        inqUnsubs.push(un);
      });
      renderAll();
    }, () => { section.style.display = "none"; });
  }

  // ================= 내 스터디 =================
  function initMyStudies(me) {
    const list = $("my-study-list");
    if (!list) return;

    const STATUS_LABEL = { recruiting: "모집 중", active: "운영 중", ended: "종료" };
    const STATUS_CLS = { recruiting: "pending", active: "approved", ended: "member" };

    const MODE_LABEL = { online: "온라인", offline: "오프라인", hybrid: "온·오프라인" };
    // 연도: 개설일 → 시작일 → 가입 시각 순으로 판정
    const yearOf = (s) =>
      (s.openedDate || s.startDate || "").slice(0, 4)
      || (s.createdAt?.toDate ? String(s.createdAt.toDate().getFullYear()) : "");

    onSnapshot(query(collection(db, "studies"), where("participantsUids", "array-contains", me.uid)), (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) =>
          (yearOf(b) || "0").localeCompare(yearOf(a) || "0")
          || (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      if (!items.length) {
        list.innerHTML = '<div class="pub-item"><div></div><div class="pub-meta">참여 중인 스터디가 없습니다. 스터디 페이지에서 참여해 보세요.</div></div>';
        return;
      }
      list.innerHTML = items.map((s) => {
        const meta = [
          s.schedule,
          s.mode && MODE_LABEL[s.mode],
          "리더 " + s.leaderName,
          "참여 " + (s.participantsUids || []).length + "명",
        ].filter(Boolean).map(esc).join(" · ");
        return `
        <a href="study-detail.html?id=${s.id}" class="pub-item" style="text-decoration:none;">
          <div class="pub-year">${esc(yearOf(s))}</div>
          <div>
            <span class="status ${STATUS_CLS[s.status] || "member"}" style="margin-bottom:6px; display:inline-block;">${STATUS_LABEL[s.status] || esc(s.status)}</span>
            <div class="pub-title">${esc(s.title)}</div>
            <div class="pub-meta">${meta}</div>
          </div>
        </a>`;
      }).join("");
    }, (err) => {
      list.innerHTML = `<div class="pub-item"><div></div><div class="pub-meta" style="color:var(--danger);">불러오기 실패: ${esc(err.code || err.message)}</div></div>`;
    });
  }

  // ================= 연구실 프로젝트 =================
  function initProjects(me) {
    const list = $("member-project-list");
    if (!list) return;

    onSnapshot(collection(db, "projects"), (snap) => {
      const projects = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      if (!projects.length) {
        list.innerHTML = '<div class="pub-item"><div></div><div class="pub-meta">등록된 프로젝트가 없습니다.</div></div>';
        return;
      }
      list.innerHTML = projects.map((p) => {
        const n = (p.participantsUids || []).length;
        const joined = (p.participantsUids || []).includes(me.uid);
        return `
        <a href="project.html?id=${p.id}" class="pub-item" style="cursor:pointer; text-decoration:none;">
          <div class="pub-year">${esc(((p.period || "").match(/\d{4}/) || [""])[0])}</div>
          <div>
            <span class="pub-type">${esc(p.status)}</span>${joined ? ' <span class="status approved" style="margin-left:6px;">참여 중</span>' : ""}
            <div class="pub-title">${esc(p.title)}${p.public === false ? ' <span class="pub-meta">(내부)</span>' : ""}</div>
            <div class="pub-meta">${esc([p.period, p.meta].filter(Boolean).join(" · "))}${n ? " · 참여 " + n + "명" : ""}</div>
          </div>
        </a>`;
      }).join("");
    }, (err) => {
      list.innerHTML = `<div class="pub-item"><div></div><div class="pub-meta" style="color:var(--danger);">불러오기 실패: ${esc(err.code || err.message)}</div></div>`;
    });
  }
}
