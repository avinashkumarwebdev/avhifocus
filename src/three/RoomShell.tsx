import { useMemo } from 'react'
import * as THREE from 'three'
import { makeBlackboardTexture } from './textures'

/* Shared materials/colors — instantiated once for the whole room. */
const MAT = {
  floor: new THREE.MeshStandardMaterial({ color: '#A9815C', roughness: 0.85, metalness: 0.02 }),
  floorDark: new THREE.MeshStandardMaterial({ color: '#94704C', roughness: 0.9 }),
  wall: new THREE.MeshStandardMaterial({ color: '#F0E6D3', roughness: 0.95 }),
  wallTrim: new THREE.MeshStandardMaterial({ color: '#8B6345', roughness: 0.8 }),
  windowFrame: new THREE.MeshStandardMaterial({ color: '#6E4E36', roughness: 0.7 }),
  windowPane: new THREE.MeshStandardMaterial({
    color: '#FFE9C4',
    emissive: '#FFDCA4',
    emissiveIntensity: 0.85,
    roughness: 0.4
  }),
  rug: new THREE.MeshStandardMaterial({ color: '#A7B99A', roughness: 0.95, transparent: true, opacity: 0.65 }),
  rugInner: new THREE.MeshStandardMaterial({ color: '#D77A4A', roughness: 0.95, transparent: true, opacity: 0.5 }),
  wood: new THREE.MeshStandardMaterial({ color: '#8B6345', roughness: 0.75 }),
  woodLight: new THREE.MeshStandardMaterial({ color: '#A87E58', roughness: 0.75 }),
  darkMetal: new THREE.MeshStandardMaterial({ color: '#4A443C', roughness: 0.5, metalness: 0.3 }),
  plant: new THREE.MeshStandardMaterial({ color: '#5F7A5E', roughness: 0.9 }),
  plantLight: new THREE.MeshStandardMaterial({ color: '#7C9370', roughness: 0.9 }),
  pot: new THREE.MeshStandardMaterial({ color: '#B85F33', roughness: 0.85 }),
  lampShade: new THREE.MeshStandardMaterial({ color: '#F4EBDD', roughness: 0.6 }),
  lampGlow: new THREE.MeshStandardMaterial({ color: '#FFE8BD', emissive: '#FFD58F', emissiveIntensity: 1.4 }),
  shelfWood: new THREE.MeshStandardMaterial({ color: '#7C5A3E', roughness: 0.8 })
}

const BOOK_COLORS = ['#B85F33', '#5F7A5E', '#7D8DA1', '#D9B44A', '#8B6345', '#A7B99A', '#244B38', '#D77A4A']

function WindowUnit({ position, rotationY }: { position: [number, number, number]; rotationY: number }) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {/* frame */}
      <mesh material={MAT.windowFrame} position={[0, 0, 0]}>
        <boxGeometry args={[2.1, 3.1, 0.12]} />
      </mesh>
      {/* pane */}
      <mesh material={MAT.windowPane} position={[0, 0, 0.02]}>
        <boxGeometry args={[1.8, 2.8, 0.06]} />
      </mesh>
      {/* muntins */}
      <mesh material={MAT.windowFrame} position={[0, 0, 0.06]}>
        <boxGeometry args={[0.07, 2.8, 0.08]} />
      </mesh>
      <mesh material={MAT.windowFrame} position={[0, 0, 0.06]}>
        <boxGeometry args={[1.8, 0.07, 0.08]} />
      </mesh>
      {/* sill */}
      <mesh material={MAT.windowFrame} position={[0, -1.65, 0.1]}>
        <boxGeometry args={[2.3, 0.12, 0.3]} />
      </mesh>
    </group>
  )
}

