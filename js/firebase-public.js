// 공개 페이지용 Firebase 연동 모듈
// 1) siteConfig 동기화 (홈 문구·메뉴)
// 2) 로그인 상태 표시 (로그아웃 버튼, 관리자 메뉴)
// 3) 게시판 데이터 렌더링: 공지·성과·프로젝트·홈 슬라이더
//    - 데이터가 1건 이상 있을 때만 화면을 교체합니다 (없으면 샘플 유지)
// Firebase 미설정 시 아무 것도 하지 않습니다.

import { auth, db, isConfigured } from "./firebase-config.js";
import { loadNoticeBlob } from "./notice-form.js";
import { downloadStoredFile } from "./file-store.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, doc, getDoc, getDocs, query, where, onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

if (isConfigured) {
  const CFG_KEY = "labSiteConfig";
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  // ----- siteConfig 동기화 -----
  // 키 순서와 무관한 안정 직렬화 (Firestore는 키 순서를 재정렬해 반환하므로 필수)
  const stableStr = (v) => {
    if (Array.isArray(v)) return "[" + v.map(stableStr).join(",") + "]";
    if (v && typeof v === "object")
      return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + stableStr(v[k])).join(",") + "}";
    return JSON.stringify(v);
  };

  async function syncSiteConfig() {
    try {
      const snap = await getDoc(doc(db, "siteConfig", "main"));
      if (!snap.exists()) return;
      const remote = snap.data();
      let local = null;
      try { local = JSON.parse(localStorage.getItem(CFG_KEY)); } catch (_) {}

      if (stableStr(remote) !== stableStr(local)) {
        localStorage.setItem(CFG_KEY, JSON.stringify(remote));
        // 새로고침 없이 메뉴·히어로를 즉시 다시 그립니다 (관리자 메뉴 관리
        // 저장이 방문자 화면에 바로 반영되도록). 옛 캐시 등으로 refresh가
        // 없을 때만 세션당 1회 새로고침으로 폴백합니다.
        if (window.SiteContent?.refresh) {
          window.SiteContent.refresh();
        } else if (!sessionStorage.getItem("cfgSyncedOnce")) {
          sessionStorage.setItem("cfgSyncedOnce", "1");
          location.reload();
        }
      }
    } catch (_) {}
  }
  syncSiteConfig();

  // ----- 로그인 상태 (역할 확인은 1회) -----
  const roleReady = new Promise((resolve) => {
    onAuthStateChanged(auth, async (user) => {
      if (!user) return resolve({ user: null, role: "guest", name: "" });
      let role = "pending";
      let name = "";
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        if (snap.exists()) { role = snap.data().role; name = snap.data().name || ""; }
      } catch (_) {}
      resolve({ user, role, name });
    });
  });

  // 로그인 시: 멤버 전용 메뉴(마이페이지·스터디·관리자·로그아웃)를
  // 상단 바에 나열하지 않고 "이름 님 ▾" 드롭다운 하나로 묶습니다.
  roleReady.then(({ user, role, name }) => {
    const gnb = document.querySelector(".gnb");
    const loginBtn = gnb && gnb.querySelector(".btn-login");
    if (!loginBtn || !user) return;
    if (role !== "admin" && role !== "member") return;

    const wrap = document.createElement("div");
    wrap.className = "gnb-member";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "gnb-member-btn";
    btn.setAttribute("aria-haspopup", "true");
    btn.setAttribute("aria-expanded", "false");
    btn.textContent = (name ? name + " 님" : "멤버 메뉴") + " ▾";

    const menu = document.createElement("div");
    menu.className = "gnb-dropdown";
    const items = [
      ["dashboard.html", "마이페이지"],
      ["study.html", "스터디"],
    ];
    if (role === "admin") items.push(["admin.html", "관리자"]);
    let adminItem = null;
    items.forEach(([href, label]) => {
      const a = document.createElement("a");
      a.href = href;
      a.textContent = label;
      if (href === "admin.html") adminItem = a;
      if (location.pathname.endsWith("/" + href)) a.classList.add("active");
      menu.appendChild(a);
    });
    const logout = document.createElement("a");
    logout.href = "#";
    logout.className = "gnb-logout";
    logout.textContent = "로그아웃";
    logout.addEventListener("click", async (e) => {
      e.preventDefault();
      await signOut(auth);
      location.href = "index.html";
    });
    menu.appendChild(logout);

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = wrap.classList.toggle("open");
      btn.setAttribute("aria-expanded", String(open));
    });
    document.addEventListener("click", (e) => {
      if (!wrap.contains(e.target)) {
        wrap.classList.remove("open");
        btn.setAttribute("aria-expanded", "false");
      }
    });

    wrap.appendChild(btn);
    wrap.appendChild(menu);
    gnb.replaceChild(wrap, loginBtn);

    // ----- 관리자: 승인 대기 건수 배지 (가입 승인 + 성과 검수 + 확인서 신청) -----
    if (role === "admin" && adminItem) {
      const counts = { users: 0, pubs: 0, certs: 0 };
      const badgeMenu = document.createElement("span");
      badgeMenu.className = "nav-badge";
      adminItem.appendChild(badgeMenu);
      const badgeBtn = document.createElement("span");
      badgeBtn.className = "nav-badge on-btn";
      btn.appendChild(badgeBtn);

      const refresh = () => {
        const total = counts.users + counts.pubs + counts.certs;
        badgeMenu.textContent = total || "";
        badgeMenu.style.display = total ? "" : "none";
        badgeBtn.textContent = total || "";
        badgeBtn.style.display = total ? "" : "none";
        badgeMenu.title = badgeBtn.title =
          `가입 승인 ${counts.users} · 성과 검수 ${counts.pubs} · 확인서 신청 ${counts.certs}`;
      };
      refresh();
      onSnapshot(query(collection(db, "users"), where("role", "==", "pending")),
        (s) => { counts.users = s.size; refresh(); }, () => {});
      onSnapshot(query(collection(db, "publications"), where("status", "==", "pending")),
        (s) => { counts.pubs = s.size; refresh(); }, () => {});
      onSnapshot(query(collection(db, "certificates"), where("status", "==", "requested")),
        (s) => { counts.certs = s.size; refresh(); }, () => {});
    }

    // ----- 멤버: 메시지(✉) 아이콘 + 안읽음 배지 -----
    const mail = document.createElement("a");
    mail.href = "messages.html";
    mail.className = "gnb-mail";
    mail.setAttribute("aria-label", "메시지");
    mail.innerHTML = `<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="2.5" y="4.5" width="19" height="15" rx="2.6"/>
      <path d="M3.5 7.2 12 13l8.5-5.8"/>
    </svg><span class="nav-badge" style="display:none;"></span>`;
    gnb.insertBefore(mail, wrap);
    const mailBadge = mail.querySelector(".nav-badge");
    const mailCounts = { dm: 0, room: 0 };
    const refreshMail = () => {
      const total = mailCounts.dm + mailCounts.room;
      mailBadge.textContent = total > 99 ? "99+" : total || "";
      mailBadge.style.display = total ? "" : "none";
    };
    onSnapshot(query(collection(db, "dms"), where("participants", "array-contains", user.uid)), (snap) => {
      mailCounts.dm = snap.docs.reduce((n, d) => n + ((d.data().unread || {})[user.uid] || 0), 0);
      refreshMail();
    }, () => {});
    onSnapshot(query(collection(db, "rooms"), where("members", "array-contains", user.uid)), (snap) => {
      mailCounts.room = snap.docs.reduce((n, d) => n + ((d.data().unread || {})[user.uid] || 0), 0);
      refreshMail();
    }, () => {});
  });

  // ----- 데이터 조회 헬퍼 -----
  const byDateDesc = (a, b) => String(b.date || "").localeCompare(String(a.date || ""));
  const byYearDesc = (a, b) => (parseInt(b.year) || 0) - (parseInt(a.year) || 0);

  async function fetchPublicPosts(isMember) {
    // 멤버는 전체(멤버 전용 포함), 비로그인은 공개 글만 (규칙상 필터 필수)
    const q = isMember
      ? collection(db, "posts")
      : query(collection(db, "posts"), where("scope", "==", "public"));
    const snap = await getDocs(q);
    // pageId가 있는 글은 커스텀 페이지(page.html) 전용 — 공지·슬라이더에서 제외
    return snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((p) => !p.pageId).sort(byDateDesc);
  }

  async function fetchVisiblePubs() {
    const snap = await getDocs(query(collection(db, "publications"), where("visible", "==", true)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(byYearDesc);
  }

  async function fetchPublicProjects() {
    const snap = await getDocs(query(collection(db, "projects"), where("public", "==", true)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  // ----- 템플릿 -----
  const TYPE_TOKEN = { "학술논문": "논문", "학위논문": "학위", "저서": "저서", "학회발표": "학회", "포스터": "포스터" };

  // 첨부는 files 배열(최대 3개), 과거 데이터의 단일 file 필드도 함께 읽음
  const pubFilesOf = (p) => p.files || (p.file ? [p.file] : []);

  const pubItemHtml = (p, opts = {}) => {
    const fs = opts.showFile ? pubFilesOf(p) : [];
    return `
    <div class="pub-item${p.thumb ? " has-thumb" : ""}" data-type="${TYPE_TOKEN[p.type] || esc(p.type)}">
      <div class="pub-year">${esc(p.year || "")}</div>
      <div>
        <span class="pub-type">${esc(p.type)}</span>
        <div class="pub-title">${esc(p.title)}</div>
        ${p.meta ? '<div class="pub-meta">' + esc(p.meta) + "</div>" : ""}
        ${(p.link || fs.length) ? `<div class="pub-links">
          ${p.link ? `<a href="${esc(p.link)}" target="_blank" rel="noopener noreferrer">↗ 원문 링크</a>` : ""}
          ${fs.map((f, i) => `<button type="button" class="pub-file-dl" data-pubfile="${esc(p.id)}" data-fi="${i}">${esc(f.name)}</button>`).join("")}
        </div>` : ""}
      </div>
      ${p.thumb ? `<img class="pub-thumb" src="${esc(p.thumb)}" alt="" loading="lazy" />` : ""}
    </div>`;
  };

  const noticeItemHtml = (p) => `
    <a href="notice.html" class="notice-item">
      <span class="n-title">${p.badge ? '<span class="badge">' + esc(p.badge) + "</span>" : ""}${esc(p.title)}${p.scope === "member" ? ' <span class="badge" style="color:var(--indigo);">멤버</span>' : ""}</span>
      <span class="n-date">${esc(p.date || "")}</span>
    </a>`;

  // ----- 페이지별 렌더링 -----
  (async () => {
    const { role } = await roleReady;
    const isMember = role === "member" || role === "admin";

    // 홈: 슬라이더 + 최근 성과 + 공지
    const sliderTrack = document.querySelector("#news-slider .news-track");
    const recentPubs = document.getElementById("recent-pubs");
    const recentNotices = document.getElementById("recent-notices");
    if (sliderTrack || recentPubs || recentNotices) {
      try {
        const posts = await fetchPublicPosts(isMember);

        if (recentNotices) {
          recentNotices.innerHTML = posts.length
            ? posts.slice(0, 3).map(noticeItemHtml).join("")
            : '<div class="notice-item"><span class="n-title" style="color:var(--muted);">등록된 공지가 없습니다.</span></div>';
        }

        if (sliderTrack) {
          const section = document.getElementById("news-section");
          const slides = posts.filter((p) => p.slider && p.scope === "public").slice(0, 5);
          if (slides.length) {
            const BG = ["bg-indigo", "bg-celadon", "bg-dusk"];
            sliderTrack.innerHTML = slides.map((p, i) => `
              <a class="news-slide ${BG[i % 3]}" href="notice.html">
                <div class="news-caption">
                  ${p.badge ? '<span class="news-tag">' + esc(p.badge) + "</span>" : ""}
                  <h3>${esc(p.title)}</h3>
                  <div class="news-date">${esc(p.date || "")}</div>
                </div>
              </a>`).join("");
            if (section) section.style.display = "";
            if (window.initNewsSlider) window.initNewsSlider();

            // 공지의 첫 번째 '이미지' 첨부를 슬라이드 배경으로 적용
            // (그라디언트가 먼저 보이고, 이미지 로드가 끝나면 교체됩니다)
            slides.forEach(async (p, i) => {
              const img = (p.attachments || []).find((a) => (a.type || "").startsWith("image/"));
              if (!img) return;
              try {
                const blob = await loadNoticeBlob(db, img);
                const el = sliderTrack.children[i];
                if (el) el.style.backgroundImage = `url("${URL.createObjectURL(blob)}")`;
              } catch (_) { /* 이미지 로드 실패 시 그라디언트 유지 */ }
            });
          } else if (section) {
            section.style.display = "none";
          }
        }
      } catch (_) {}

      if (recentPubs) {
        try {
          const pubs = await fetchVisiblePubs();
          recentPubs.innerHTML = pubs.length
            ? pubs.slice(0, 3).map(pubItemHtml).join("")
            : '<div class="pub-item"><div></div><div class="pub-meta">등록된 성과가 없습니다.</div></div>';
        } catch (_) {}
      }
    }

    // 공지 페이지: 전체 목록
    const noticeList = document.getElementById("notice-list");
    if (noticeList) {
      try {
        const posts = await fetchPublicPosts(isMember);
        if (posts.length) noticeList.innerHTML = posts.map(noticeItemHtml).join("");
        else noticeList.innerHTML = '<div class="notice-item"><span class="n-title" style="color:var(--muted);">등록된 공지가 없습니다.</span></div>';
      } catch (_) {}
    }

    // 성과 페이지: 전체 목록 (필터는 main.js가 data-type으로 처리)
    const pubList = document.getElementById("pub-list");
    if (pubList) {
      try {
        const pubs = await fetchVisiblePubs();
        if (pubs.length) {
          // 원문 파일 다운로드는 멤버 전용 (링크는 모두에게 표시)
          pubList.innerHTML = pubs.map((p) => pubItemHtml(p, { showFile: isMember })).join("");
          if (isMember) {
            const byId = Object.fromEntries(pubs.map((p) => [p.id, p]));
            pubList.querySelectorAll("button[data-pubfile]").forEach((btn) => {
              btn.addEventListener("click", () => {
                const p = byId[btn.dataset.pubfile];
                const f = p ? pubFilesOf(p)[Number(btn.dataset.fi || 0)] : null;
                if (f) downloadStoredFile(db, "pubFiles", f, btn);
              });
            });
          }
        }
        else pubList.innerHTML = '<div class="pub-item"><div></div><div class="pub-meta">등록된 성과가 없습니다.</div></div>';
      } catch (_) {}
    }

    // 연구 페이지: 공개 프로젝트
    const projectList = document.getElementById("project-list");
    if (projectList) {
      try {
        const projects = await fetchPublicProjects();
        const filterBox = document.getElementById("project-filter");
        let currentField = "all";
        if (!projects.length) {
          projectList.innerHTML = '<div class="card"><p style="color:var(--muted);">현재 공개된 진행 중 프로젝트가 없습니다.</p></div>';
          if (filterBox) filterBox.style.display = "none";
        } else {
          // 마크다운 소개에서 텍스트만 발췌 (서식 기호 제거)
          const excerpt = (md) => {
            if (!md) return "";
            const text = md
              .replace(/!\[[^\]]*\]\([^)]*\)/g, "")          // 이미지 제거
              .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")        // 링크 → 텍스트
              .replace(/^#{1,3}\s+/gm, "")                       // 제목 기호
              .replace(/\*\*([^*]+)\*\*/g, "$1")
              .replace(/\*([^*]+)\*/g, "$1")
              .replace(/^[->]\s?/gm, "")
              .replace(/`/g, "")
              .replace(/\s+/g, " ")
              .trim();
            return text.length > 110 ? text.slice(0, 110) + "…" : text;
          };
          const STATUS_CLS = { "진행 중": "approved", "준비 중": "pending", "종료": "member" };
          const sorted = [...projects].sort((a, b) => (b.recruiting === true) - (a.recruiting === true));

          const cardHtml = (p) => {
            const team = (p.participantsUids || []).length || Number(p.memberCount) || 0;
            const tags = Array.isArray(p.fields) && p.fields.length
              ? `<div class="field-tags">${p.fields.map((f) => `<span>#${esc(f)}</span>`).join("")}</div>` : "";
            return `
            <a href="project.html?id=${p.id}" class="card study-card project-card" style="display:block;">
              <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:10px;">
                <span class="status ${STATUS_CLS[p.status] || "member"}">${esc(p.status)}</span>
                ${p.recruiting ? '<span class="status recruit-badge">📢 참가자 모집 중</span>' : ""}
              </div>
              <h3 style="font-size:1.02rem; line-height:1.4;">${esc(p.title)}</h3>
              ${p.intro || p.meta ? `<p style="font-size:0.86rem; color:var(--muted); margin-top:8px;">${esc(excerpt(p.intro) || p.meta)}</p>` : ""}
              <div class="study-meta" style="margin-top:12px;">${esc(p.period || "")}${team ? ` · 연구팀 ${team}명` : ""}</div>
              ${tags}
            </a>`;
          };

          const renderProjects = () => {
            const list = currentField === "all"
              ? sorted
              : sorted.filter((p) => Array.isArray(p.fields) && p.fields.includes(currentField));
            projectList.innerHTML = list.length
              ? list.map(cardHtml).join("")
              : `<div class="card"><p style="color:var(--muted);">"${esc(currentField)}" 분야의 프로젝트가 아직 없습니다.</p></div>`;
          };

          // 필터 칩: 프로젝트에 실제로 달린 태그 + 연구 분야(CMS) 태그의 합집합
          const usedTags = new Set();
          sorted.forEach((p) => (p.fields || []).forEach((f) => usedTags.add(f)));
          try { (window.ContentStore.load().research || []).forEach((a) => { if (a.tag) usedTags.add(a.tag); }); } catch (_) {}
          const setField = (tag) => {
            currentField = tag;
            if (filterBox) filterBox.querySelectorAll("button").forEach((b) =>
              b.classList.toggle("active", b.dataset.field === tag));
            renderProjects();
          };
          if (filterBox && usedTags.size) {
            filterBox.innerHTML = `<button class="active" data-field="all">전체</button>` +
              [...usedTags].map((t) => `<button data-field="${esc(t)}">${esc(t)}</button>`).join("");
            filterBox.querySelectorAll("button").forEach((b) =>
              b.addEventListener("click", () => setField(b.dataset.field)));
          } else if (filterBox) filterBox.style.display = "none";

          // 연구 분야 카드 클릭 → 해당 분야로 필터 + 프로젝트 섹션으로 스크롤
          const areaGrid = document.getElementById("research-grid");
          if (areaGrid && usedTags.size) {
            areaGrid.classList.add("clickable-areas");
            areaGrid.addEventListener("click", (e) => {
              const card = e.target.closest(".card");
              if (!card) return;
              const tag = card.querySelector(".tag")?.textContent?.trim();
              if (!tag || !usedTags.has(tag)) return;
              setField(tag);
              projectList.scrollIntoView({ behavior: "smooth", block: "start" });
            });
          }

          renderProjects();
        }
      } catch (_) {}
    }

    // 지도교수 페이지: 연구 출판물 (최근 5년) — 성과 데이터에서 자동 표시
    const profPapers = document.getElementById("prof-recent-papers");
    if (profPapers) {
      try {
        const pubs = await fetchVisiblePubs();
        const minYear = new Date().getFullYear() - 4;
        const recent = pubs.filter((p) =>
          (p.type === "학술논문" || p.type === "학위논문") && Number(p.year) >= minYear);
        profPapers.innerHTML = recent.length
          ? recent.map((p) => pubItemHtml(p)).join("")
          : '<div class="pub-item"><div></div><div class="pub-meta">최근 5년 논문이 성과 페이지에 등록되면 이곳에 자동으로 표시됩니다.</div></div>';
      } catch (_) {}
    }

    // 연구 페이지: 최근 성과 하이라이트
    const researchRecentBox = document.getElementById("research-recent-pubs");
    if (researchRecentBox) {
      try {
        const pubs = await fetchVisiblePubs();
        researchRecentBox.innerHTML = pubs.length
          ? pubs.slice(0, 4).map((p) => pubItemHtml(p)).join("")
          : '<div class="pub-item"><div></div><div class="pub-meta">등록된 성과가 없습니다.</div></div>';
      } catch (_) {}
    }

    // 구성원 페이지
    const membersEmpty = document.getElementById("members-empty");
    if (membersEmpty) {
      try {
        const snap = await getDocs(collection(db, "members"));
        const people = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (a.order || 0) - (b.order || 0));

        const photoSrc = (p) => p.photoData || p.photoUrl || "";
        const photoHtml = (p) => photoSrc(p)
          ? `<img class="member-photo" src="${esc(photoSrc(p))}" alt="${esc(p.name)}" loading="lazy" />`
          : `<div class="member-photo">${esc((p.name || "?").charAt(0))}</div>`;

        const cardHtml = (p) => `
          <div class="card member-card clickable" data-person="${p.id}" role="button" tabindex="0">
            ${photoHtml(p)}
            <h4>${esc(p.name)}</h4>
            ${p.title ? '<div class="role">' + esc(p.title) + "</div>" : ""}
            ${p.interest ? '<div class="interest">' + esc(p.interest) + "</div>" : ""}
          </div>`;

        const groups = [
          // 지도교수는 전용 페이지(professor.html)에서 소개하므로 구성원 목록에서 제외
          { key: "phd", grid: "grid-phd", section: "group-phd" },
          { key: "ms", grid: "grid-ms", section: "group-ms" },
        ];

        let any = false;
        groups.forEach((g) => {
          const list = people.filter((p) => p.group === g.key);
          const section = document.getElementById(g.section);
          if (list.length) {
            document.getElementById(g.grid).innerHTML = list.map(cardHtml).join("");
            section.style.display = "";
            any = true;
          } else {
            section.style.display = "none";
          }
        });

        const alumni = people.filter((p) => p.group === "alumni");
        const alumniSection = document.getElementById("group-alumni");
        if (alumni.length) {
          // 연도(내림차순, 2026 → 과거) 제목 아래에 전기/후기 하위 구분을 두고
          // 명단을 정리합니다. 학기 미지정 인원은 연도 제목 바로 아래에,
          // 연도 미지정 인원은 맨 끝 "기타" 묶음에 표시합니다.
          const byOrder = (a, b) => (a.order || 0) - (b.order || 0);
          const itemHtml = (p) => `
                <div class="pub-item clickable alumni-item" data-person="${p.id}" role="button" tabindex="0">
                  <div>
                    <div class="pub-title">${esc(p.name)}${p.title ? " (" + esc(p.title) + ")" : ""}</div>
                    ${p.meta ? '<div class="pub-meta">' + esc(p.meta) + "</div>" : ""}
                  </div>
                </div>`;
          const termBlock = (items, label) => items.length
            ? `<div class="alumni-term"><h5 class="cohort-term">${label}</h5>${items.sort(byOrder).map(itemHtml).join("")}</div>`
            : "";

          const years = [...new Set(alumni.filter((p) => p.year).map((p) => p.year))]
            .sort((a, b) => (parseInt(b) || 0) - (parseInt(a) || 0));
          const noYear = alumni.filter((p) => !p.year).sort(byOrder);

          document.getElementById("alumni-list").innerHTML = years.map((year) => {
            const inYear = alumni.filter((p) => p.year === year);
            const plain = inYear.filter((p) => p.term !== "전기" && p.term !== "후기").sort(byOrder);
            return `
            <div class="alumni-year">
              <h4 class="cohort-year">${esc(year)}</h4>
              ${plain.map(itemHtml).join("")}
              ${termBlock(inYear.filter((p) => p.term === "전기"), "전기")}
              ${termBlock(inYear.filter((p) => p.term === "후기"), "후기")}
            </div>`;
          }).join("") + (noYear.length
            ? `<div class="alumni-year"><h4 class="cohort-year">기타</h4>${noYear.map(itemHtml).join("")}</div>`
            : "");
          alumniSection.style.display = "";
          any = true;
        } else {
          alumniSection.style.display = "none";
        }

        membersEmpty.textContent = any ? "" : "등록된 구성원이 없습니다.";

        // ----- 구성원 클릭 → 상세 모달 (관심분야 + 참여 프로젝트 + 연구 성과) -----
        const personModal = document.getElementById("person-modal");
        if (personModal) {
          let cacheProjects = null;
          let cachePubs = null;

          const loadLinkedData = async () => {
            if (!cacheProjects) {
              // 멤버는 전체 프로젝트, 비로그인은 공개 프로젝트만 (규칙상 필터 필수)
              const pq = isMember
                ? collection(db, "projects")
                : query(collection(db, "projects"), where("public", "==", true));
              const ps = await getDocs(pq);
              cacheProjects = ps.docs.map((d) => ({ id: d.id, ...d.data() }));
            }
            if (!cachePubs) cachePubs = await fetchVisiblePubs();
            return { projects: cacheProjects, pubs: cachePubs };
          };

          const openPerson = async (p) => {
            document.getElementById("person-photo").innerHTML = photoSrc(p)
              ? `<img src="${esc(photoSrc(p))}" alt="" style="width:64px; height:64px; border-radius:50%; object-fit:cover; border:1px solid var(--line);" />`
              : `<div class="member-photo" style="width:64px; height:64px; margin:0; font-size:1.4rem;">${esc((p.name || "?").charAt(0))}</div>`;
            document.getElementById("person-name").textContent = p.name;
            document.getElementById("person-title").textContent =
              [p.title, p.group === "alumni" ? [[p.year, p.term].filter(Boolean).join(" "), p.meta].filter(Boolean).join(" · ") : ""].filter(Boolean).join(" · ");
            document.getElementById("person-interest").innerHTML = p.interest
              ? `<span class="hint" style="display:block; margin-bottom:4px;">관심 분야</span><div style="font-size:0.92rem;">${esc(p.interest)}</div>`
              : "";
            const projBox = document.getElementById("person-projects");
            const pubBox = document.getElementById("person-pubs");
            projBox.innerHTML = pubBox.innerHTML = '<p style="color:var(--muted);">불러오는 중…</p>';
            personModal.classList.add("open");

            // 신원의 기준은 멤버 계정(uid)입니다. 이름 기반 매칭은 동명이인 시
            // 서로의 성과가 섞이는 문제가 있어 사용하지 않습니다.
            if (!p.linkedUid) {
              projBox.innerHTML = pubBox.innerHTML =
                '<p style="color:var(--muted);">멤버 계정이 연결되지 않은 프로필입니다. 관리자 페이지 › 홈페이지 구성원에서 계정을 연결하면 참여 프로젝트와 성과가 자동으로 표시됩니다.</p>';
              return;
            }

            try {
              const { projects, pubs } = await loadLinkedData();
              const myProjects = projects.filter((pr) =>
                (pr.participantsUids || []).includes(p.linkedUid));
              projBox.innerHTML = myProjects.length
                ? myProjects.map((pr) => `
                    <div style="padding:8px 0; border-bottom:1px solid var(--line);">
                      <strong>${esc(pr.title)}</strong>
                      <span class="sub" style="display:inline; margin-left:6px;">${esc([pr.period, pr.status].filter(Boolean).join(" · "))}</span>
                    </div>`).join("")
                : '<p style="color:var(--muted);">연동된 프로젝트가 없습니다.</p>';

              const myPubs = pubs.filter((pub) =>
                (pub.memberUids || []).includes(p.linkedUid)
                || pub.createdByUid === p.linkedUid);
              pubBox.innerHTML = myPubs.length
                ? myPubs.map((pub) => `
                    <div style="padding:8px 0; border-bottom:1px solid var(--line);">
                      <span class="pub-type">${esc(pub.type || "")}</span>
                      <strong style="margin-left:4px;">${esc(pub.title)}</strong>
                      ${pub.meta ? `<span class="sub">${esc(pub.meta)}</span>` : ""}
                    </div>`).join("")
                : '<p style="color:var(--muted);">연동된 성과가 없습니다.</p>';
            } catch (_) {
              projBox.innerHTML = pubBox.innerHTML = '<p style="color:var(--muted);">불러오지 못했습니다.</p>';
            }
          };

          document.querySelectorAll("[data-person]").forEach((el) => {
            const open = () => {
              const p = people.find((x) => x.id === el.dataset.person);
              if (p) openPerson(p);
            };
            el.addEventListener("click", open);
            el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
          });
          // 프로젝트 팀 카드에서 members.html#u=<계정uid>로 진입하면
          // 그 계정이 연결된 구성원 프로필을 바로 엽니다. 연결된 프로필이
          // 없으면 조용히 목록만 보여줍니다.
          const um = /[#&]u=([^&]+)/.exec(location.hash);
          if (um) {
            const target = people.find((x) => x.linkedUid === decodeURIComponent(um[1]));
            if (target) openPerson(target);
          }

          document.getElementById("person-close").addEventListener("click", () => personModal.classList.remove("open"));
          personModal.addEventListener("click", (e) => { if (e.target === personModal) personModal.classList.remove("open"); });
        }
        membersEmpty.style.display = any ? "none" : "";
      } catch (_) {
        membersEmpty.textContent = "구성원 정보를 불러오지 못했습니다.";
      }
    }
  })();
}
