// 지도교수 페이지 (professor.html)
// - 프로필·CV: 관리자(교수)가 직접 수정. 저장 위치는 siteConfig/main 문서의
//   professor 객체 { name, nameEn, titleLine, contactLine, intro, photoData,
//   education, licensure, career, awards, books } (필드별 병합 저장, 마크다운 텍스트)
//   값이 없는 필드는 아래 DEFAULTS(현재 게시 내용)로 표시됩니다.
// - 컨택 폼: 대학원 진학 희망 학생의 문의를 profInquiries 컬렉션에 저장
//   (비로그인 방문자도 작성 가능, 열람·삭제는 관리자만 — firestore.rules 참고)
// - 관리자 로그인 시 접수된 문의함이 페이지 하단에 표시됩니다.

import { auth, db, isConfigured } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, doc, addDoc, getDoc, setDoc, deleteDoc, onSnapshot, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { renderMarkdown } from "./markdown-lite.js";

if (isConfigured) {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const DEFAULTS = {
    name: "구훈정",
    nameEn: "Koo Hoon Jung, Ph.D.",
    titleLine: "한신대학교 심리학과 교수 · 정신분석대학원장 · 한신임상심리연구센터장",
    contactLine: "📧 hoonjungkoo@gmail.com · ☎ 031-379-0746 · 🏢 한신대학교 소통관 3층 8318호",
    intro: "인지행동치료와 트라우마·스트레스 관련 장애를 중심으로 정서장애의 심리적 기제와 근거기반 개입을 연구하며, 최근에는 AI 기반 상담 시뮬레이션과 심리서비스 윤리, 마음챙김 기반 개입으로 연구 영역을 확장하고 있습니다.",
    photoData: "",
    education: `- 고려대학교 문과대학 심리학과 학사 (1995–2000)
- 고려대학교 심리학과 석사 — 임상 및 상담심리 전공 (2000–2002)
- 고려대학교 심리학과 박사 — 임상 및 상담심리 전공 (2010–2013)`,
    licensure: `- 임상심리전문가 (한국임상심리학회, No. 458)
- 상담심리사 1급·상담심리전문가 (한국상담심리학회, No. 910)
- 정신보건임상심리사 2급 (보건복지부, No. 630)`,
    career: `- 한신대학교 심리·아동학부 교수 (2015.9–현재)
- 한신대학교 정신분석대학원장 (2019.8–현재)
- 한신대학교 한신임상심리연구센터장 (2018.3–현재)
- 고려대학교 BK21Plus 융합심리학사업단 연구교수 (2015)
- 고려대학교 부부상담연구소 연구교수 (2013–2014)
- 서울대학교 어린이병원 소아정신과 임상심리전문가 (2008–2010)
- 서울대학교 어린이병원·분당서울대학교병원 임상심리전문가 수련 (2005–2007)`,
    awards: "",
    books: `- 권정혜, 구훈정 (2020). *SCI-IGD: 인터넷 게임장애 진단을 위한 구조적 임상면담*. 학지사.
- 구훈정 (2016). *양극성장애 자녀 양육하기*. 시그마프레스.
- 구훈정 (2015). *공격적 아동을 위한 학교폭력 치유 프로그램 (피해·가해 아동용)*. 시그마프레스.
- 김붕년, 구훈정, 최상철 (2015). *초등학생을 위한 학교폭력 치유 프로그램 (피해자·가해자용)*. 시그마프레스.
- 신민섭, 구훈정, 김수경 (2008). *레이-오스테리스 복합 도형 검사 한국판 발달적 채점 체계*. 마인드프레스.
- 신민섭, 구훈정 (2007). *한국판 아동용 선 색로검사: 전문가용 지침서*. 학지사.`,
  };

  const SECTIONS = {
    education: "학력",
    licensure: "자격",
    career: "주요 경력",
    awards: "수상",
    books: "저서",
  };

  let prof = {};       // 저장된 값 (없으면 DEFAULTS로 폴백)
  let isAdmin = false;
  let editingSec = null;
  let photoDataNew = null;   // 프로필 모달에서 새로 고른 사진 (null=변경 없음, ""=삭제)

  const val = (key) => {
    const v = (prof[key] ?? "");
    return v !== "" ? v : DEFAULTS[key];
  };

  // 연락처 줄의 이모지(📧 ☎ 🏢)를 SVG 아이콘으로 치환해 렌더링합니다.
  // 관리자는 입력칸에 이모지를 그대로 쓰면 되고, 화면에는 아이콘으로 보입니다.
  const IC = (paths) => `<svg class="ic-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const ICONS = {
    mail: IC('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>'),
    phone: IC('<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.08 5.18 2 2 0 0 1 4.06 3h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 10.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z"/>'),
    building: IC('<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M10 21v-3.5h4V21"/><path d="M9 7h.01M12 7h.01M15 7h.01M9 10.5h.01M12 10.5h.01M15 10.5h.01M9 14h.01M12 14h.01M15 14h.01"/>'),
  };
  const iconize = (escapedText) => escapedText
    .replace(/📧|✉️|✉/g, ICONS.mail)
    .replace(/☎️|☎|📞/g, ICONS.phone)
    .replace(/🏢|🏫/g, ICONS.building);

  // ================= 렌더링 =================
  function renderAll() {
    // 프로필
    $("prof-profile").innerHTML = `
      <h3 style="font-size:1.15rem; margin-bottom:4px;">${esc(val("name"))} <small style="font-weight:500; color:var(--muted);">${esc(val("nameEn"))}</small></h3>
      <p class="study-meta" style="margin-bottom:6px;">${esc(val("titleLine"))}</p>
      <p class="study-meta contact-line" style="margin-bottom:16px;">${iconize(esc(val("contactLine")))}</p>
      <div class="md-body" style="font-size:0.92rem;">${renderMarkdown(val("intro"))}</div>`;

    // 사진
    const photoBox = $("prof-photo");
    const photo = prof.photoData || "";
    photoBox.innerHTML = photo
      ? `<img src="${photo}" alt="${esc(val("name"))} 교수" />`
      : '<div class="prof-photo-placeholder">사진</div>';

    // 마크다운 섹션들
    Object.keys(SECTIONS).forEach((key) => {
      const box = $("sec-" + key);
      const content = val(key);
      box.innerHTML = content ? renderMarkdown(content) : "";
    });
    // 수상: 내용 없으면 방문자에게 숨김, 관리자에게는 안내
    const awardsEmpty = !val("awards").trim();
    if (awardsEmpty && !isAdmin) $("wrap-awards").style.display = "none";
    else {
      $("wrap-awards").style.display = "";
      if (awardsEmpty) $("sec-awards").innerHTML = '<p style="color:var(--muted);">아직 등록된 수상 내역이 없습니다. 수정 버튼으로 추가해 주세요.</p>';
    }

    // 수정 버튼 표시
    document.querySelectorAll(".sec-edit").forEach((b) => (b.style.display = isAdmin ? "" : "none"));
    $("btn-edit-profile").style.display = isAdmin ? "" : "none";
  }

  async function load() {
    try {
      const snap = await getDoc(doc(db, "siteConfig", "main"));
      const data = snap.exists() ? snap.data() : {};
      prof = data.professor || {};
      // 이전 버전(profAwards 필드)에서 이관
      if (!prof.awards && data.profAwards) prof.awards = data.profAwards;
    } catch (_) { prof = {}; }
    renderAll();
  }
  load();

  onAuthStateChanged(auth, async (user) => {
    isAdmin = false;
    if (user) {
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        isAdmin = snap.exists() && snap.data().role === "admin";
      } catch (_) {}
    }
    renderAll();
    syncInbox();
  });

  async function saveProf(partial) {
    await setDoc(doc(db, "siteConfig", "main"), { professor: partial }, { merge: true });
    prof = { ...prof, ...partial };
    renderAll();
  }

  // ================= 섹션 수정 (학력·자격·경력·수상·저서 공용) =================
  const secModal = $("sec-modal");
  document.querySelectorAll(".sec-edit").forEach((btn) => {
    btn.addEventListener("click", () => {
      editingSec = btn.dataset.sec;
      $("sec-modal-title").textContent = SECTIONS[editingSec] + " 수정";
      $("sec-md").value = val(editingSec);
      $("sec-msg").className = "form-msg";
      secModal.classList.add("open");
    });
  });
  $("sec-cancel").addEventListener("click", () => secModal.classList.remove("open"));
  secModal.addEventListener("click", (e) => { if (e.target === secModal) secModal.classList.remove("open"); });
  $("sec-save").addEventListener("click", async () => {
    try {
      await saveProf({ [editingSec]: $("sec-md").value });
      secModal.classList.remove("open");
    } catch (err) {
      $("sec-msg").textContent = "저장 실패: " + err.message;
      $("sec-msg").className = "form-msg error";
    }
  });

  // ================= 프로필 수정 =================
  const profModal = $("prof-modal");

  function renderPhotoPreview() {
    const box = $("pf-photo-preview");
    const current = photoDataNew !== null ? photoDataNew : (prof.photoData || "");
    box.innerHTML = current
      ? `<div class="file-row"><img src="${current}" alt="" style="width:44px; height:54px; object-fit:cover; border-radius:6px;" />
           <span class="f-name">현재 사진</span>
           <button type="button" class="att-remove" id="pf-photo-del" title="사진 삭제">✕</button></div>`
      : '<div class="file-row" style="color:var(--muted);">등록된 사진이 없습니다.</div>';
    const del = $("pf-photo-del");
    if (del) del.addEventListener("click", () => { photoDataNew = ""; renderPhotoPreview(); });
  }

  $("btn-edit-profile").addEventListener("click", () => {
    $("pf-name").value = val("name");
    $("pf-name-en").value = val("nameEn");
    $("pf-title").value = val("titleLine");
    $("pf-contact").value = val("contactLine");
    $("pf-intro").value = val("intro");
    $("pf-photo").value = "";
    photoDataNew = null;
    renderPhotoPreview();
    $("pf-msg").className = "form-msg";
    profModal.classList.add("open");
  });
  $("pf-cancel").addEventListener("click", () => profModal.classList.remove("open"));
  profModal.addEventListener("click", (e) => { if (e.target === profModal) profModal.classList.remove("open"); });

  $("pf-photo").addEventListener("change", () => {
    const file = $("pf-photo").files[0];
    if (!file) return;
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX = 512;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      photoDataNew = canvas.toDataURL("image/jpeg", 0.85);
      renderPhotoPreview();
    };
    img.onerror = () => { URL.revokeObjectURL(url); alert("이미지를 읽을 수 없습니다."); };
    img.src = url;
  });

  $("pf-save").addEventListener("click", async () => {
    const msg = $("pf-msg");
    const partial = {
      name: $("pf-name").value.trim(),
      nameEn: $("pf-name-en").value.trim(),
      titleLine: $("pf-title").value.trim(),
      contactLine: $("pf-contact").value.trim(),
      intro: $("pf-intro").value,
    };
    if (photoDataNew !== null) partial.photoData = photoDataNew;
    try {
      await saveProf(partial);
      profModal.classList.remove("open");
    } catch (err) {
      msg.textContent = "저장 실패: " + err.message;
      msg.className = "form-msg error";
    }
  });

  // ================= 대학원 진학 컨택 폼 (누구나 작성 가능) =================
  const contactForm = $("prof-contact-form");
  if (contactForm) contactForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("pc-msg");
    const btn = $("pc-send");
    const name = $("pc-name").value.trim();
    const contact = $("pc-contact").value.trim();
    const message = $("pc-message").value.trim();
    if (!name || !contact || !message) {
      msg.textContent = "이름·연락처·문의 내용을 모두 입력해 주세요.";
      msg.className = "form-msg error";
      return;
    }
    btn.disabled = true;
    try {
      await addDoc(collection(db, "profInquiries"), {
        name, contact, message,
        createdAt: serverTimestamp(),
      });
      $("pc-name").value = $("pc-contact").value = $("pc-message").value = "";
      msg.textContent = "문의가 접수되었습니다. 확인 후 연락드리겠습니다.";
      msg.className = "form-msg ok";
    } catch (err) {
      msg.textContent = "전송 실패: " + err.message;
      msg.className = "form-msg error";
    } finally {
      btn.disabled = false;
    }
  });

  // ================= 관리자: 접수된 컨택 문의함 =================
  let inboxUnsub = null;

  function syncInbox() {
    const section = $("prof-inbox-section");
    if (!section) return;
    if (!isAdmin) {
      if (inboxUnsub) { inboxUnsub(); inboxUnsub = null; }
      section.style.display = "none";
      return;
    }
    if (inboxUnsub) return; // 이미 구독 중
    inboxUnsub = onSnapshot(collection(db, "profInquiries"), (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      section.style.display = "";
      $("prof-inbox-count").textContent = items.length ? items.length + "건" : "";
      const box = $("prof-inbox");
      if (!items.length) {
        box.innerHTML = '<p style="color:var(--muted); font-size:0.9rem;">아직 접수된 문의가 없습니다.</p>';
        return;
      }
      const fmtDate = (ts) => ts?.seconds
        ? new Date(ts.seconds * 1000).toLocaleDateString("ko-KR") : "";
      box.innerHTML = items.map((q) => `
        <div class="board-item">
          <div class="b-row static">
            <span class="b-title">${esc(q.name)} <small style="font-weight:500; color:var(--muted);">${esc(q.contact)}</small></span>
            <span class="b-meta">${fmtDate(q.createdAt)}
              <button class="btn-sm danger" data-inq-del="${q.id}" style="margin-left:8px;">삭제</button></span>
          </div>
          ${q.message ? `<div class="b-detail"><div class="b-body">${esc(q.message)}</div></div>` : ""}
        </div>`).join("");
      box.querySelectorAll("button[data-inq-del]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!confirm("이 문의를 삭제할까요?")) return;
          try { await deleteDoc(doc(db, "profInquiries", btn.dataset.inqDel)); }
          catch (err) { alert("삭제 실패: " + err.message); }
        });
      });
    }, () => { section.style.display = "none"; });
  }
}
