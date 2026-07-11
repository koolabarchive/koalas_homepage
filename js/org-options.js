// 소속·직책 공용 옵션
// 가입 신청(login.html), 회원 직접 등록·정보 수정(admin.html)에서 함께 사용합니다.
// 목록을 바꾸려면 이 파일만 수정하면 됩니다.

export const ETC = "기타";

export const AFFILIATIONS = [
  "심리아동학부",
  "일반대학원 심리학과 (임상및상담심리전공)",
  "정신분석대학원",
  "교육대학원",
  ETC,
];

export const POSITIONS = [
  "학사",
  "석사",
  "박사",
  "교수",
  "연구원",
  ETC,
];

export const STATUSES = [
  "재학",
  "수료",
  "졸업",
  "재직",
  "퇴직",
  ETC,
];

// <select>에 옵션 채우기 (첫 항목은 안내용 placeholder)
export function fillSelect(sel, options, placeholder) {
  sel.innerHTML =
    (placeholder ? `<option value="" disabled selected>${placeholder}</option>` : "") +
    options.map((o) => `<option value="${o}">${o}</option>`).join("");
}

// 저장된 값으로 select + '기타' 직접입력 필드 상태 맞추기
export function applySelectValue(sel, etcInput, etcWrap, value, options) {
  if (value && options.includes(value)) {
    sel.value = value;
    etcInput.value = "";
    etcWrap.style.display = "none";
  } else if (value) {
    sel.value = ETC;
    etcInput.value = value;
    etcWrap.style.display = "";
  } else {
    sel.selectedIndex = 0;
    etcInput.value = "";
    etcWrap.style.display = "none";
  }
}

// select + '기타' 입력에서 최종 문자열 얻기 (미선택이면 null)
export function resolveSelectValue(sel, etcInput) {
  const v = sel.value;
  if (!v) return null;
  if (v === ETC) {
    const custom = etcInput.value.trim();
    return custom || null;
  }
  return v;
}

// '기타' 선택 시 직접입력 필드 토글
export function bindEtcToggle(sel, etcWrap, etcInput) {
  sel.addEventListener("change", () => {
    const isEtc = sel.value === ETC;
    etcWrap.style.display = isEtc ? "" : "none";
    if (isEtc) etcInput.focus();
  });
}


// 계정 정보 → 구성원 프로필 그룹/직함 자동 매핑 (가입 승인 시 프로필 자동 생성용)
export function memberProfileFrom(user) {
  let group = "ms";
  if ((user.memberStatus || "") === "졸업") group = "alumni";
  else if ((user.position || "") === "교수") group = "professor";
  else if ((user.position || "") === "박사") group = "phd";
  const title = [user.position, user.affiliation].filter(Boolean).join(" · ");
  return {
    name: user.name || "",
    group,
    title,
    interest: "",
    linkedUid: user.uid || user.id || "",
  };
}
