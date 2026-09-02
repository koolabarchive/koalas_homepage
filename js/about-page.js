// 연구실 소개 페이지 (about.html) — 관리자가 페이지에서 바로 수정합니다.
// - 소개 문단: 제목 옆 연필 버튼 → sec-modal
// - 찾아오시는 길: 버튼 하나(#btn-edit-visit) → visit-modal에서
//   지도(장소 검색어 또는 구글 지도 링크)·주소·대중교통·연락처를 한 번에 수정
// 저장 위치: siteConfig/main 문서의 aboutPage 객체
//   { intro, mapQuery, address, transit, contact }
// 값이 없는 필드는 아래 DEFAULTS(현재 게시 내용)로 표시됩니다.

import { auth, db, isConfigured } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { renderMarkdown } from "./markdown-lite.js";
import { createDropdown } from "./notice-ui.js";

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
    mapQuery: "한신대학교",
    // 네이버 지도: Client ID가 등록되면 구글 대신 표시 (좌표는 한신대 오산캠퍼스)
    mapProvider: "google",      // 'google' | 'naver'
    naverClientId: "",
    naverLat: "37.1948",
    naverLng: "127.0258",
    naverLabel: "한신대학교 심리학과",
  };

  const SECTIONS = {
    intro: "연구실 소개",
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

  // ---------- 네이버 지도 ----------
  // Maps API 스크립트는 Client ID가 있을 때만 동적으로 불러옵니다.
  // 키가 잘못됐거나 도메인 미등록으로 인증에 실패하면 구글 지도로 되돌립니다.
  let naverScript = null;      // { id, promise }
  let naverMap = null;
  let naverMarker = null;

  function loadNaverMaps(clientId) {
    if (naverScript && naverScript.id === clientId) return naverScript.promise;
    const promise = new Promise((resolve, reject) => {
      // 인증 실패 콜백 (네이버 API가 전역 함수를 호출합니다)
      window.navermap_authFailure = () => reject(new Error("auth"));
      const sc = document.createElement("script");
      sc.src = "https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=" + encodeURIComponent(clientId);
      sc.async = true;
      sc.onload = () => (window.naver && window.naver.maps ? resolve() : reject(new Error("load")));
      sc.onerror = () => reject(new Error("load"));
      document.head.appendChild(sc);
    });
    naverScript = { id: clientId, promise };
    return promise;
  }

  function showGoogleMap() {
    const map = $("ab-map");
    const nv = $("ab-map-naver");
    if (nv) nv.style.display = "none";
    if (!map) return;
    map.style.display = "";
    if (lastMapSrc === null) lastMapSrc = map.getAttribute("src");
    const src = mapSrc(val("mapQuery"));
    // src가 같으면 다시 지정하지 않아 iframe 재로딩 깜빡임을 막습니다
    if (src !== lastMapSrc) { map.src = src; lastMapSrc = src; }
  }

  async function showNaverMap() {
    const map = $("ab-map");
    const nv = $("ab-map-naver");
    const note = $("ab-map-note");
    const lat = parseFloat(val("naverLat"));
    const lng = parseFloat(val("naverLng"));
    if (!nv || isNaN(lat) || isNaN(lng)) return showGoogleMap();
    try {
      await loadNaverMaps(val("naverClientId"));
      if (map) map.style.display = "none";
      nv.style.display = "";
      if (note) note.style.display = "none";
      const pos = new naver.maps.LatLng(lat, lng);
      if (!naverMap) {
        naverMap = new naver.maps.Map(nv, { center: pos, zoom: 16, mapTypeControl: false });
        naverMarker = new naver.maps.Marker({ position: pos, map: naverMap, title: val("naverLabel") });
      } else {
        naverMap.setCenter(pos);
        naverMarker.setPosition(pos);
        naverMarker.setTitle(val("naverLabel"));
      }
    } catch (err) {
      // 키 오류·도메인 미등록·네트워크 실패 → 구글 지도로 폴백하고 관리자에게만 안내
      showGoogleMap();
      if (note && isAdmin) {
        note.style.display = "";
        note.textContent = err.message === "auth"
          ? "네이버 지도 인증에 실패해 구글 지도로 표시 중입니다. Client ID와 네이버 클라우드 플랫폼의 Web 서비스 URL 등록을 확인해 주세요."
          : "네이버 지도를 불러오지 못해 구글 지도로 표시 중입니다.";
      }
    }
  }

  function renderMap() {
    if (val("mapProvider") === "naver" && val("naverClientId")) showNaverMap();
    else showGoogleMap();
  }

  function renderAll() {
    ["intro", "address", "transit", "contact"].forEach((key) => {
      const box = $("ab-" + key);
      if (box) box.innerHTML = iconize(renderMarkdown(val(key)));
    });
    renderMap();

    document.querySelectorAll(".sec-edit").forEach((b) => (b.style.display = isAdmin ? "" : "none"));
    $("btn-edit-visit").style.display = isAdmin ? "" : "none";
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

  // ================= 찾아오시는 길 수정 (지도·주소·교통·연락처 한 번에) =================
  const visitModal = $("visit-modal");
  const PROVIDER_LABEL = { google: "구글 지도", naver: "네이버 지도" };
  const providerKey = (label) => (label === PROVIDER_LABEL.naver ? "naver" : "google");
  const syncProviderFields = () => {
    const isNaver = providerKey($("vm-provider").value) === "naver";
    $("vm-google-fields").style.display = isNaver ? "none" : "";
    $("vm-naver-fields").style.display = isNaver ? "" : "none";
  };
  const providerDd = createDropdown($("vm-provider-dd"), {
    values: [PROVIDER_LABEL.google, PROVIDER_LABEL.naver],
    allowEmpty: false,
    onChange: (v) => { $("vm-provider").value = v; syncProviderFields(); },
  });

  $("btn-edit-visit").addEventListener("click", () => {
    const provLabel = PROVIDER_LABEL[val("mapProvider")] || PROVIDER_LABEL.google;
    providerDd.set(provLabel);
    $("vm-provider").value = provLabel;
    $("vm-naver-id").value = val("naverClientId");
    $("vm-naver-lat").value = val("naverLat");
    $("vm-naver-lng").value = val("naverLng");
    $("vm-naver-label").value = val("naverLabel");
    syncProviderFields();
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
      mapProvider: providerKey($("vm-provider").value),
      mapQuery: $("vm-map").value.trim(),
      naverClientId: $("vm-naver-id").value.trim(),
      naverLat: $("vm-naver-lat").value.trim(),
      naverLng: $("vm-naver-lng").value.trim(),
      naverLabel: $("vm-naver-label").value.trim(),
      address: $("vm-address").value,
      transit: $("vm-transit").value,
      contact: $("vm-contact").value,
    };
    if (partial.mapProvider === "naver"
        && (isNaN(parseFloat(partial.naverLat)) || isNaN(parseFloat(partial.naverLng)))) {
      $("vm-msg").textContent = "네이버 지도를 쓰려면 위도·경도를 숫자로 입력해 주세요.";
      $("vm-msg").className = "form-msg error";
      return;
    }
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
