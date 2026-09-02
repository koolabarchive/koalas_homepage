// 연구실 소개 페이지 (about.html) — 관리자가 페이지에서 바로 수정합니다.
// - 소개 문단: 제목 옆 연필 버튼 → sec-modal
// - 찾아오시는 길: 버튼 하나(#btn-edit-visit) → visit-modal에서
//   지도(장소 검색어 또는 구글 지도 링크)·주소·대중교통·연락처를 한 번에 수정
// 저장 위치: siteConfig/main 문서의 aboutPage 객체
//   { intro, mapQuery, address, transit, contact }
// 값이 없는 필드는 아래 DEFAULTS(현재 게시 내용)로 표시됩니다.

import { auth, db, isConfigured } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, setDoc, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { renderMarkdown } from "./markdown-lite.js";
import { createDropdown } from "./notice-ui.js";

if (isConfigured) {
  const $ = (id) => document.getElementById(id);
  const esc = (t) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

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
    mapQuery: "한신대학교",
    galleryPageId: "",          // 미리보기로 쓸 앨범 페이지 id (비우면 첫 앨범 자동)
    galleryDesc: "함께한 순간들을 사진으로 모아 봅니다.",
  };

  const SECTIONS = {
    intro: "연구실 소개",
  };

  let about = {};      // 저장된 값 (없으면 DEFAULTS로 폴백)
  let pages = [];      // 관리자가 만든 커스텀 페이지 목록 (앨범 찾기용)
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

  // 지도: 장소 이름·주소는 구글 지도 검색 임베드로, 구글 지도 링크는 그대로
  // (https 구글 지도 주소만 허용해 임의 사이트 임베드를 막습니다)
  function mapSrc(v) {
    v = (v || "").trim() || DEFAULTS.mapQuery;
    if (/^https:\/\/(www\.)?google\.[a-z.]{2,10}\/maps/.test(v)) {
      return v.includes("output=embed") ? v : v + (v.includes("?") ? "&" : "?") + "output=embed";
    }
    return "https://www.google.com/maps?q=" + encodeURIComponent(v) + "&output=embed";
  }

  let lastMapSrc = null;
  function renderAll() {
    ["intro", "address", "transit", "contact"].forEach((key) => {
      const box = $("ab-" + key);
      if (box) box.innerHTML = iconize(renderMarkdown(val(key)));
    });
    // src가 같으면 다시 지정하지 않아 iframe 재로딩 깜빡임을 막습니다
    const map = $("ab-map");
    if (map) {
      if (lastMapSrc === null) lastMapSrc = map.getAttribute("src");
      const src = mapSrc(val("mapQuery"));
      if (src !== lastMapSrc) { map.src = src; lastMapSrc = src; }
    }

    document.querySelectorAll(".sec-edit").forEach((b) => (b.style.display = isAdmin ? "" : "none"));
    $("btn-edit-visit").style.display = isAdmin ? "" : "none";
  }

  async function load() {
    try {
      const snap = await getDoc(doc(db, "siteConfig", "main"));
      const data = snap.exists() ? snap.data() : {};
      about = data.aboutPage || {};
      pages = Array.isArray(data.pages) ? data.pages : [];
    } catch (_) { about = {}; pages = []; }
    renderAll();
    renderGallery();
  }
  load();

  // ================= 연구실 사진 미리보기 =================
  // 앨범형 커스텀 페이지(page.html?p=<id>)의 공개 사진 중 최근 6장을 보여 주고
  // 전체 보기로 연결합니다. 앨범이 없으면 방문자에게는 섹션을 숨기고
  // 관리자에게만 만드는 방법을 안내합니다.
  const GALLERY_COUNT = 6;
  const albumPages = () => pages.filter((p) => p.kind === "album");
  const galleryPage = () => {
    const id = val("galleryPageId");
    return albumPages().find((p) => p.id === id) || albumPages()[0] || null;
  };

  async function renderGallery() {
    const sec = $("ab-gallery-sec");
    const grid = $("ab-gallery");
    if (!sec || !grid) return;
    const page = galleryPage();
    $("ab-gallery-desc").textContent = val("galleryDesc");
    $("btn-edit-gallery").style.display = isAdmin ? "" : "none";

    if (!page) {
      // 앨범이 없음: 관리자에게만 안내
      sec.style.display = isAdmin ? "" : "none";
      $("ab-gallery-link").style.display = "none";
      grid.innerHTML = '<p class="chart-empty">아직 앨범 페이지가 없습니다. 관리자 → 메뉴 관리 → "새 페이지 만들기"에서 <strong>앨범</strong> 형태의 페이지를 만들고 사진을 올리면 이곳에 미리보기가 표시됩니다.</p>';
      return;
    }

    const href = "page.html?p=" + encodeURIComponent(page.id);
    const link = $("ab-gallery-link");
    link.href = href;
    link.style.display = "";

    let photos = [];
    try {
      const snap = await getDocs(query(collection(db, "posts"),
        where("pageId", "==", page.id), where("scope", "==", "public")));
      photos = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .filter((p) => p.imageData)
        .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
        .slice(0, GALLERY_COUNT);
    } catch (_) {}

    if (!photos.length) {
      sec.style.display = isAdmin ? "" : "none";
      grid.innerHTML = `<p class="chart-empty">"${esc(page.title)}" 앨범에 아직 공개 사진이 없습니다. <a href="${href}">앨범 페이지</a>에서 사진을 올려 주세요.</p>`;
      return;
    }
    sec.style.display = "";
    grid.innerHTML = photos.map((p) => `
      <a class="gallery-thumb" href="${href}" title="${esc(p.title || page.title)}">
        <img src="${p.imageData}" alt="${esc(p.title || page.title)}" loading="lazy" />
      </a>`).join("");
  }

  // ----- 미리보기 설정 모달 -----
  const galleryModal = $("gallery-modal");
  const gmDd = createDropdown($("gm-album-dd"), {
    values: [], allowEmpty: false,
    onChange: (v) => { $("gm-album").value = v; },
  });
  $("btn-edit-gallery").addEventListener("click", () => {
    const albums = albumPages();
    const labels = albums.map((p) => p.title);
    gmDd.setOptions(labels.length ? labels : ["앨범 페이지 없음"]);
    const cur = galleryPage();
    gmDd.set(cur ? cur.title : (labels[0] || "앨범 페이지 없음"));
    $("gm-album").value = cur ? cur.title : "";
    $("gm-desc").value = val("galleryDesc");
    $("gm-msg").className = "form-msg";
    galleryModal.classList.add("open");
  });
  $("gm-cancel").addEventListener("click", () => galleryModal.classList.remove("open"));
  galleryModal.addEventListener("click", (e) => { if (e.target === galleryModal) galleryModal.classList.remove("open"); });
  $("gm-save").addEventListener("click", async () => {
    const chosen = albumPages().find((p) => p.title === $("gm-album").value);
    const partial = {
      galleryPageId: chosen ? chosen.id : "",
      galleryDesc: $("gm-desc").value.trim(),
    };
    try {
      await setDoc(doc(db, "siteConfig", "main"), { aboutPage: partial }, { merge: true });
      about = { ...about, ...partial };
      galleryModal.classList.remove("open");
      renderGallery();
    } catch (err) {
      $("gm-msg").textContent = "저장 실패: " + err.message;
      $("gm-msg").className = "form-msg error";
    }
  });

  onAuthStateChanged(auth, async (user) => {
    isAdmin = false;
    if (user) {
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        isAdmin = snap.exists() && snap.data().role === "admin";
      } catch (_) {}
    }
    renderAll();
    renderGallery();
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

  // ================= 찾아오시는 길 수정 (지도·주소·교통·연락처 한 번에) =================
  const visitModal = $("visit-modal");
  $("btn-edit-visit").addEventListener("click", () => {
    $("vm-map").value = val("mapQuery");
    $("vm-address").value = val("address");
    $("vm-transit").value = val("transit");
    $("vm-contact").value = val("contact");
    $("vm-msg").className = "form-msg";
    visitModal.classList.add("open");
  });
  $("vm-cancel").addEventListener("click", () => visitModal.classList.remove("open"));
  visitModal.addEventListener("click", (e) => { if (e.target === visitModal) visitModal.classList.remove("open"); });
  $("vm-save").addEventListener("click", async () => {
    const partial = {
      mapQuery: $("vm-map").value.trim(),
      address: $("vm-address").value,
      transit: $("vm-transit").value,
      contact: $("vm-contact").value,
    };
    try {
      await setDoc(doc(db, "siteConfig", "main"), { aboutPage: partial }, { merge: true });
      about = { ...about, ...partial };
      visitModal.classList.remove("open");
      renderAll();
    } catch (err) {
      $("vm-msg").textContent = "저장 실패: " + err.message;
      $("vm-msg").className = "form-msg error";
    }
  });
}
