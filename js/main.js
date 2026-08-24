// 공통 스크립트: 모바일 내비게이션 + 최신 소식 슬라이더 + 성과 필터

// 모바일 메뉴 토글
(function () {
  const toggle = document.querySelector(".nav-toggle");
  const gnb = document.querySelector(".gnb");
  if (!toggle || !gnb) return;

  function setOpen(open) {
    gnb.classList.toggle("open", open);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.setAttribute("aria-label", open ? "메뉴 닫기" : "메뉴 열기");
  }

  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    setOpen(!gnb.classList.contains("open"));
  });

  // 열린 메뉴는 바깥을 누르거나 Esc를 누르면 닫힙니다.
  document.addEventListener("click", (e) => {
    if (gnb.classList.contains("open") && !gnb.contains(e.target)) setOpen(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && gnb.classList.contains("open")) {
      setOpen(false);
      toggle.focus();
    }
  });

  // 같은 페이지 내 이동(#앵커)이나 스크립트로 처리되는 링크에서도 메뉴가 닫히도록
  gnb.addEventListener("click", (e) => {
    if (e.target.closest("a")) setOpen(false);
  });

  // 데스크톱 폭으로 넓어지면 열림 상태를 초기화합니다.
  window.matchMedia("(min-width: 641px)").addEventListener("change", (ev) => {
    if (ev.matches) setOpen(false);
  });
})();

// 테마 전환 (라이트 / 다크)
// 저장값이 없으면 기기 설정(prefers-color-scheme)을 따릅니다.
// 첫 페인트 전 적용은 각 페이지 <head>의 인라인 스크립트가 담당합니다.
(function () {
  const root = document.documentElement;
  const media = window.matchMedia("(prefers-color-scheme: dark)");

  const stored = () => {
    try { return localStorage.getItem("theme"); } catch (e) { return null; }
  };
  const resolved = () => stored() || (media.matches ? "dark" : "light");

  const ICON = {
    // 라이트일 때는 달(→ 다크로 전환), 다크일 때는 해(→ 라이트로 전환)
    light: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
    dark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2v2.2M12 19.8V22M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M2 12h2.2M19.8 12H22M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6"/></svg>',
  };

  const gnb = document.querySelector(".gnb");
  if (!gnb) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "theme-toggle";
  gnb.appendChild(btn);

  function paint() {
    const cur = resolved();
    const next = cur === "dark" ? "라이트" : "다크";
    btn.innerHTML = ICON[cur];
    btn.setAttribute("aria-label", next + " 모드로 전환");
    btn.setAttribute("title", next + " 모드로 전환");
    btn.dataset.label = next + " 모드";
  }

  btn.addEventListener("click", () => {
    const next = resolved() === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try { localStorage.setItem("theme", next); } catch (e) {}
    paint();
  });

  // 직접 고르기 전에는 기기 설정 변화를 그대로 따라갑니다.
  media.addEventListener("change", () => { if (!stored()) paint(); });

  paint();
})();

// 최신 소식 슬라이더 (index.html)
// Firestore에서 슬라이드를 갈아끼운 뒤 window.initNewsSlider()로 재초기화할 수 있습니다.
(function () {
  const slider = document.getElementById("news-slider");
  if (!slider) return;

  const AUTOPLAY_MS = 5000;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function currentIndex() {
    const dots = slider.querySelectorAll(".news-dots button");
    let cur = 0;
    dots.forEach((d, i) => { if (d.classList.contains("active")) cur = i; });
    return cur;
  }

  function init() {
    const track = slider.querySelector(".news-track");
    const slides = slider.querySelectorAll(".news-slide");
    const dotsWrap = slider.querySelector(".news-dots");

    // 이전 초기화 정리
    if (slider.__timer) { clearInterval(slider.__timer); slider.__timer = null; }
    dotsWrap.innerHTML = "";

    let current = 0;

    slides.forEach((_, i) => {
      const dot = document.createElement("button");
      dot.setAttribute("aria-label", (i + 1) + "번 소식 보기");
      dot.addEventListener("click", () => { goTo(i); restart(); });
      dotsWrap.appendChild(dot);
    });
    const dots = dotsWrap.querySelectorAll("button");

    function render() {
      track.style.transform = "translateX(-" + current * 100 + "%)";
      dots.forEach((d, i) => d.classList.toggle("active", i === current));
    }
    function goTo(index) {
      current = (index + slides.length) % slides.length;
      render();
    }
    function start() {
      if (reduceMotion || slides.length < 2 || slider.__timer) return;
      slider.__timer = setInterval(() => goTo(current + 1), AUTOPLAY_MS);
    }
    function stop() {
      if (slider.__timer) { clearInterval(slider.__timer); slider.__timer = null; }
    }
    function restart() { stop(); start(); }

    slider.__api = { goTo, start, stop, restart };
    render();
    start();
  }

  // 슬라이더 요소에 1회만 바인딩되는 기본 이벤트
  function bindBaseEvents() {
    if (slider.__baseBound) return;
    slider.__baseBound = true;

    const api = () => slider.__api || {};

    slider.querySelector(".news-nav.prev").addEventListener("click", () => {
      const a = api(); if (a.goTo) { a.stop(); a.goTo(currentIndex() - 1); a.start(); }
    });
    slider.querySelector(".news-nav.next").addEventListener("click", () => {
      const a = api(); if (a.goTo) { a.stop(); a.goTo(currentIndex() + 1); a.start(); }
    });

    slider.addEventListener("mouseenter", () => api().stop && api().stop());
    slider.addEventListener("mouseleave", () => api().start && api().start());
    slider.addEventListener("focusin", () => api().stop && api().stop());
    slider.addEventListener("focusout", () => api().start && api().start());

    let touchX = null;
    slider.addEventListener("touchstart", (e) => { touchX = e.touches[0].clientX; }, { passive: true });
    slider.addEventListener("touchend", (e) => {
      if (touchX === null) return;
      const dx = e.changedTouches[0].clientX - touchX;
      if (Math.abs(dx) > 40) {
        const a = api();
        if (a.goTo) { a.stop(); a.goTo(currentIndex() + (dx < 0 ? 1 : -1)); a.start(); }
      }
      touchX = null;
    }, { passive: true });

    document.addEventListener("visibilitychange", () => {
      const a = api();
      if (document.hidden) { a.stop && a.stop(); } else { a.start && a.start(); }
    });
  }

  bindBaseEvents();
  init();
  window.initNewsSlider = init;
})();

// 성과 유형 필터 (publications.html)
// 항목이 데이터로 교체되어도 동작하도록 클릭 시점에 항목을 조회합니다.
(function () {
  const buttons = document.querySelectorAll(".pub-filter button");
  if (!buttons.length) return;

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      const filter = btn.dataset.filter;
      document.querySelectorAll("#pub-list .pub-item").forEach((item) => {
        const show = filter === "all" || item.dataset.type === filter;
        item.style.display = show ? "" : "none";
      });
    });
  });
})();
