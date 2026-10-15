import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import type { MemberView } from '../types'
import { StudentAvatar } from './StudentAvatar'

/* Fixed classroom layout: two columns × five rows, facing the blackboard. */
export const CAPACITY = 10
export function seatPosition(seat: number): [number, number, number] {
  const index = seat - 1
  const col = index % 2
  const row = Math.floor(index / 2)
  return [col === 0 ? -2.7 : 2.7, 0, -4.2 + row * 2.4]
}

const wood = new THREE.MeshStandardMaterial({ color: '#8B6345', roughness: 0.72 })
const woodAlt = new THREE.MeshStandardMaterial({ color: '#96704B', roughness: 0.72 })
const chairMat = new THREE.MeshStandardMaterial({ color: '#6E4E36', roughness: 0.8 })
const laptopBody = new THREE.MeshStandardMaterial({ color: '#3A3F45', roughness: 0.45, metalness: 0.35 })
const laptopScreenOn = new THREE.MeshStandardMaterial({ color: '#E9F0E4', emissive: '#BFD4AE', emissiveIntensity: 0.75 })
const laptopScreenOff = new THREE.MeshStandardMaterial({ color: '#2E332F', roughness: 0.5 })
const cupMat = new THREE.MeshStandardMaterial({ color: '#D77A4A', roughness: 0.8 })
const book1 = new THREE.MeshStandardMaterial({ color: '#5F7A5E', roughness: 0.85 })
const book2 = new THREE.MeshStandardMaterial({ color: '#D9B44A', roughness: 0.85 })
const ringMatFree = new THREE.MeshBasicMaterial({ color: '#A7B99A', transparent: true, opacity: 0.55 })
const ringMatSel = new THREE.MeshBasicMaterial({ color: '#D77A4A', transparent: true, opacity: 0.4 })

const deskTopGeo = new THREE.BoxGeometry(1.7, 0.09, 0.85)
const deskPanelGeo = new THREE.BoxGeometry(0.07, 0.68, 0.78)
const deskShelfGeo = new THREE.BoxGeometry(1.5, 0.05, 0.55)
const chairSeatGeo = new THREE.BoxGeometry(0.6, 0.07, 0.58)
const chairBackGeo = new THREE.BoxGeometry(0.6, 0.56, 0.07)
const chairLegGeo = new THREE.BoxGeometry(0.06, 0.45, 0.06)
const laptopBaseGeo = new THREE.BoxGeometry(0.46, 0.025, 0.32)
const laptopScreenGeo = new THREE.BoxGeometry(0.46, 0.3, 0.02)
const bookGeo = new THREE.BoxGeometry(0.34, 0.05, 0.24)
const pencilGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.14, 6)
const cupGeo = new THREE.CylinderGeometry(0.05, 0.045, 0.12, 10)
const ringGeo = new THREE.TorusGeometry(1.15, 0.035, 8, 40)

