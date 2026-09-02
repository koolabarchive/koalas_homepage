// 연구실 사진 페이지의 순수 렌더링 함수 (Firebase 의존 없음 — 테스트 가능)
import { esc } from "./notice-ui.js";

export const DEFAULT_ALBUM = { id: "gallery", title: "연구실 사진", scope: "public" };

// 사진을 앨범(pageId)별로 묶습니다. 정의된 앨범 순서를 따르고,
// 정의에 없는 pageId(삭제된 앨범 페이지 등)는 "기타"로 뒤에 붙입니다.
export function groupByAlbum(photos, albums) {
  const map = new Map(albums.map((a) => [a.id, { ...a, items: [] }]));
  const etc = { id: "__etc", title: "기타", items: [] };
  photos.forEach((p) => {
    const g = map.get(p.pageId || DEFAULT_ALBUM.id) || etc;
    g.items.push(p);
  });
  const groups = [...map.values()].filter((g) => g.items.length);
  if (etc.items.length) groups.push(etc);
  return groups;
}

const icTrash = '<svg class="ic-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>';

function itemHtml(p, idx, isAdmin) {
  const alt = esc(p.title || "사진");
  return `
    <figure class="gl-item" data-lb="${idx}">
      <img src="${p.imageData}" alt="${alt}" loading="lazy" decoding="async" />
      ${p.title || p.scope === "member" ? `<figcaption>${p.scope === "member" ? '<span class="gl-lock" title="멤버에게만 공개">멤버</span>' : ""}${esc(p.title || "")}</figcaption>` : ""}
      ${isAdmin ? `<button type="button" class="gl-del" data-del-photo="${p.id}" title="삭제" aria-label="사진 삭제">${icTrash}</button>` : ""}
    </figure>`;
}

// groups: groupByAlbum 결과 / filter: 앨범 id ('' = 전체)
export function buildGallery(groups, { filter = "", isAdmin = false } = {}) {
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  if (!total) {
    return `<p class="board-empty">아직 등록된 사진이 없습니다.${isAdmin ? ' 위의 "사진 올리기"로 첫 사진을 올려 보세요.' : ""}</p>`;
  }

  let html = "";
  // 앨범이 둘 이상일 때만 필터 칩 표시
  if (groups.length > 1) {
    html += `<div class="gl-chips" role="tablist" aria-label="앨범 선택">
      <button type="button" class="gl-chip${filter ? "" : " on"}" data-album="" role="tab" aria-selected="${!filter}">전체 <span class="gl-n">${total}</span></button>
      ${groups.map((g) => `<button type="button" class="gl-chip${filter === g.id ? " on" : ""}" data-album="${esc(g.id)}" role="tab" aria-selected="${filter === g.id}">${esc(g.title)} <span class="gl-n">${g.items.length}</span></button>`).join("")}
    </div>`;
  }

  const shown = filter ? groups.filter((g) => g.id === filter) : groups;
  let idx = 0;
  shown.forEach((g) => {
    const head = (!filter && groups.length > 1)
      ? `<div class="gl-album-head"><h2>${esc(g.title)}</h2><span class="gl-count">${g.items.length}장</span></div>`
      : "";
    html += `<section class="gl-album">${head}<div class="gl-masonry">${g.items.map((p) => itemHtml(p, idx++, isAdmin)).join("")}</div></section>`;
  });
  return html;
}
