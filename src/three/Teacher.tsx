import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { VisibleHtml } from './VisibleHtml'
import * as THREE from 'three'
import type { Phase } from '../types'

/**
 * The teacher — a permanent fixture at the front desk. They keep the shared
 * clock running: quietly reading over the class during focus, and waving
 * everyone up for a stretch during breaks. Purely presentational; never a
 * leaderboard or membership entity.
 */

const TEACHER = {
  skin: '#E0AC7E',
  hair: '#8A8F96',
  shirt: '#244B38',
  dress: '#315C46'
}

const legGeo = new THREE.CylinderGeometry(0.07, 0.085, 0.74, 10)
const bodyGeo = new THREE.CapsuleGeometry(0.21, 0.5, 6, 16)
const armGeo = new THREE.CapsuleGeometry(0.055, 0.3, 4, 10)
const headGeo = new THREE.SphereGeometry(0.18, 22, 18)
const hairCapGeo = new THREE.SphereGeometry(0.19, 22, 16, 0, Math.PI * 2, 0, Math.PI * 0.58)
const bunGeo = new THREE.SphereGeometry(0.08, 14, 12)
const eyeGeoT = new THREE.SphereGeometry(0.02, 8, 8)
const glassesGeo = new THREE.TorusGeometry(0.052, 0.0075, 8, 20)
const bridgeGeo = new THREE.BoxGeometry(0.045, 0.008, 0.008)
const bookCoverGeo = new THREE.BoxGeometry(0.36, 0.045, 0.26)
const bookPageGeo = new THREE.BoxGeometry(0.33, 0.05, 0.225)
const chalkGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.09, 6)

