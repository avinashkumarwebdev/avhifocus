import { Suspense, useMemo, useState, useEffect } from 'react'
import { Canvas } from '@react-three/fiber'
import type { MemberView, Phase } from '../types'
import { RoomShell } from './RoomShell'
import { Bench, CAPACITY, seatPosition } from './Bench'
import { Teacher } from './Teacher'
import { CameraRig } from './CameraRig'
import { DEFAULT_VIEW, type CameraView } from './cameraViews'
import { Spinner } from '../components/ui'

export function seatFocusView(seat: number): CameraView {
  const [x, , z] = seatPosition(seat)
  // approach from the centre aisle side, above desk height — never head-on
  // through another student and never inside the bench itself
  const side = x < 0 ? 0.95 : -0.95
  return {
    position: [x + side * 2.4, 3.1, z + 4.4],
    target: [x, 0.9, z + 0.1]
  }
}

export function detectWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return !!(canvas.getContext('webgl2') ?? canvas.getContext('webgl'))
  } catch {
    return false
  }
}

/** Pause the render loop while the tab is hidden — big battery/CPU saver. */
function useFrameloopPauseOnTab(setHidden: (h: boolean) => void) {
  useEffect(() => {
    const onVis = () => setHidden(document.hidden)
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [setHidden])
}

/**
 * One-time GPU tier probe. Phones run at clamped DPR with light shadows;
 * anything that hovers on hi-DPI + big shadow maps stutters otherwise.
 */
export function detectQuality(): 'high' | 'low' {
  try {
    const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches
    const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
    const dpr = window.devicePixelRatio || 1
    if (coarse || (typeof mem === 'number' && mem > 0 && mem < 4) || dpr > 2.75) return 'low'
  } catch {
    /* assume high on unknown */
  }
  return 'high'
}

export function ClassroomScene({
  roomName,
  members,
  mySeat,
  selectedSeat,
  onSelectSeat,
  nowMs,
  reducedMotion,
  phase,
  view
}: {
  roomName: string
  members: MemberView[]
  mySeat: number | null
  selectedSeat: number | null
  onSelectSeat: (seat: number | null) => void
  nowMs: number
  reducedMotion: boolean
  phase: Phase
  /** Resolved camera view (preset or seat focus) supplied by the page. */
  view: CameraView
}) {
  const [ready, setReady] = useState(false)
  const [sheetHidden, setSheetHidden] = useState(false)

  useFrameloopPauseOnTab(setSheetHidden)

  const quality = useMemo(detectQuality, [])
  const low = quality === 'low'

  const bySeat = useMemo(() => {
    const map = new Map<number, MemberView>()
    for (const m of members) map.set(m.seatNumber, m)
    return map
  }, [members])

  return (
    <div className="relative h-full w-full">
      {!ready && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-cream">
          <Spinner label="Preparing your classroom…" />
        </div>
      )}
        <Canvas
        shadows={!low}
        dpr={low ? [1, 1.15] : [1, 1.75]}
        camera={{ position: DEFAULT_VIEW.position, fov: 42, near: 0.1, far: 60 }}
        gl={{
          antialias: !low,
          powerPreference: 'high-performance'
        }}
        frameloop={sheetHidden ? 'never' : 'always'}
        onCreated={() => setReady(true)}
        onPointerMissed={() => onSelectSeat(null)}
      >
        <color attach="background" args={['#F0E7D5']} />
        <fog attach="fog" args={['#F0E7D5', 20, 38]} />

        {/* warm daylight through the right-hand windows */}
        <hemisphereLight args={['#FFF4E0', '#8B7B68', 0.5]} />
        <ambientLight intensity={0.35} color="#FFEEDD" />
        <directionalLight
          position={[9, 8, 2]}
          intensity={1.5}
          color="#FFD9A4"
          castShadow
          shadow-mapSize-width={low ? 512 : 1024}
          shadow-mapSize-height={low ? 512 : 1024}
          shadow-camera-left={-10}
          shadow-camera-right={10}
          shadow-camera-top={10}
          shadow-camera-bottom={-10}
          shadow-camera-far={30}
          shadow-bias={-0.0004}
        />
        <directionalLight position={[-6, 6, 8]} intensity={0.25} color="#DDE8D8" />

        <Suspense fallback={null}>
          <RoomShell roomName={roomName} />
          <Teacher phase={phase} reducedMotion={reducedMotion} />
          {Array.from({ length: CAPACITY }, (_, i) => i + 1).map((seat) => (
            <Bench
              key={seat}
              seat={seat}
              member={bySeat.get(seat) ?? null}
              isMe={seat === mySeat}
              isSelected={seat === selectedSeat}
              nowMs={nowMs}
              reducedMotion={reducedMotion}
              onSelect={(s) => onSelectSeat(s)}
            />
          ))}
        </Suspense>

        <CameraRig view={view} reducedMotion={reducedMotion} />
      </Canvas>
    </div>
  )
}