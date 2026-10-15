import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { AvatarSpec } from '../types'

export type AvatarState = 'idle' | 'studying' | 'away' | 'distracted'

const skinGeo = new THREE.SphereGeometry(0.17, 20, 16)
const bodyGeo = new THREE.CapsuleGeometry(0.165, 0.24, 6, 14)
const armGeo = new THREE.CapsuleGeometry(0.05, 0.22, 4, 8)
const hairShortGeo = new THREE.SphereGeometry(0.185, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.62)
const hairLongBackGeo = new THREE.BoxGeometry(0.26, 0.34, 0.1)
const bunGeo = new THREE.SphereGeometry(0.075, 12, 10)
const eyeGeo = new THREE.SphereGeometry(0.018, 8, 8)
const eyeMat = new THREE.MeshStandardMaterial({ color: '#292D27', roughness: 0.4 })
const pageMat = new THREE.MeshStandardMaterial({ color: '#FBF6EA', roughness: 0.9 })
const coverMat = new THREE.MeshStandardMaterial({ color: '#244B38', roughness: 0.8 })

/**
 * Lightweight stylized avatar in a sitting pose, animated from the person's
 * actual backend status: studying (lean + write bob), idle (soft sway),
 * away (slouched + dimmed, never faked as studying).
 */
export function StudentAvatar({
  avatar,
  state,
  seed,
  reducedMotion
}: {
  avatar: AvatarSpec
  state: AvatarState
  seed: number
  reducedMotion: boolean
}) {
  const group = useRef<THREE.Group>(null)
  const head = useRef<THREE.Group>(null)

  const mats = useMemo(() => {
    const dim = state === 'away'
    const make = (color: string, rough = 0.75) =>
      new THREE.MeshStandardMaterial({ color, roughness: rough, transparent: dim, opacity: dim ? 0.45 : 1 })
    return { skin: make(avatar.skin, 0.65), hair: make(avatar.hair, 0.7), shirt: make(avatar.shirt, 0.85), dim }
  }, [avatar, state])

  const slouched = state === 'away' || state === 'distracted'

  useFrame(({ clock }) => {
    if (reducedMotion) return
    const t = clock.elapsedTime + seed * 1.7
    const g = group.current
    const h = head.current
    if (!g || !h) return
    if (state === 'studying') {
      g.rotation.x = THREE.MathUtils.lerp(g.rotation.x, -0.3, 0.08)
      h.position.y = 0.7 + Math.sin(t * 2.4) * 0.012
      h.rotation.z = Math.sin(t * 1.3) * 0.04
    } else if (state === 'idle') {
      g.rotation.x = THREE.MathUtils.lerp(g.rotation.x, -0.05, 0.06)
      h.position.y = 0.7 + Math.sin(t * 1.1) * 0.01
      h.rotation.z = Math.sin(t * 0.7) * 0.05
    } else {
      // away / distracted: slouched back — visibly not accruing
      g.rotation.x = THREE.MathUtils.lerp(g.rotation.x, 0.14, 0.05)
      h.rotation.z = state === 'distracted' ? Math.sin(t * 0.9) * 0.08 : 0
    }
  })

  const showBook = state !== 'away' && state !== 'distracted'

  return (
    <group ref={group} position={[0, 0.47, 0]} rotation={[state === 'studying' ? -0.3 : 0, 0, 0]}>
      {/* torso (sitting) */}
      <mesh geometry={bodyGeo} material={mats.shirt} position={[0, 0.26, 0]} castShadow={!mats.dim} />

      {/* head */}
      <group ref={head} position={[0, 0.7, 0]}>
        <mesh geometry={skinGeo} material={mats.skin} castShadow={!mats.dim} />
        {/* hair variants */}
        {avatar.hairStyle !== 'side' && (
          <mesh geometry={hairShortGeo} material={mats.hair} position={[0, 0.02, 0]} rotation={[-0.25, 0, 0]} />
        )}
        {avatar.hairStyle === 'side' && (
          <mesh
            geometry={hairShortGeo}
            material={mats.hair}
            position={[0.035, 0.015, 0]}
            rotation={[-0.2, 0, -0.28]}
            scale={[1.05, 1, 1.05]}
          />
        )}
        {avatar.hairStyle === 'long' && (
          <mesh geometry={hairLongBackGeo} material={mats.hair} position={[0, -0.13, 0.14]} rotation={[0.12, 0, 0]} />
        )}
        {avatar.hairStyle === 'bun' && (
          <mesh geometry={bunGeo} material={mats.hair} position={[0, 0.19, 0.06]} />
        )}
        {/* eyes — students face the blackboard (-z) */}
        <mesh geometry={eyeGeo} material={eyeMat} position={[-0.06, -0.01, -0.155]} />
        <mesh geometry={eyeGeo} material={eyeMat} position={[0.06, -0.01, -0.155]} />
      </group>

      {/* arms — resting toward the desk when present */}
      <mesh
        geometry={armGeo}
        material={mats.shirt}
        position={[-0.21, 0.32, slouched ? 0.02 : -0.1]}
        rotation={[slouched ? -0.2 : -0.95, 0, 0.25]}
      />
      <mesh
        geometry={armGeo}
        material={mats.shirt}
        position={[0.21, 0.32, slouched ? 0.02 : -0.1]}
        rotation={[slouched ? -0.2 : -0.95, 0, -0.25]}
      />

      {/* open notebook while engaged */}
      {showBook && (
        <group position={[0, 0.285, -0.3]} rotation={[-0.18, 0, 0]}>
          <mesh material={coverMat}>
            <boxGeometry args={[0.42, 0.012, 0.3]} />
          </mesh>
          <mesh material={pageMat} position={[0, 0.008, 0]}>
            <boxGeometry args={[0.39, 0.008, 0.27]} />
          </mesh>
        </group>
      )}
    </group>
  )
}