function formatFocused(startMs: number, nowMs: number): string {
  const s = Math.max(0, Math.floor((nowMs - startMs) / 1000))
  if (s < 60) return '<1m'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`
}

export function Bench({
  seat,
  member,
  isMe,
  isSelected,
  nowMs,
  reducedMotion,
  onSelect
}: {
  seat: number
  member: MemberView | null
  isMe: boolean
  isSelected: boolean
  nowMs: number
  reducedMotion: boolean
  onSelect: (seat: number) => void
}) {
  const [x, , z] = seatPosition(seat)
  const freeRing = useRef<THREE.Mesh>(null)

  useFrame(({ clock }) => {
    const ring = freeRing.current
    if (!ring || reducedMotion) return
    const s = 1 + Math.sin(clock.elapsedTime * 1.6 + seat) * 0.045
    ring.scale.setScalar(s)
  })

  const studying = member?.status === 'studying'
  const away = member != null && !member.online
  const paused = member?.pulsePaused === true && studying === true

  return (
    <group position={[x, 0, z]}>
      <group
        onClick={(e) => {
          e.stopPropagation()
          onSelect(seat)
        }}
        onPointerOver={() => (document.body.style.cursor = 'pointer')}
        onPointerOut={() => (document.body.style.cursor = 'auto')}
      >
      {/* desk */}
      <mesh geometry={deskTopGeo} material={seat % 2 ? wood : woodAlt} position={[0, 0.74, 0]} castShadow receiveShadow />
      <mesh geometry={deskPanelGeo} material={chairMat} position={[-0.79, 0.37, 0]} />
      <mesh geometry={deskPanelGeo} material={chairMat} position={[0.79, 0.37, 0]} />
      <mesh geometry={deskShelfGeo} material={chairMat} position={[0, 0.34, 0.05]} />

      {/* chair */}
      <group position={[0, 0, member ? 0.82 : 0.62]}>
        <mesh geometry={chairSeatGeo} material={chairMat} position={[0, 0.46, 0]} castShadow />
        <mesh geometry={chairBackGeo} material={chairMat} position={[0, 0.78, 0.28]} castShadow />
        {[[-0.24, -0.2], [0.24, -0.2], [-0.24, 0.2], [0.24, 0.2]].map(([lx, lz], i) => (
          <mesh key={i} geometry={chairLegGeo} material={chairMat} position={[lx, 0.225, lz]} />
        ))}
      </group>

      {/* desktop items */}
      <mesh geometry={bookGeo} material={book1} position={[-0.52, 0.81, -0.12]} rotation={[0, 0.12, 0]} />
      <mesh geometry={bookGeo} material={book2} position={[-0.5, 0.86, -0.1]} rotation={[0, -0.08, 0]} />
      <mesh geometry={cupGeo} material={cupMat} position={[0.6, 0.845, -0.2]} />
      {[0, 1, 2].map((i) => (
        <mesh key={i} geometry={pencilGeo} material={book2} position={[0.58 + i * 0.025, 0.93, -0.2 + (i % 2) * 0.02]} rotation={[0.12 * (i - 1), 0, 0.1 * (i - 1)]} />
      ))}

      {/* laptop for occupied seats */}
      {member && (
        <group position={[0.16, 0.8, 0.02]} rotation={[0, -0.08, 0]}>
          <mesh geometry={laptopBaseGeo} material={laptopBody} position={[0, 0.013, 0]} />
          <mesh
            geometry={laptopScreenGeo}
            material={studying ? laptopScreenOn : laptopScreenOff}
            position={[0, 0.16, -0.145]}
            rotation={[-0.32, 0, 0]}
          />
        </group>
      )}

      {/* pupil */}
      {member && (
        <group position={[0, 0.05, 0.82]}>
          <StudentAvatar
            avatar={member.avatar}
            state={away ? 'away' : paused ? 'distracted' : studying ? 'studying' : 'idle'}
            seed={seat}
            reducedMotion={reducedMotion}
          />
        </group>
      )}

      {/* floor rings */}
      {isSelected && (
        <mesh geometry={ringGeo} material={ringMatSel} position={[0, 0.03, 0.3]} rotation={[-Math.PI / 2, 0, 0]} />
      )}
      {!member && (
        <mesh ref={freeRing} geometry={ringGeo} material={ringMatFree} position={[0, 0.025, 0.3]} rotation={[-Math.PI / 2, 0, 0]} scale={[0.82, 0.82, 0.82]} />
      )}
      </group>

      {/* floating label (outside raycast group — display only) */}
      <Html
        position={[0, member ? 1.95 : 1.35, 0.4]}
        center
        zIndexRange={[30, 0]}
        wrapperClass="pointer-events-none"
        occlude={false}
      >
        {member ? (
          <div
            className={`flex select-none flex-col items-center gap-0.5 whitespace-nowrap rounded-2xl px-3 py-1.5 text-center shadow-card backdrop-blur-sm transition-colors ${
              isMe ? 'border-2 border-forest bg-cream/95' : 'border border-wood/15 bg-cream/90'
            } ${isSelected ? 'ring-2 ring-terra/60' : ''}`}
          >
            <span className="flex items-center gap-1.5 text-[11px] font-bold leading-none text-ink">
              <span
                className={`inline-block h-2 w-2 rounded-full ${away ? 'bg-ink/30' : studying ? 'bg-terra' : 'bg-sage'}`}
              />
              {isMe ? 'You · ' : ''}
              {member.displayName.split(' ')[0]}
              <span className="font-semibold text-inksoft/70">{member.classLabel}</span>
            </span>
            <span className="text-[10px] font-medium leading-none text-inksoft">
              {away
                ? studying
                  ? 'away — session held'
                  : 'away'
                : paused
                  ? 'paused 💤 — nothing accruing'
                  : studying
                    ? `focusing · ${formatFocused(member.sessionStartedAtMs as number, nowMs)}`
                    : 'resting'}
            </span>
          </div>
        ) : (
          <div className="select-none whitespace-nowrap rounded-full border border-dashed border-sagedeep/50 bg-cream/70 px-3 py-1 text-[10px] font-semibold text-sagedeep">
            Seat {seat} — open
          </div>
        )}
      </Html>
    </group>
  )
}
