// 공통 스크립트: 모바일 내비게이션 + 최신 소식 슬라이더 + 성과 필터

// 모바일 메뉴 토글
(function () {
  const toggle = document.querySelector(".nav-toggle");
  const gnb = document.querySelector(".gnb");
  if (!toggle || !gnb) return;

  toggle.addEventListener("click", () => {
    const open = gnb.classList.toggle("open");
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  });
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
