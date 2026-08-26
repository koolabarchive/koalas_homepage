// 연구실 소개 페이지 (about.html) — 소개 문단·주소·대중교통·연락처를
// 관리자가 페이지에서 바로 수정합니다 (지도교수 페이지와 같은 방식).
// 저장 위치: siteConfig/main 문서의 aboutPage 객체 { intro, address, transit, contact }
// 값이 없는 필드는 아래 DEFAULTS(현재 게시 내용)로 표시됩니다.

import { auth, db, isConfigured } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { renderMarkdown } from "./markdown-lite.js";

if (isConfigured) {
  const $ = (id) => document.getElementById(id);

  const DEFAULTS = {
    intro: `한신대학교 심리아동학부 심리학전공은 인간의 마음과 행동을 과학적으로 탐구하고, 이를 바탕으로 개인과 공동체의 심리적 안녕에 기여하는 전문가를 양성합니다. 학부 과정과 함께 일반대학원 심리학과(임상 및 상담심리 전공), 정신분석대학원, 교육대학원 과정을 통해 이론과 실무를 아우르는 교육을 제공합니다.

임상심리 연구실은 인지행동치료와 트라우마 연구를 기반으로, AI 시대의 심리상담 교육과 실천을 탐구합니다. 정서장애의 심리적 기제 규명부터 근거기반 개입의 개발과 검증, LLM 기반 상담자 훈련 플랫폼 연구까지 — 과학자-실무자 모델(scientist-practitioner model)에 따라 연구와 임상 현장을 잇는 작업을 이어가고 있습니다.`,
    address: `경기도 오산시 한신대길 137
한신대학교 심리학과
[카카오맵에서 보기 ↗](https://map.kakao.com/?q=한신대학교) · [네이버지도에서 보기 ↗](https://map.naver.com/p/search/한신대학교)`,
    transit: `지하철 1호선 **병점역** 하차 후 셔틀버스 또는 버스 환승
지하철 1호선 **오산대역**에서 버스 이용 가능`,
    contact: `📧 hoonjungkoo@gmail.com
연구 참가 문의는 각 [프로젝트 페이지](research.html)의 신청 폼을 이용해 주세요.`,
  };

  const SECTIONS = {
    intro: "연구실 소개",
    address: "주소",
    transit: "대중교통",
    contact: "연락처",
  };

  let about = {};      // 저장된 값 (없으면 DEFAULTS로 폴백)
  let isAdmin = false;
  let editingSec = null;

  const val = (key) => {
    const v = (about[key] ?? "");
    return v !== "" ? v : DEFAULTS[key];
  };

  // 이모지(📧 ☎ 🏢)를 SVG 아이콘으로 치환 (지도교수 페이지와 동일한 규칙)
  const IC = (paths) => `<svg class="ic-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const ICONS = {
    mail: IC('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>'),
    phone: IC('<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.08 5.18 2 2 0 0 1 4.06 3h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 10.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z"/>'),
    building: IC('<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M10 21v-3.5h4V21"/><path d="M9 7h.01M12 7h.01M15 7h.01M9 10.5h.01M12 10.5h.01M15 10.5h.01M9 14h.01M12 14h.01M15 14h.01"/>'),
  };
  const iconize = (html) => html
    .replace(/📧|✉️|✉/g, ICONS.mail)
    .replace(/☎️|☎|📞/g, ICONS.phone)
    .replace(/🏢|🏫/g, ICONS.building);

  function renderAll() {
    Object.keys(SECTIONS).forEach((key) => {
      const box = $("ab-" + key);
      if (box) box.innerHTML = iconize(renderMarkdown(val(key)));
    });
    document.querySelectorAll(".sec-edit").forEach((b) => (b.style.display = isAdmin ? "" : "none"));
  }

  async function load() {
    try {
      const snap = await getDoc(doc(db, "siteConfig", "main"));
      about = (snap.exists() && snap.data().aboutPage) || {};
    } catch (_) { about = {}; }
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
  });

  // ================= 섹션 수정 모달 =================
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
      await setDoc(doc(db, "siteConfig", "main"), { aboutPage: { [editingSec]: $("sec-md").value } }, { merge: true });
      about = { ...about, [editingSec]: $("sec-md").value };
      secModal.classList.remove("open");
      renderAll();
    } catch (err) {
      $("sec-msg").textContent = "저장 실패: " + err.message;
      $("sec-msg").className = "form-msg error";
    }
  });
}
