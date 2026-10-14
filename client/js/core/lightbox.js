// Image lightbox with zoom, used for hazard photos.

let currentLightboxZoom = 1;

function openLightbox(url) {
  // The URL is also used as a download link, so script URLs are refused.
  if (!url || /^\s*(javascript|vbscript):/i.test(String(url))) return;
  const modal = document.getElementById('lightboxModal');
  const img = document.getElementById('lightboxImg');
  const dlBtn = document.getElementById('lightboxDownloadBtn');

  img.src = url;
  currentLightboxZoom = 1;
  img.style.transform = `scale(${currentLightboxZoom})`;

  dlBtn.onclick = () => {
    const a = document.createElement('a');
    a.href = url;
    a.download = url.split('/').pop() || 'hazard_photo.jpg';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  modal.style.display = 'flex';
}

function closeLightbox() {
  document.getElementById('lightboxModal').style.display = 'none';
  document.getElementById('lightboxImg').src = '';
}

function zoomInLightbox() {
  currentLightboxZoom += 0.25;
  document.getElementById('lightboxImg').style.transform = `scale(${currentLightboxZoom})`;
}

function zoomOutLightbox() {
  currentLightboxZoom = Math.max(0.25, currentLightboxZoom - 0.25);
  document.getElementById('lightboxImg').style.transform = `scale(${currentLightboxZoom})`;
}
