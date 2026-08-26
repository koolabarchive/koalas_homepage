// 초경량 마크다운 렌더러 — 프로젝트 소개 등 서식 있는 텍스트용
// 외부 라이브러리 없이 안전하게(XSS 방지: 모든 입력을 먼저 이스케이프) 동작합니다.
// 지원 문법: # ## ### 제목 / **굵게** / *기울임* / `코드` / [텍스트](https://링크) / ![설명](이미지)
//           - 목록 / 1. 번호 목록 / > 인용 / --- 구분선 / 빈 줄 = 문단

export function renderMarkdown(src) {
  if (!src) return "";
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  // 인라인 서식 (이미 이스케이프된 텍스트에 적용)
  const inline = (s) => s
    .replace(/!\[([^\]]*)\]\((data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+|https?:\/\/[^)\s]+)\)/g,
      '<img alt="$1" src="$2" loading="lazy">')
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    // 사이트 내부 페이지 링크: [텍스트](research.html), [텍스트](notice.html#post=…)
    .replace(/\[([^\]]+)\]\(([\w-]+\.html(?:[?#][^)\s]*)?)\)/g, '<a href="$2">$1</a>');

  const lines = esc(src).split(/\r?\n/);
  const out = [];
  let list = null;      // 'ul' | 'ol' | null
  let para = [];

  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const closePara = () => {
    if (para.length) { out.push("<p>" + para.map(inline).join("<br>") + "</p>"); para = []; }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const t = line.trim();

    if (!t) { closePara(); closeList(); continue; }

    const h = /^(#{1,3})\s+(.*)$/.exec(t);
    if (h) { closePara(); closeList(); out.push(`<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`); continue; }

    if (/^(-{3,}|\*{3,})$/.test(t)) { closePara(); closeList(); out.push("<hr>"); continue; }

    const q = /^&gt;\s?(.*)$/.exec(t);
    if (q) { closePara(); closeList(); out.push(`<blockquote>${inline(q[1])}</blockquote>`); continue; }

    const ul = /^[-*]\s+(.*)$/.exec(t);
    if (ul) {
      closePara();
      if (list !== "ul") { closeList(); out.push("<ul>"); list = "ul"; }
      out.push(`<li>${inline(ul[1])}</li>`);
      continue;
    }
    const ol = /^\d+[.)]\s+(.*)$/.exec(t);
    if (ol) {
      closePara();
      if (list !== "ol") { closeList(); out.push("<ol>"); list = "ol"; }
      out.push(`<li>${inline(ol[1])}</li>`);
      continue;
    }

    closeList();
    para.push(t);
  }
  closePara();
  closeList();
  return out.join("\n");
}
