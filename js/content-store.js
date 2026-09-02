// 사이트 설정 저장소 (siteConfig)
// 현재: 브라우저 localStorage에 저장 (같은 브라우저에서만 유지되는 데모용)
// Firebase 연동 시: 이 파일의 load/save만 Firestore(siteConfig 문서) 읽기/쓰기로
// 교체하면 나머지 코드는 그대로 동작합니다.

(function () {
  const KEY = "labSiteConfig";

  const DEFAULTS = {
    hero: {
      eyebrow: "Clinical Psychology Lab",
      // **텍스트** 는 강조색, 줄바꿈은 그대로 반영됩니다.
      title: "마음의 어려움을 과학으로 이해하고,\n**근거 있는 개입**으로 연결합니다",
      desc: "한신대학교 심리학과 구훈정 교수 연구실은 인지행동치료와 트라우마 연구를 기반으로, AI 시대의 심리상담 교육과 실천을 탐구합니다.",
    },
    // 홈은 별도 항목 없이 브랜드(로고·연구실 이름) 클릭이 담당합니다.
    // 소개는 하위 메뉴(연구실·지도교수·구성원)를 가진 드롭다운입니다.
    nav: [
      { label: "소개", href: "about.html", visible: true },
      { label: "연구", href: "research.html", visible: true },
      { label: "성과", href: "publications.html", visible: true },
      { label: "공지", href: "notice.html", visible: true },
      { label: "자료실", href: "archive.html", visible: true },
    ],
    // 2단계 메뉴 (주메뉴 + 하위메뉴). 관리자 메뉴 관리에서 편집합니다.
    // 이 값이 저장돼 있으면 위의 nav(1단계) 대신 이 구조가 그대로 렌더링됩니다.
    nav2: [
      { label: "소개", href: "about.html", visible: true, children: [
        { label: "연구실 소개", href: "about.html", visible: true },
        { label: "지도교수", href: "professor.html", visible: true },
        { label: "구성원", href: "members.html", visible: true },
        { label: "연구실 사진", href: "gallery.html", visible: true },
      ] },
      { label: "연구", href: "research.html", visible: true, children: [] },
      { label: "성과", href: "publications.html", visible: true, children: [] },
      { label: "공지", href: "notice.html", visible: true, children: [] },
      { label: "자료실", href: "archive.html", visible: true, children: [] },
    ],
    // 관리자가 만든 커스텀 페이지: page.html?p=<id> 로 열립니다.
    // kind: 'board'(게시판) | 'album'(앨범) / scope: 'public' | 'member'
    pages: [],
    loginLabel: "멤버 로그인",
    research: [
      { tag: "CBT", title: "인지행동치료와 정서조절", desc: "우울·불안을 중심으로 인지행동적 기제와 정서조절 과정을 연구하고, 치료 프로토콜의 효과성을 검증합니다." },
      { tag: "Trauma", title: "트라우마와 스트레스 관련 장애", desc: "PTSD, 복합외상, 급성 스트레스 장애, 적응장애의 심리적 기제를 탐구하고 근거기반 개입을 개발합니다." },
      { tag: "AI & Counseling", title: "AI 기반 상담 시뮬레이션", desc: "LLM 기반 가상내담자 플랫폼을 통해 상담자 훈련의 새로운 모델을 설계하고, AI 활용의 윤리적 쟁점을 함께 연구합니다." },
      { tag: "Ethics", title: "심리서비스와 AI 윤리", desc: "심리상담·심리평가 장면에서의 AI 활용이 제기하는 윤리적 쟁점을 분석하고 실무 가이드라인을 제안합니다." },
      { tag: "Mindfulness", title: "마음챙김 기반 개입", desc: "성인 ADHD 등 다양한 대상에 대한 마음챙김 명상 개입의 효과를 검증하고 접근성 높은 전달 방식을 탐구합니다." },
      { tag: "Assessment", title: "심리평가와 진단분류", desc: "DSM·ICD 진단체계와 차원적 모형, 네트워크 정신병리학 관점을 아우르며 심리평가 교육의 개선 방안을 연구합니다." },
    ],
  };

  // 저장된 메뉴에 새로 추가된 기본 항목(소개·자료실 등)을 병합
  function mergeNav(savedNav) {
    if (!Array.isArray(savedNav) || !savedNav.length) return structuredClone(DEFAULTS.nav);
    const nav = savedNav.map((x) => ({ ...x }));
    const hrefs = new Set(nav.map((x) => x.href));
    DEFAULTS.nav.forEach((d) => { if (!hrefs.has(d.href)) nav.push({ ...d }); });
    return nav;
  }

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY));
      if (!saved) return structuredClone(DEFAULTS);
      return {
        hero: { ...DEFAULTS.hero, ...(saved.hero || {}) },
        nav: mergeNav(saved.nav),
        nav2: Array.isArray(saved.nav2) && saved.nav2.length ? saved.nav2 : null,
        pages: Array.isArray(saved.pages) ? saved.pages : [],
        loginLabel: saved.loginLabel || DEFAULTS.loginLabel,
        research: Array.isArray(saved.research) && saved.research.length ? saved.research : structuredClone(DEFAULTS.research),
      };
    } catch (e) {
      return structuredClone(DEFAULTS);
    }
  }

  function save(cfg) {
    localStorage.setItem(KEY, JSON.stringify(cfg));
  }

  function reset() {
    localStorage.removeItem(KEY);
  }

  window.ContentStore = { load, save, reset, DEFAULTS };
})();
