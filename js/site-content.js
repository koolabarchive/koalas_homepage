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
    const norm = (p) => (p.replace(/\.html$/, "") || "index");
    const current = norm(location.pathname.split("/").pop() || "index.html");
    const items = cfg.nav
      .filter((item) => item.visible !== false && item.label && item.href)
      .map((item) => {
        const active = norm(item.href) === current ? ' class="active"' : "";
        return `<a href="${esc(item.href)}"${active}>${esc(item.label)}</a>`;
      })
      .join("");
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
