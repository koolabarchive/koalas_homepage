// 연구참여확인서 PDF 생성 (관리자·멤버 공용)
// html2pdf(html2canvas + jsPDF)로 브라우저가 렌더링한 한글을 그대로 PDF화합니다.
// 사용: generateCertificatePDF({ certNo, name, affiliation, projectTitle, role, period, issuedDate })
// 직인: images/stamp.png 파일을 두면 서명 옆에 표시됩니다. 없으면 (인)으로 표기됩니다.

window.generateCertificatePDF = async function (cert) {
  if (typeof html2pdf === "undefined") {
    alert("PDF 모듈을 불러오지 못했습니다. 네트워크 연결을 확인해 주세요.");
    return;
  }

  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const el = document.createElement("div");
  el.style.cssText = "position:fixed; left:-9999px; top:0;";
  el.innerHTML = `
    <div style="width:210mm; min-height:297mm; box-sizing:border-box; padding:28mm 24mm;
                font-family:'Pretendard Variable', Pretendard, sans-serif; color:#212b36; background:#fff;">

      <div style="font-size:11pt; margin-bottom:14mm;">발급번호: ${esc(cert.certNo)}</div>

      <h1 style="text-align:center; font-size:26pt; font-weight:800; letter-spacing:0.35em;
                 margin:0 0 16mm; text-indent:0.35em;">연구참여확인서</h1>

      <table style="width:100%; border-collapse:collapse; font-size:12pt; margin-bottom:14mm;">
        <tr>
          <td style="border:1px solid #212b36; background:#f1f1ec; width:34mm; padding:5mm 4mm; font-weight:700; text-align:center;">성명</td>
          <td style="border:1px solid #212b36; padding:5mm 5mm;">${esc(cert.name)}</td>
        </tr>
        <tr>
          <td style="border:1px solid #212b36; background:#f1f1ec; padding:5mm 4mm; font-weight:700; text-align:center;">소속</td>
          <td style="border:1px solid #212b36; padding:5mm 5mm;">${esc(cert.affiliation)}</td>
        </tr>
        <tr>
          <td style="border:1px solid #212b36; background:#f1f1ec; padding:5mm 4mm; font-weight:700; text-align:center;">연구과제명</td>
          <td style="border:1px solid #212b36; padding:5mm 5mm;">${esc(cert.projectTitle)}</td>
        </tr>
        <tr>
          <td style="border:1px solid #212b36; background:#f1f1ec; padding:5mm 4mm; font-weight:700; text-align:center;">참여 기간</td>
          <td style="border:1px solid #212b36; padding:5mm 5mm;">${esc(cert.period)}</td>
        </tr>
        <tr>
          <td style="border:1px solid #212b36; background:#f1f1ec; padding:5mm 4mm; font-weight:700; text-align:center;">참여 역할</td>
          <td style="border:1px solid #212b36; padding:5mm 5mm;">${esc(cert.role)}</td>
        </tr>
      </table>

      <p style="font-size:13pt; line-height:2.1; text-align:center; margin:0 0 22mm;">
        위 사람은 본 연구실에서 수행한 상기 연구과제에<br />
        위와 같이 참여하였음을 확인합니다.
      </p>

      <p style="text-align:center; font-size:12pt; margin:0 0 18mm;">${esc(cert.issuedDate)}</p>

      <div style="text-align:center; font-size:14pt; font-weight:700; line-height:2;">
        한신대학교 심리학과 임상심리 연구실<br />
        <span style="position:relative; display:inline-block; margin-top:4mm;">
          지도교수&nbsp;&nbsp;구&nbsp;훈&nbsp;정&nbsp;&nbsp;<span id="cert-seal-fallback">(인)</span>
          <img src="images/stamp.png" alt=""
               style="position:absolute; right:-6mm; top:-7mm; width:20mm; height:20mm; opacity:0.9;"
               onerror="this.remove();"
               onload="var f=document.getElementById('cert-seal-fallback'); if(f) f.style.visibility='hidden';" />
        </span>
      </div>

      <p style="position:absolute; bottom:0; left:0; right:0; transform:translateY(240mm);"></p>
      <p style="margin-top:24mm; padding-top:4mm; border-top:1px solid #c9c7c0;
                font-size:9pt; color:#5f6a75; text-align:center;">
        본 확인서의 진위 여부는 발급번호를 통해 한신대학교 임상심리 연구실로 문의하여 확인할 수 있습니다.
      </p>
    </div>`;

  document.body.appendChild(el);

  try {
    await html2pdf()
      .set({
        margin: 0,
        filename: `연구참여확인서_${cert.name}_${cert.certNo}.pdf`,
        image: { type: "jpeg", quality: 0.97 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      })
      .from(el.firstElementChild)
      .save();
  } finally {
    el.remove();
  }
};
