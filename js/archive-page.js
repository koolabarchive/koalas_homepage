// 자료실 페이지 (archive.html)
// 공개 자료는 비로그인 방문자도 열람·다운로드 가능, 🔒 멤버 전용 자료는 로그인 멤버만 보임.
// 등록·삭제는 관리자 전용.

import { auth, db, isConfigured } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, doc, getDoc, addDoc, deleteDoc, onSnapshot, query, where, orderBy, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { uploadStoredFile, downloadStoredFile, deleteStoredFile, fmtStoredSize } from "./file-store.js";
import { createDropdown, setupScopeToggle } from "./notice-ui.js";

if (isConfigured) {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const fmtDate = (ts) => {
    if (!ts || !ts.toDate) return "";
    const d = ts.toDate();
    return d.getFullYear() + "." + String(d.getMonth() + 1).padStart(2, "0") + "." + String(d.getDate()).padStart(2, "0");
  };

  let me = null;        // null = 비로그인
  let isAdmin = false;
  let items = [];
  let category = "all";
  let search = "";
  const openItems = new Set();
  let unsub = null;

  onAuthStateChanged(auth, async (user) => {
    me = null; isAdmin = false;
    if (user) {
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        if (snap.exists()) {
          const d = snap.data();
          if (d.role === "member" || d.role === "admin") me = { uid: user.uid, ...d };
          isAdmin = d.role === "admin";
        }
      } catch (_) {}
    }
    $("ar-admin-bar").style.display = isAdmin ? "" : "none";
    subscribe();
  });

  function subscribe() {
    if (unsub) unsub();
    // Firestore 규칙상 쿼리가 조건을 보장해야 하므로:
    // 멤버는 전체 목록, 비로그인 방문자는 scope=='public' 조건 쿼리 사용
    const base = collection(db, "archives");
    const finalQ = me
      ? query(base, orderBy("createdAt", "desc"))
      : query(base, where("scope", "==", "public"));
    unsub = onSnapshot(finalQ, (snap) => {
      items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (!me) items.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      render();
    }, (err) => {
      $("ar-list").innerHTML = `<p style="color:var(--muted); font-size:0.9rem; padding:12px 4px;">자료를 불러오지 못했습니다. (${esc(err.code || err.message)})</p>`;
    });
  }

  function render() {
    const box = $("ar-list");
    let filtered = category === "all" ? items : items.filter((m) => (m.category || "기타") === category);
    if (search) {
      const s = search.toLowerCase();
      filtered = filtered.filter((m) =>
        [m.title, m.note, m.category, ...(m.attachments || []).map((a) => a.name)]
          .some((v) => (v || "").toLowerCase().includes(s)));
    }
    if (!filtered.length) {
      box.innerHTML = `<p style="color:var(--muted); font-size:0.9rem; padding:12px 4px;">${search ? "검색 결과가 없습니다." : "등록된 자료가 없습니다."}</p>`;
      return;
    }
    const byId = {};
    box.innerHTML = filtered.map((m) => {
      byId[m.id] = m;
      const open = openItems.has(m.id);
      const attCount = (m.attachments || []).length;
      return `<div class="board-item${open ? " open" : ""}">
        <button type="button" class="b-row" data-toggle="${m.id}">
          <span class="b-title">
            <span class="pub-type" style="margin-right:8px;">${esc(m.category || "기타")}</span>
            ${m.scope === "member" ? '<span class="scope-chip">🔒 멤버</span>' : ""}
            ${esc(m.title)}
            ${attCount ? ` <span class="b-att">📎 ${attCount}</span>` : ""}
            ${m.link ? ' <span class="b-att">🔗</span>' : ""}
          </span>
          <span class="b-meta">${fmtDate(m.createdAt)}</span>
        </button>
        <div class="b-detail"${open ? "" : " hidden"}>
          ${m.note ? `<div class="b-body">${esc(m.note)}</div>` : ""}
          ${m.link ? `<div class="b-body"><a href="${esc(m.link)}" target="_blank" rel="noopener noreferrer" style="color:var(--indigo); font-weight:600;">🔗 링크 열기</a></div>` : ""}
          ${(m.attachments || []).length ? `<div class="att-list">${m.attachments.map((a, i) =>
            `<span class="att-chip"><button type="button" class="att-dl" data-att="${m.id}:${i}">📎 ${esc(a.name)} <small>${fmtStoredSize(a.size)}</small></button></span>`).join("")}</div>` : ""}
          ${isAdmin ? `<div class="b-actions"><button class="btn-sm danger" data-del="${m.id}">삭제</button></div>` : ""}
        </div>
      </div>`;
    }).join("");

    box.querySelectorAll("button[data-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const item = btn.closest(".board-item");
        const detail = item.querySelector(".b-detail");
        const key = btn.dataset.toggle;
        if (detail.hidden) { detail.hidden = false; item.classList.add("open"); openItems.add(key); }
        else { detail.hidden = true; item.classList.remove("open"); openItems.delete(key); }
      });
    });
    box.querySelectorAll("button.att-dl").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const [id, idx] = btn.dataset.att.split(":");
        const att = byId[id]?.attachments?.[Number(idx)];
        if (att) downloadStoredFile(db, "archiveFiles", att, btn);
      });
    });
    box.querySelectorAll("button[data-del]").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const m = byId[btn.dataset.del];
        if (!confirm(`"${m.title}" 자료를 삭제할까요? 첨부파일도 함께 삭제됩니다.`)) return;
        try {
          for (const a of m.attachments || []) { try { await deleteStoredFile(db, "archiveFiles", a.fileId); } catch (_) {} }
          await deleteDoc(doc(db, "archives", m.id));
        } catch (err) { alert("삭제 실패: " + err.message); }
      });
    });
  }

  // 필터·검색
  document.querySelectorAll("#ar-filter button").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#ar-filter button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      category = btn.dataset.cat;
      render();
    });
  });
  $("ar-search").addEventListener("input", () => { search = $("ar-search").value.trim(); render(); });

  // ----- 등록 모달 (관리자) -----
  const modal = $("ar-modal");
  const CATEGORIES = ["양식·서식", "발표자료", "문서", "링크", "기타"];
  const catDd = createDropdown($("ar-cat-dd"), { values: CATEGORIES, allowEmpty: false });
  const scopeCtl = setupScopeToggle($("ar-scope-toggle"), $("ar-scope-label"), $("ar-scope"));
  $("ar-files").addEventListener("change", () => {
    $("ar-file-list").innerHTML = [...($("ar-files").files || [])].map((f) =>
      `<div class="file-row">📎 <span class="f-name">${esc(f.name)}</span><span class="f-size">${fmtStoredSize(f.size)}</span></div>`).join("");
  });
  $("btn-write-ar").addEventListener("click", () => {
    $("ar-title").value = "";
    $("ar-note").value = "";
    $("ar-link").value = "";
    catDd.set(CATEGORIES[0]);
    scopeCtl.set(false, { animate: false });
    $("ar-files").value = "";
    $("ar-file-list").innerHTML = "";
    $("ar-msg").className = "form-msg";
    modal.classList.add("open");
  });
  $("ar-cancel").addEventListener("click", () => modal.classList.remove("open"));
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.remove("open"); });

  $("ar-save").addEventListener("click", async () => {
    const msg = $("ar-msg");
    const btn = $("ar-save");
    const title = $("ar-title").value.trim();
    if (!title) { msg.textContent = "제목을 입력해 주세요."; msg.className = "form-msg error"; return; }
    let link = $("ar-link").value.trim();
    if (link && !/^https?:\/\//i.test(link)) link = "https://" + link;
    const files = [...($("ar-files").files || [])];
    if (files.length > 5) { msg.textContent = "첨부파일은 최대 5개까지입니다."; msg.className = "form-msg error"; return; }
    // 자물쇠 토글의 hidden 값("공개"/"멤버 전용")을 저장용 scope로 변환 (공지와 동일)
    const scope = $("ar-scope").value === "공개" ? "public" : "member";

    btn.disabled = true;
    try {
      const attachments = [];
      for (let i = 0; i < files.length; i++) {
        btn.textContent = `업로드 중… (${i + 1}/${files.length})`;
        attachments.push(await uploadStoredFile(db, "archiveFiles", me.uid, files[i], { scope }));
      }
      btn.textContent = "등록 중…";
      await addDoc(collection(db, "archives"), {
        title,
        category: catDd.get(),
        note: $("ar-note").value.trim(),
        link,
        scope,
        attachments,
        createdByUid: me.uid,
        createdByName: me.name,
        createdAt: serverTimestamp(),
      });
      modal.classList.remove("open");
    } catch (err) {
      msg.textContent = "등록 실패: " + err.message;
      msg.className = "form-msg error";
    } finally {
      btn.disabled = false;
      btn.textContent = "등록";
    }
  });
}
