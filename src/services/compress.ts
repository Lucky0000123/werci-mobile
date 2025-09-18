// Simple image compression using canvas
export async function compressDataUrl(dataUrl: string, quality = 0.75, maxW = 1280, maxH = 1280) {
  const img = new Image()
  img.src = dataUrl
  await img.decode()
  let { width, height } = img
  const ratio = Math.min(1, maxW / width, maxH / height)
  width = Math.round(width * ratio)
  height = Math.round(height * ratio)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0, width, height)
  const out = canvas.toDataURL('image/jpeg', quality)
  const comp = await getSize(out)
  const orig = await getSize(dataUrl)
  return { dataUrl: out, compressionRatio: orig > 0 ? comp / orig : 1 }
}

async function getSize(dataUrl: string) {
  const b64 = dataUrl.split(',')[1] || ''
  return Math.ceil((b64.length * 3) / 4)
}

