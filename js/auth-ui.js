// 로그인 ↔ 가입 신청 패널 전환 (UI 전용)
// 실제 인증 로직은 Firebase 연동 단계에서 js/auth.js 에 구현합니다.

(function () {
  const loginPanel = document.getElementById("login-panel");
  const signupPanel = document.getElementById("signup-panel");
  if (!loginPanel || !signupPanel) return;

  document.getElementById("link-signup").addEventListener("click", (e) => {
    e.preventDefault();
    loginPanel.style.display = "none";
    signupPanel.style.display = "block";
  });

  document.getElementById("link-back-login").addEventListener("click", (e) => {
    e.preventDefault();
    signupPanel.style.display = "none";
    loginPanel.style.display = "block";
  });

  // Firebase 연동 전 임시 안내
  const show = (el, text, type) => {
    el.textContent = text;
    el.className = "form-msg " + type;
  };

  document.getElementById("btn-login").addEventListener("click", () => {
    if (window.__FB_AUTH__) return;
    show(document.getElementById("login-msg"),
      "Firebase 연동 후 로그인 기능이 활성화됩니다.", "error");
  });

  document.getElementById("btn-signup").addEventListener("click", () => {
    if (window.__FB_AUTH__) return;
    show(document.getElementById("signup-msg"),
      "Firebase 연동 후 가입 신청 기능이 활성화됩니다.", "error");
  });
})();