function Bookshelf({ position, seed }: { position: [number, number, number]; seed: number }) {
  const rows = useMemo(() => {
    const out: Array<{ y: number; books: Array<{ x: number; h: number; w: number; c: string; tilt: number }> }> = []
    let s = seed
    const rand = () => {
      s = (s * 16807) % 2147483647
      return (s & 0xffff) / 0xffff
    }
    for (let r = 0; r < 3; r++) {
      const books: Array<{ x: number; h: number; w: number; c: string; tilt: number }> = []
      let x = -1.1
      while (x < 1.0) {
        const w = 0.09 + rand() * 0.09
        books.push({
          x: x + w / 2,
          h: 0.3 + rand() * 0.16,
          w,
          c: BOOK_COLORS[Math.floor(rand() * BOOK_COLORS.length)],
          tilt: rand() > 0.86 ? 0.14 : 0
        })
        x += w + 0.012
      }
      out.push({ y: 0.42 + r * 0.52, books })
    }
    return out
  }, [seed])

  return (
    <group position={position} rotation={[0, Math.PI / 2, 0]}>
      {/* carcass */}
      <mesh material={MAT.shelfWood} position={[0, 0.95, -0.02]} castShadow>
        <boxGeometry args={[2.6, 1.9, 0.14]} />
      </mesh>
      <mesh material={MAT.shelfWood} position={[0, 1.9, 0.14]}>
        <boxGeometry args={[2.66, 0.08, 0.42]} />
      </mesh>
      {[0.38, 0.9, 1.42].map((y) => (
        <mesh key={y} material={MAT.shelfWood} position={[0, y, 0.14]}>
          <boxGeometry args={[2.6, 0.06, 0.4]} />
        </mesh>
      ))}
      {rows.map((row, ri) => (
        <group key={ri}>
          {row.books.map((b, bi) => (
            <mesh
              key={bi}
              position={[b.x, row.y + b.h / 2, 0.16]}
              rotation={[0, 0, b.tilt]}
              castShadow={false}
            >
              <boxGeometry args={[b.w, b.h, 0.24]} />
              <meshStandardMaterial color={b.c} roughness={0.85} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  )
}

function Plant({ position, scale = 1 }: { position: [number, number, number]; scale?: number }) {
  return (
    <group position={position} scale={scale}>
      <mesh material={MAT.pot} position={[0, 0.22, 0]} castShadow>
        <cylinderGeometry args={[0.22, 0.17, 0.44, 12]} />
      </mesh>
      {[
        [0, 0.72, 0, 0.32, 0],
        [0.16, 0.6, 0.08, 0.22, 0.5],
        [-0.15, 0.58, -0.05, 0.24, -0.4],
        [0.05, 0.9, -0.02, 0.18, 0.2]
      ].map(([x, y, z, s, r], i) => (
        <mesh key={i} material={i % 2 ? MAT.plantLight : MAT.plant} position={[x, y, z]} rotation={[0, r, 0]} castShadow>
          <icosahedronGeometry args={[s, 0]} />
        </mesh>
      ))}
    </group>
  )
}

function PendantLamp({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh material={MAT.darkMetal} position={[0, 0.7, 0]}>
        <cylinderGeometry args={[0.02, 0.02, 1.4, 6]} />
      </mesh>
      <mesh material={MAT.lampShade} position={[0, -0.05, 0]}>
        <coneGeometry args={[0.42, 0.34, 24, 1, true]} />
      </mesh>
      <mesh material={MAT.lampGlow} position={[0, -0.22, 0]}>
        <sphereGeometry args={[0.09, 12, 12]} />
      </mesh>
      <pointLight position={[0, -0.4, 0]} intensity={2.2} distance={7} color="#FFDCA4" decay={2} />
    </group>
  )
}

export function RoomShell({ roomName }: { roomName: string }) {
  const boardTexture = useMemo(() => makeBlackboardTexture(roomName), [roomName])

  return (
    <group>
      {/* floor + aisle inlay */}
      <mesh material={MAT.floor} position={[0, -0.11, 0]} receiveShadow>
        <boxGeometry args={[15, 0.22, 18.5]} />
      </mesh>
      <mesh material={MAT.floorDark} position={[0, 0.005, 0.8]} receiveShadow>
        <boxGeometry args={[1.6, 0.012, 14]} />
      </mesh>

      {/* rug */}
      <mesh material={MAT.rug} position={[0, 0.012, 0.6]} receiveShadow>
        <cylinderGeometry args={[2.7, 2.7, 0.012, 40]} />
      </mesh>
      <mesh material={MAT.rugInner} position={[0, 0.02, 0.6]} receiveShadow>
        <cylinderGeometry args={[1.7, 1.7, 0.012, 40]} />
      </mesh>

      {/* walls */}
      <mesh material={MAT.wall} position={[0, 2.5, -8.6]} receiveShadow>
        <boxGeometry args={[15, 5, 0.25]} />
      </mesh>
      <mesh material={MAT.wall} position={[-7.4, 2.5, 0]} receiveShadow rotation={[0, Math.PI / 2, 0]}>
        <boxGeometry args={[17.5, 5, 0.25]} />
      </mesh>
      <mesh material={MAT.wall} position={[7.4, 2.5, 0]} receiveShadow rotation={[0, Math.PI / 2, 0]}>
        <boxGeometry args={[17.5, 5, 0.25]} />
      </mesh>
      {/* back wall (with the classroom door) — closes the room so orbit views
          can never land in the beige void */}
      <mesh material={MAT.wall} position={[0, 2.5, 8.75]} receiveShadow>
        <boxGeometry args={[15, 5, 0.25]} />
      </mesh>
      <group position={[3.6, 0, 8.58]}>
        {/* door slab + frame */}
        <mesh material={MAT.wood} position={[0, 1.15, 0]} castShadow>
          <boxGeometry args={[1.1, 2.3, 0.08]} />
        </mesh>
        <mesh material={MAT.wallTrim} position={[-0.62, 1.18, -0.02]}>
          <boxGeometry args={[0.1, 2.42, 0.14]} />
        </mesh>
        <mesh material={MAT.wallTrim} position={[0.62, 1.18, -0.02]}>
          <boxGeometry args={[0.1, 2.42, 0.14]} />
        </mesh>
        <mesh material={MAT.wallTrim} position={[0, 2.42, -0.02]}>
          <boxGeometry args={[1.34, 0.1, 0.14]} />
        </mesh>
        <mesh material={MAT.darkMetal} position={[0.38, 1.12, -0.06]}>
          <sphereGeometry args={[0.045, 10, 10]} />
        </mesh>
        {/* little wall clock above the door */}
        <mesh material={MAT.wallTrim} position={[0, 3.05, -0.02]}>
          <cylinderGeometry args={[0.26, 0.26, 0.05, 24]} />
        </mesh>
        <mesh position={[0, 3.05, -0.055]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.21, 0.21, 0.03, 24]} />
          <meshStandardMaterial color="#FDF8EC" roughness={0.7} />
        </mesh>
        <mesh material={MAT.darkMetal} position={[0, 3.12, -0.075]}>
          <boxGeometry args={[0.025, 0.16, 0.012]} />
        </mesh>
        <mesh material={MAT.darkMetal} position={[0.055, 3.04, -0.075]} rotation={[0, 0, -0.9]}>
          <boxGeometry args={[0.025, 0.12, 0.012]} />
        </mesh>
      </group>
      {/* back-wall skirting */}
      <mesh material={MAT.wallTrim} position={[0, 0.09, 8.6]}>
        <boxGeometry args={[15, 0.18, 0.04]} />
      </mesh>
      {/* skirting + top trim */}
      {([-8.45] as const).map((z) => (
        <mesh key={z} material={MAT.wallTrim} position={[0, 0.09, z + 0.16]}>
          <boxGeometry args={[15, 0.18, 0.04]} />
        </mesh>
      ))}

      {/* blackboard */}
      <group position={[0, 2.05, -8.42]}>
        <mesh material={MAT.windowFrame}>
          <boxGeometry args={[6.7, 2.9, 0.1]} />
        </mesh>
        <mesh position={[0, 0, 0.06]}>
          <planeGeometry args={[6.3, 2.5]} />
          <meshStandardMaterial map={boardTexture} roughness={0.9} />
        </mesh>
        <mesh material={MAT.woodLight} position={[0, -1.55, 0.14]}>
          <boxGeometry args={[6.3, 0.08, 0.2]} />
        </mesh>
        <mesh position={[1.6, -1.49, 0.22]}>
          <boxGeometry args={[0.3, 0.05, 0.05]} />
          <meshStandardMaterial color="#F4EBDD" roughness={0.6} />
        </mesh>
        <mesh position={[-2.2, -1.49, 0.22]}>
          <boxGeometry args={[0.5, 0.04, 0.1]} />
          <meshStandardMaterial color="#D77A4A" roughness={0.7} />
        </mesh>
      </group>

      {/* windows on the right wall — warm daylight side */}
      <WindowUnit position={[7.32, 2.6, -4.5]} rotationY={-Math.PI / 2} />
      <WindowUnit position={[7.32, 2.6, 0]} rotationY={-Math.PI / 2} />
      <WindowUnit position={[7.32, 2.6, 4.5]} rotationY={-Math.PI / 2} />

      {/* bookshelves along left wall */}
      <Bookshelf position={[-7.28, 0, -2.5]} seed={11} />
      <Bookshelf position={[-7.28, 0, 2.5]} seed={97} />

      {/* teacher desk */}
      <group position={[0, 0, -7.1]}>
        <mesh material={MAT.wood} position={[0, 0.72, 0]} castShadow>
          <boxGeometry args={[2.4, 0.1, 1]} />
        </mesh>
        <mesh material={MAT.woodLight} position={[-0.8, 0.38, 0]} castShadow>
          <boxGeometry args={[0.7, 0.66, 0.9]} />
        </mesh>
        <mesh material={MAT.woodLight} position={[0.8, 0.38, 0]} castShadow>
          <boxGeometry args={[0.7, 0.66, 0.9]} />
        </mesh>
        <mesh material={MAT.darkMetal} position={[0.35, 0.85, 0.1]} castShadow>
          <boxGeometry args={[0.5, 0.16, 0.36]} />
        </mesh>
        <group position={[-0.75, 0.77, -0.15]}>
          <mesh material={MAT.pot} position={[0, 0.09, 0]}>
            <cylinderGeometry args={[0.11, 0.09, 0.18, 10]} />
          </mesh>
          <mesh material={MAT.plant} position={[0, 0.28, 0]}>
            <icosahedronGeometry args={[0.13, 0]} />
          </mesh>
        </group>
        {[0, 1].map((i) => (
          <mesh key={i} position={[0.35 - i * 0.04, 0.78 + i * 0.055, -0.3]} rotation={[0, i * 0.15, 0]} castShadow>
            <boxGeometry args={[0.4, 0.05, 0.28]} />
            <meshStandardMaterial color={BOOK_COLORS[i]} roughness={0.85} />
          </mesh>
        ))}
      </group>

      {/* lighting fixtures + plants */}
      <PendantLamp position={[-2.6, 4.1, -1]} />
      <PendantLamp position={[2.6, 4.1, -1]} />
      <Plant position={[-6.7, 0, -7.6]} scale={1.25} />
      <Plant position={[6.7, 0, -7.6]} scale={1.1} />
      <Plant position={[-6.9, 0, 8]} scale={0.9} />
    </group>
  )
}
