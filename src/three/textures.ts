import * as THREE from 'three'

let cachedBoard: { key: string; texture: THREE.CanvasTexture } | null = null

/** Chalkboard texture with the classroom name, drawn on a canvas (no external assets). */
export function makeBlackboardTexture(roomName: string): THREE.CanvasTexture {
  const key = roomName
  if (cachedBoard?.key === key) return cachedBoard.texture

  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 400
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D

  // Board base
  ctx.fillStyle = '#2E4A3C'
  ctx.fillRect(0, 0, 1024, 400)
  // Faint chalk dust smudges
  ctx.globalAlpha = 0.05
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = i % 2 ? '#FFFFFF' : '#DCE8DF'
    ctx.beginPath()
    ctx.ellipse(Math.random() * 1024, Math.random() * 400, 40 + Math.random() * 90, 10 + Math.random() * 26, Math.random() * 3, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1

  // Sun doodle
  ctx.strokeStyle = 'rgba(244,235,221,0.85)'
  ctx.lineWidth = 5
  ctx.beginPath()
  ctx.arc(90, 76, 30, 0, Math.PI * 2)
  ctx.stroke()
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    ctx.beginPath()
    ctx.moveTo(90 + Math.cos(a) * 40, 76 + Math.sin(a) * 40)
    ctx.lineTo(90 + Math.cos(a) * 54, 76 + Math.sin(a) * 54)
    ctx.stroke()
  }

  // Headings
  ctx.fillStyle = 'rgba(244,235,221,0.95)'
  ctx.font = '700 96px ui-rounded, "Comic Sans MS", "Segoe Print", cursive, sans-serif'
  ctx.fillText('AVHIFocus', 170, 130)

  ctx.font = '600 46px ui-rounded, "Comic Sans MS", cursive, sans-serif'
  ctx.fillStyle = 'rgba(167,185,154,0.95)'
  const name = roomName.length > 22 ? roomName.slice(0, 22) + '…' : roomName
  ctx.fillText(name, 176, 205)

  ctx.font = '500 38px ui-rounded, "Comic Sans MS", cursive, sans-serif'
  ctx.fillStyle = 'rgba(215,122,74,0.95)'
  ctx.fillText('50 min focus   ·   10 min break', 176, 285)
  ctx.fillStyle = 'rgba(244,235,221,0.6)'
  ctx.font = '400 32px ui-rounded, "Comic Sans MS", cursive, sans-serif'
  ctx.fillText('quiet, steady, together', 176, 345)

  // Underline flourish
  ctx.strokeStyle = 'rgba(244,235,221,0.5)'
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.moveTo(170, 155)
  ctx.quadraticCurveTo(420, 172, 640, 152)
  ctx.stroke()

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  cachedBoard = { key, texture }
  return texture
}
