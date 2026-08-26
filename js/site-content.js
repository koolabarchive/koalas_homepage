// 공개 페이지 렌더링: 저장된 사이트 설정을 메뉴와 히어로에 반영
// 모든 공개 페이지에서 content-store.js 다음에 로드합니다.

(function () {
  if (!window.ContentStore) return;
  const cfg = window.ContentStore.load();

  // 간단한 HTML 이스케이프 (저장된 문구를 안전하게 출력)
  const esc = (s) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // **텍스트** → <em>, 줄바꿈 → <br>
  const rich = (s) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, "<em>$1</em>")
      .replace(/\n/g, "<br />");

  // ----- 상단 메뉴 반영 -----
  const gnb = document.querySelector(".gnb");
  if (gnb) {
    // Netlify 등에서 /research.html 이 /research 로 표시되는 경우 대응
    const norm = (p) => ((p.split("#")[0]).replace(/\.html$/, "") || "index");
    const current = norm(location.pathname.split("/").pop() || "index.html");

    // 소개 하위 메뉴 (연구실 · 지도교수 · 구성원)
    const ABOUT_CHILDREN = [
      { label: "연구실 소개", href: "about.html" },
      { label: "지도교수", href: "professor.html" },
      { label: "구성원", href: "members.html" },
    ];

    // 저장된 메뉴 설정(옛 구조 포함)을 현재 구조로 변환:
    // 홈은 브랜드 클릭이 담당하므로 제외, 구성원은 소개 하위로 이동
    const navItems = [];
    for (const item of cfg.nav) {
      if (item.visible === false || !item.label || !item.href) continue;
      const key = norm(item.href);
      if (key === "index" || key === "members") continue;
      if (key === "about") { navItems.push({ ...item, children: ABOUT_CHILDREN }); continue; }
      navItems.push(item);
    }

    const items = navItems.map((item) => {
      if (item.children) {
        // 소개처럼 하위 메뉴가 있는 항목: 데스크톱은 호버 드롭다운,
        // 모바일 햄버거에서는 항상 펼친 목록 (CSS 처리)
        const childActive = item.children.some((c) => norm(c.href) === current);
        const links = item.children.map((c) =>
          `<a href="${esc(c.href)}">${esc(c.label)}</a>`).join("");
        return `<div class="gnb-sub${childActive ? " active-group" : ""}">
          <a href="${esc(item.href)}"${childActive ? ' class="active"' : ""}>${esc(item.label)}<svg class="gnb-caret" viewBox="0 0 12 8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 1.5L6 6l4.5-4.5"/></svg></a>
          <div class="gnb-sub-menu">${links}</div>
        </div>`;
      }
      const active = norm(item.href) === current ? ' class="active"' : "";
      return `<a href="${esc(item.href)}"${active}>${esc(item.label)}</a>`;
    }).join("");
    const loginActive = current === "login" ? " active" : "";
    gnb.innerHTML =
      items +
      `<a href="login.html" class="btn-login${loginActive}">${esc(cfg.loginLabel)}</a>`;
  }

  // ----- 연구분야 카드 반영 -----
  const areaCard = (a) => `
    <div class="card">
      ${a.tag ? '<span class="tag">' + esc(a.tag) + "</span>" : ""}
      <h3>${esc(a.title)}</h3>
      <p>${esc(a.desc || "")}</p>
    </div>`;

  const researchGrid = document.getElementById("research-grid");
  if (researchGrid && cfg.research && cfg.research.length) {
    researchGrid.innerHTML = cfg.research.map(areaCard).join("");
  }

  const researchSummary = document.getElementById("research-summary");
  if (researchSummary && cfg.research && cfg.research.length) {
    researchSummary.innerHTML = cfg.research.slice(0, 3).map(areaCard).join("");
  }

  // ----- 히어로 문구 반영 (index.html) -----
  const hero = document.querySelector(".hero-inner");
  if (hero) {
    const eyebrow = hero.querySelector(".eyebrow");
    const h1 = hero.querySelector("h1");
    const p = hero.querySelector("p");
    if (eyebrow) eyebrow.textContent = cfg.hero.eyebrow;
    if (h1) h1.innerHTML = rich(cfg.hero.title);
    if (p) p.textContent = cfg.hero.desc;
  }
})();
