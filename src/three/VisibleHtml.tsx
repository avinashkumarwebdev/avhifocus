import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * drei <Html>, but the label hides itself as soon as its world anchor leaves
 * the viewport (or slips behind the camera) — instead of rendering as a
 * half-cut pill at the screen edge or floating over the void. Visibility is
 * toggled by direct DOM writes (no React re-renders), so a full classroom of
 * labels costs a few projections per frame and nothing more.
 */
export function VisibleHtml({
  position,
  children,
  ...htmlProps
}: {
  position: [number, number, number]
  children: React.ReactNode
} & Record<string, any>) {
  const anchor = useMemo(() => new THREE.Object3D(), [])
  const elRef = useRef<HTMLDivElement | null>(null)
  const v = useMemo(() => new THREE.Vector3(), [])
  const hidden = useRef<boolean | null>(null)

  useFrame(({ camera }) => {
    const el = elRef.current
    if (!el) return
    anchor.getWorldPosition(v)
    v.project(camera)
    const off = v.z > 1 || v.x < -0.97 || v.x > 0.97 || v.y < -0.97 || v.y > 0.97
    if (off !== hidden.current) {
      hidden.current = off
      el.style.visibility = off ? 'hidden' : 'visible'
    }
  })

  return (
    <>
      <primitive object={anchor} position={position} />
      <Html position={position} ref={elRef as any} zIndexRange={[30, 0]} wrapperClass="pointer-events-none" {...(htmlProps as any)}>
        {children}
      </Html>
    </>
  )
}
