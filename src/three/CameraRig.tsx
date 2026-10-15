import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { CameraView } from './cameraViews'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Orbit camera with per-view rotation limits.
 *
 * Every preset (and every seat focus) defines position + target; on change the
 * camera tweens there with constraints temporarily relaxed, then tightens the
 * azimuth/polar window around the new viewpoint — so users get freedom to look
 * around from anywhere, without ever ending up under the floor or lost behind
 * a wall. Any user interaction cancels the flight instantly.
 */
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
    c.minPolarAngle = 0.05
    c.maxPolarAngle = 1.55
  }

  const tighten = (az: number, polar: number) => {
    const c = controls.current
    if (!c) return
    c.minAzimuthAngle = az - 0.85
    c.maxAzimuthAngle = az + 0.85
    c.minPolarAngle = Math.max(0.08, polar - 0.42)
    c.maxPolarAngle = Math.min(1.55, polar + 0.42)
  }

  useEffect(() => {
    anim.current = view
    relax()
  }, [view])

  useFrame((state, delta) => {
    const goal = anim.current
    const c = controls.current
    if (!goal || !c) return
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
      minDistance={3.5}
      maxDistance={16}
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
