import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { CameraView } from './cameraViews'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Orbit camera with per-view rotation limits AND a hard interior clamp.
 *
 * Every preset (and every seat focus) defines position + target; on change the
 * camera tweens there with constraints temporarily relaxed, then tightens the
 * azimuth/polar window around the new viewpoint. On top of that, a bounding
 * box keeps BOTH the camera and its look-target inside the classroom walls at
 * all times — zoomed out, spun fast, flung on a phone, it doesn't matter: the
 * view can never leave the room, sit in the ceiling, or stare into the void.
 * Any user interaction cancels the flight instantly.
 */

// Room interior (walls x=±7.4, z=-8.6…+8.75, height 5) minus breathing room.
const POS_MIN = new THREE.Vector3(-6.8, 0.75, -7.9)
const POS_MAX = new THREE.Vector3(6.8, 4.45, 8.2)
const TGT_MIN = new THREE.Vector3(-6.2, 0.15, -7.9)
const TGT_MAX = new THREE.Vector3(6.2, 3.4, 8.2)

export function CameraRig({ view, reducedMotion }: { view: CameraView; reducedMotion: boolean }) {
  const controls = useRef<any>(null)
  const anim = useRef<CameraView | null>(null)
  const tmpA = useRef(new THREE.Vector3())
  const tmpB = useRef(new THREE.Vector3())

  const sphericalOf = (v: CameraView) => {
    const dx = v.position[0] - v.target[0]
    const dy = v.position[1] - v.target[1]
    const dz = v.position[2] - v.target[2]
    return { az: Math.atan2(dx, dz), polar: Math.atan2(Math.hypot(dx, dz), dy) }
  }

  const relax = () => {
    const c = controls.current
    if (!c) return
    c.minAzimuthAngle = -Infinity
    c.maxAzimuthAngle = Infinity
    c.minPolarAngle = 0.1
    c.maxPolarAngle = 1.52
  }

  const tighten = (az: number, polar: number) => {
    const c = controls.current
    if (!c) return
    c.minAzimuthAngle = az - 0.62
    c.maxAzimuthAngle = az + 0.62
    c.minPolarAngle = Math.max(0.55, polar - 0.28)
    c.maxPolarAngle = Math.min(1.52, polar + 0.28)
  }

  useEffect(() => {
    anim.current = view
    relax()
  }, [view])

  useFrame((state, delta) => {
    const c = controls.current
    if (!c) return

    const goal = anim.current
    if (goal) {
      if (reducedMotion) {
        state.camera.position.set(...goal.position)
        c.target.set(...goal.target)
        c.update()
        const s = sphericalOf(goal)
        tighten(s.az, s.polar)
        anim.current = null
        return
      }
      const k = 1 - Math.exp(-3.4 * delta)
      state.camera.position.lerp(tmpA.current.set(...goal.position), k)
      c.target.lerp(tmpB.current.set(...goal.target), k)
      c.update()
      if (state.camera.position.distanceTo(tmpA.current.set(...goal.position)) < 0.05) {
        state.camera.position.set(...goal.position)
        c.target.set(...goal.target)
        c.update()
        const s = sphericalOf(goal)
        tighten(s.az, s.polar)
        anim.current = null
      }
    }

    // Hard interior clamp — the last line of defence against void views.
    const p = state.camera.position
    p.x = THREE.MathUtils.clamp(p.x, POS_MIN.x, POS_MAX.x)
    p.y = THREE.MathUtils.clamp(p.y, POS_MIN.y, POS_MAX.y)
    p.z = THREE.MathUtils.clamp(p.z, POS_MIN.z, POS_MAX.z)
    const t = c.target
    t.x = THREE.MathUtils.clamp(t.x, TGT_MIN.x, TGT_MAX.x)
    t.y = THREE.MathUtils.clamp(t.y, TGT_MIN.y, TGT_MAX.y)
    t.z = THREE.MathUtils.clamp(t.z, TGT_MIN.z, TGT_MAX.z)
  })

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      enablePan={false}
      rotateSpeed={0.55}
      zoomSpeed={0.8}
      minDistance={3.2}
      maxDistance={12.5}
      onStart={() => {
        anim.current = null
      }}
      onEnd={() => {
        // Re-tighten the orbit window around wherever the user settled.
        const c = controls.current
        if (!c || anim.current) return
        const s = sphericalOf({
          position: [c.object.position.x, c.object.position.y, c.object.position.z],
          target: [c.target.x, c.target.y, c.target.z]
        })
        tighten(s.az, s.polar)
      }}
    />
  )
}
