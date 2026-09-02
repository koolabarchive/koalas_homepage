// 연구실 사진 페이지의 순수 렌더링 함수 (Firebase 의존 없음 — 테스트 가능)
//
// 사진(photo): { id, imageData, caption, albumIds: [], scope, authorUid, authorName, date, legacy? }
// 앨범(album): { id, name, createdByUid, legacy? }  — 사진 하나가 여러 앨범(태그)에 속할 수 있음
import { esc } from "./notice-ui.js";

export const NONE_ID = "__none";   // 앨범이 없는 사진을 모아 보는 가상 칩

// 앨범별 사진 수 (앨범 목록 순서 유지, 사진이 없는 앨범도 0으로 포함)
export function countByAlbum(photos, albums) {
  const counts = new Map(albums.map((a) => [a.id, 0]));
  let none = 0;
  photos.forEach((p) => {
    const ids = (p.albumIds || []).filter((id) => counts.has(id));
    if (!ids.length) none++;
    ids.forEach((id) => counts.set(id, counts.get(id) + 1));
  });
  return { counts, none };
}

// 필터에 맞는 사진만 (filter: '' = 전체, NONE_ID = 미분류, 그 외 = 앨범 id)
export function filterPhotos(photos, albums, filter) {
  if (!filter) return photos;
  const known = new Set(albums.map((a) => a.id));
  if (filter === NONE_ID) return photos.filter((p) => !(p.albumIds || []).some((id) => known.has(id)));
  return photos.filter((p) => (p.albumIds || []).includes(filter));
}

const IC = (d) => `<svg class="ic-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const icTrash = IC('<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>');
const icPen = IC('<path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>');
const icMore = '<svg class="ic-svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';

function itemHtml(p, idx, albumsById, canEdit) {
  const alt = esc(p.caption || "사진");
  const tags = (p.albumIds || []).map((id) => albumsById.get(id)).filter(Boolean);
  const hasCap = p.caption || tags.length || p.scope === "member";
  return `
    <figure class="gl-item" data-lb="${idx}">
      <img src="${p.imageData}" alt="${alt}" loading="lazy" decoding="async" />
      ${hasCap ? `<figcaption>
        ${p.scope === "member" ? '<span class="gl-lock" title="멤버에게만 공개">멤버</span>' : ""}
        ${p.caption ? `<span class="gl-cap">${esc(p.caption)}</span>` : ""}
        ${tags.length ? `<span class="gl-tags">${tags.map((a) => `<span class="gl-tag">#${esc(a.name)}</span>`).join("")}</span>` : ""}
      </figcaption>` : ""}
      ${canEdit ? `<div class="gl-tools">
        <button type="button" class="gl-tool" data-menu="${p.id}" aria-haspopup="menu" aria-expanded="false" aria-label="사진 메뉴" title="수정·삭제">${icMore}</button>
        <div class="gl-menu" role="menu" hidden>
          ${p.legacy ? "" : `<button type="button" role="menuitem" data-edit-photo="${p.id}">${icPen} 수정</button>`}
          <button type="button" role="menuitem" class="danger" data-del-photo="${p.id}">${icTrash} 삭제</button>
        </div>
      </div>` : ""}
    </figure>`;
}

// 칩 줄 + 매스너리. canEdit(p) → 그 사진의 수정·삭제 권한, canManage(album) → 앨범 이름 변경·삭제 권한
export function buildGallery(photos, albums, { filter = "", canEdit = () => false, canManage = () => false, isMember = false } = {}) {
  const albumsById = new Map(albums.map((a) => [a.id, a]));
  const { counts, none } = countByAlbum(photos, albums);
  let html = "";

  if (albums.length || none) {
    const chip = (id, label, n, on) => `<button type="button" class="gl-chip${on ? " on" : ""}" data-album="${esc(id)}" role="tab" aria-selected="${on}">${esc(label)} <span class="gl-n">${n}</span></button>`;
    html += `<div class="gl-chips" role="tablist" aria-label="앨범 선택">
      ${chip("", "전체", photos.length, !filter)}
      ${albums.map((a) => chip(a.id, a.name, counts.get(a.id), filter === a.id)).join("")}
      ${none && albums.length ? chip(NONE_ID, "미분류", none, filter === NONE_ID) : ""}
    </div>`;
  }

  const cur = filter && filter !== NONE_ID ? albumsById.get(filter) : null;
  if (cur) {
    html += `<div class="gl-album-head">
      <h2>${esc(cur.name)}</h2><span class="gl-count">${counts.get(cur.id)}장</span>
      ${canManage(cur) ? `<span class="gl-album-tools">
        <button type="button" class="btn-edit-ghost" data-rename-album="${esc(cur.id)}">${icPen} 이름 바꾸기</button>
        <button type="button" class="btn-edit-ghost" data-del-album="${esc(cur.id)}">${icTrash} 앨범 삭제</button>
      </span>` : ""}
    </div>`;
  }

  const shown = filterPhotos(photos, albums, filter);
  if (!shown.length) {
    html += `<p class="board-empty">${cur ? "이 앨범에는 아직 사진이 없습니다." : "아직 등록된 사진이 없습니다."}${isMember ? ' "사진 올리기"로 첫 사진을 올려 보세요.' : ""}</p>`;
    return html;
  }
  html += `<div class="gl-masonry">${shown.map((p, i) => itemHtml(p, i, albumsById, canEdit(p))).join("")}</div>`;
  return html;
}

// 올리기·수정 모달의 앨범 선택 칩 (다중 선택)
export function buildAlbumPicker(albums, selected = []) {
  if (!albums.length) return '<span class="hint">아직 앨범이 없어요. 아래에서 새 앨범을 만들어 보세요.</span>';
  const sel = new Set(selected);
  return albums.map((a) => `<button type="button" class="gl-pick${sel.has(a.id) ? " on" : ""}" data-pick="${esc(a.id)}" aria-pressed="${sel.has(a.id)}">#${esc(a.name)}</button>`).join("");
}