export function Teacher({ phase, reducedMotion }: { phase: Phase; reducedMotion: boolean }) {
  const body = useRef<THREE.Group>(null)
  const head = useRef<THREE.Group>(null)
  const rightArm = useRef<THREE.Mesh>(null)
  const book = useRef<THREE.Group>(null)

  const mats = useMemo(
    () => ({
      skin: new THREE.MeshStandardMaterial({ color: TEACHER.skin, roughness: 0.65 }),
      hair: new THREE.MeshStandardMaterial({ color: TEACHER.hair, roughness: 0.75 }),
      shirt: new THREE.MeshStandardMaterial({ color: TEACHER.shirt, roughness: 0.85 }),
      dark: new THREE.MeshStandardMaterial({ color: '#292D27', roughness: 0.4 }),
      page: new THREE.MeshStandardMaterial({ color: '#FBF6EA', roughness: 0.9 }),
      chalk: new THREE.MeshStandardMaterial({ color: '#F4EBDD', roughness: 0.6 })
    }),
    []
  )

  const isBreak = phase === 'break'

  useFrame(({ clock }) => {
    if (reducedMotion) return
    const t = clock.elapsedTime
    if (body.current) {
      // gentle standing sway
      body.current.rotation.z = Math.sin(t * 0.55) * 0.018
      body.current.position.y = Math.sin(t * 1.1) * 0.006
    }
    if (head.current) {
      // reading over the book during focus; looking up at the class on break
      const targetPitch = isBreak ? -0.06 : 0.22 + Math.sin(t * 0.9) * 0.02
      head.current.rotation.x = THREE.MathUtils.lerp(head.current.rotation.x, targetPitch, 0.06)
      head.current.rotation.y = isBreak ? Math.sin(t * 0.4) * 0.28 : Math.sin(t * 0.22) * 0.1
    }
    if (rightArm.current) {
      // waves everyone to stretch during the break
      if (isBreak) {
        rightArm.current.rotation.z = 2.35 + Math.sin(t * 3.4) * 0.3
        rightArm.current.rotation.x = 0.15
      } else {
        rightArm.current.rotation.z = THREE.MathUtils.lerp(rightArm.current.rotation.z, 0.35, 0.08)
        rightArm.current.rotation.x = THREE.MathUtils.lerp(rightArm.current.rotation.x, 0.92, 0.08)
      }
    }
    if (book.current) {
      // book raised while reading, set down on the desk during break
      const targetY = isBreak ? 0.72 : 0.98
      book.current.position.y = THREE.MathUtils.lerp(book.current.position.y, targetY, 0.08)
      book.current.rotation.x = THREE.MathUtils.lerp(book.current.rotation.x, isBreak ? -0.55 : -0.18, 0.08)
      book.current.visible = book.current.position.y > 0.78
    }
  })

  return (
    <group position={[0, 0, -7.82]}>
      {/* legs skipped below desk line; desk occludes them */}
      <group ref={body}>
        {/* dress */}
        <mesh geometry={bodyGeo} material={mats.shirt} position={[0, 1.0, 0]} castShadow />

        {/* head */}
        <group ref={head} position={[0, 1.6, 0]}>
          <mesh geometry={headGeo} material={mats.skin} castShadow />
          <mesh geometry={hairCapGeo} material={mats.hair} position={[0, 0.02, -0.01]} rotation={[0.22, 0, 0]} />
          <mesh geometry={bunGeo} material={mats.hair} position={[0, 0.17, -0.09]} />
          {/* eyes (teacher faces the class, +z) */}
          <mesh geometry={eyeGeoT} material={mats.dark} position={[-0.06, 0.005, 0.162]} />
          <mesh geometry={eyeGeoT} material={mats.dark} position={[0.06, 0.005, 0.162]} />
          {/* friendly half-moon glasses */}
          <mesh geometry={glassesGeo} material={mats.dark} position={[-0.06, 0.008, 0.168]} />
          <mesh geometry={glassesGeo} material={mats.dark} position={[0.06, 0.008, 0.168]} />
          <mesh geometry={bridgeGeo} material={mats.dark} position={[0, 0.008, 0.172]} />
          {/* warm smile */}
          <mesh position={[0, -0.065, 0.16]} rotation={[Math.PI / 2.6, 0, 0]}>
            <torusGeometry args={[0.035, 0.007, 8, 16, Math.PI]} />
            <meshStandardMaterial color="#8D5A34" roughness={0.6} />
          </mesh>
        </group>

        {/* left arm — steady on the book */}
        <mesh
          geometry={armGeo}
          material={mats.shirt}
          position={[-0.24, 1.12, 0.03]}
          rotation={[0.95, 0, -0.32]}
        />
        {/* right arm — reading pose or waving */}
        <mesh
          ref={rightArm}
          geometry={armGeo}
          material={mats.shirt}
          position={[0.24, 1.12, 0.03]}
          rotation={[0.92, 0, 0.35]}
        />
        {/* chalk in right hand during focus */}
        <mesh geometry={chalkGeo} material={mats.chalk} position={[0.28, 0.98, 0.2]} rotation={[1.2, 0, 0.2]} />
      </group>

      {/* book held/lowered */}
      <group ref={book} position={[0, 0.98, 0.24]} rotation={[-0.18, 0, 0]}>
        <mesh geometry={bookCoverGeo} material={mats.dark} />
        <mesh geometry={bookPageGeo} material={mats.page} position={[0, 0.005, 0]} />
      </group>

      {/* floating label — screen-space (never mirrored from any angle) and
          auto-hidden the moment the anchor leaves the viewport */}
      <VisibleHtml position={[0, 2.12, 0]} center occlude={false}>
        <div
          className={`flex select-none items-center gap-1.5 whitespace-nowrap rounded-2xl border-2 px-3 py-1.5 shadow-card backdrop-blur-sm ${
            isBreak ? 'border-sagedeep/50 bg-sage/25' : 'border-forest/60 bg-cream/95'
          }`}
        >
          <span className={`inline-block h-2 w-2 rounded-full ${isBreak ? 'bg-sagedeep' : 'bg-forest'}`} />
          <span className="text-[11px] font-bold leading-none text-ink">Teacher</span>
          <span className="text-[10px] font-medium leading-none text-inksoft">
            {isBreak ? 'stretch time, everyone' : 'keeping time · shhh'}
          </span>
        </div>
      </VisibleHtml>
    </group>
  )
}
