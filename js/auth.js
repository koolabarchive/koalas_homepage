// 실제 인증 로직 (login.html)
// - 로그인: role에 따라 관리자 → admin.html / 멤버 → index.html / 대기 → 안내 후 로그아웃
// - 가입: users 문서 생성. 관리자가 사전 등록(invites)한 이메일이면 자동 승인.
// - Firebase 미설정 시 아무 것도 하지 않음 (auth-ui.js의 데모 안내가 동작)

import { auth, db, isConfigured } from "./firebase-config.js";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  addDoc,
  getDocs,
  collection,
  query,
  where,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  AFFILIATIONS, POSITIONS, STATUSES, fillSelect, resolveSelectValue, bindEtcToggle, memberProfileFrom,
} from "./org-options.js";

if (isConfigured) {
  window.__FB_AUTH__ = true; // auth-ui.js의 데모 클릭 핸들러 비활성화

  const $ = (id) => document.getElementById(id);
  const showMsg = (el, text, type) => {
    el.textContent = text;
    el.className = "form-msg " + type;
  };

  const ERROR_KO = {
    "auth/invalid-email": "이메일 형식을 확인해 주세요.",
    "auth/user-not-found": "등록되지 않은 이메일입니다.",
    "auth/wrong-password": "비밀번호가 올바르지 않습니다.",
    "auth/invalid-credential": "이메일 또는 비밀번호가 올바르지 않습니다.",
    "auth/email-already-in-use": "이미 가입된 이메일입니다.",
    "auth/weak-password": "비밀번호는 6자 이상이어야 합니다.",
    "auth/too-many-requests": "시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.",
    "auth/network-request-failed": "네트워크 연결을 확인해 주세요.",
  };
  const koError = (e) => ERROR_KO[e.code] || "오류가 발생했습니다. (" + e.code + ")";

  // ----- 로그인 -----
  $("btn-login").addEventListener("click", async () => {
    const msgEl = $("login-msg");
    const email = $("login-email").value.trim();
    const pw = $("login-password").value;
    if (!email || !pw) return showMsg(msgEl, "이메일과 비밀번호를 입력해 주세요.", "error");

    try {
      showMsg(msgEl, "로그인 중...", "ok");
      const cred = await signInWithEmailAndPassword(auth, email, pw);
      let role = "pending";
      try {
        const snap = await getDoc(doc(db, "users", cred.user.uid));
        role = snap.exists() ? snap.data().role : "pending";
      } catch (roleErr) {
        await signOut(auth);
        showMsg(msgEl, "권한 정보를 불러오지 못했습니다. 보안 규칙이 게시되었는지 확인해 주세요. (" + roleErr.code + ")", "error");
        return;
      }

      if (role === "admin") {
        location.href = "admin.html";
      } else if (role === "member") {
        location.href = "dashboard.html";
      } else if (role === "rejected") {
        await signOut(auth);
        showMsg(msgEl, "가입이 거절된 계정입니다. 관리자에게 문의해 주세요.", "error");
      } else {
        await signOut(auth);
        showMsg(msgEl, "가입 신청이 접수되었으며 관리자 승인 대기 중입니다.", "ok");
      }
    } catch (e) {
      showMsg(msgEl, koError(e), "error");
    }
  });

  // Enter 키로 로그인
  $("login-password").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("btn-login").click();
  });

  // ----- 가입 신청 -----
  fillSelect($("su-affil"), AFFILIATIONS, "소속 선택");
  fillSelect($("su-position"), POSITIONS, "직책 선택");
  fillSelect($("su-status"), STATUSES, "상태 선택");
  bindEtcToggle($("su-affil"), $("su-affil-etc-wrap"), $("su-affil-etc"));

  $("btn-signup").addEventListener("click", async () => {
    const msgEl = $("signup-msg");
    const name = $("su-name").value.trim();
    const affiliation = resolveSelectValue($("su-affil"), $("su-affil-etc"));
    const position = $("su-position").value;
    const status = $("su-status").value;
    const email = $("su-email").value.trim();
    const pw = $("su-password").value;

    if (!name || !email || !pw)
      return showMsg(msgEl, "모든 항목을 입력해 주세요.", "error");
    if (!affiliation)
      return showMsg(msgEl, "소속을 선택해 주세요. '기타'를 고른 경우 소속을 직접 입력해 주세요.", "error");
    if (!position)
      return showMsg(msgEl, "직책을 선택해 주세요.", "error");
    if (!status)
      return showMsg(msgEl, "상태를 선택해 주세요.", "error");

    try {
      showMsg(msgEl, "가입 처리 중...", "ok");
      const cred = await createUserWithEmailAndPassword(auth, email, pw);

      // 사전 등록(invites) 확인 — 본인 이메일 문서만 읽기 허용됨
      let role = "pending";
      let inviteAffil = null;
      let invitePosition = null;
      let inviteStatus = null;
      try {
        const invite = await getDoc(doc(db, "invites", email.toLowerCase()));
        if (invite.exists()) {
          role = invite.data().role === "admin" ? "admin" : "member";
          inviteAffil = invite.data().affiliation || null;
          invitePosition = invite.data().position || null;
          inviteStatus = invite.data().memberStatus || null;
        }
      } catch (_) { /* 사전 등록 없음 */ }

      await setDoc(doc(db, "users", cred.user.uid), {
        name,
        affiliation: inviteAffil || affiliation,
        position: invitePosition || position,
        memberStatus: inviteStatus || status,
        email: email.toLowerCase(),
        role,
        createdAt: serverTimestamp(),
      });

      if (role === "pending") {
        await signOut(auth);
        showMsg(msgEl, "가입 신청이 완료되었습니다. 관리자 승인 후 로그인할 수 있습니다.", "ok");
      } else {
        // 사전 등록 가입자: 승인 단계가 없으므로 구성원 프로필을 여기서 자동 생성
        try {
          const existing = await getDocs(query(collection(db, "members"), where("linkedUid", "==", cred.user.uid)));
          if (existing.empty) {
            await addDoc(collection(db, "members"), {
              ...memberProfileFrom({
                uid: cred.user.uid,
                name,
                affiliation: inviteAffil || affiliation,
                position: invitePosition || position,
                memberStatus: inviteStatus || status,
              }),
              createdAt: serverTimestamp(),
            });
          }
        } catch (_) { /* 프로필 생성 실패해도 가입은 유지 — 관리자가 수동 생성 가능 */ }
        location.href = role === "admin" ? "admin.html" : "dashboard.html";
      }
    } catch (e) {
      showMsg(msgEl, koError(e), "error");
    }
  });

  // ----- 비밀번호 재설정 -----
  document.getElementById("link-reset").addEventListener("click", async (e) => {
    e.preventDefault();
    const msgEl = $("login-msg");
    const email = $("login-email").value.trim() || prompt("가입한 이메일을 입력해 주세요.");
    if (!email) return;
    try {
      await sendPasswordResetEmail(auth, email);
      showMsg(msgEl, "재설정 메일을 보냈습니다. 메일함(스팸함 포함)을 확인해 주세요.", "ok");
    } catch (e2) {
      showMsg(msgEl, koError(e2), "error");
    }
  });
}
