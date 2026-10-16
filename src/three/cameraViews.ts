export interface CameraView {
  position: [number, number, number]
  target: [number, number, number]
}

/**
 * Named camera presets for the classroom. Bench layout (seatPosition):
 * two columns at x=±2.7, rows z ∈ [-4.2, 5.4]; the centre aisle (x=0) is
 * always clear, as is everything above y≈2.4. EVERY preset lives inside the
 * room (walls at x=±7.4, z=-8.6…+8.75, height 5) — the CameraRig additionally
 * clamps all camera movement to that interior box, so no view can ever end
 * up outside the walls staring at void.
 */
import { seatPosition } from './Bench'

export const CAMERA_VIEWS: Array<{ id: string; label: string; view: CameraView }> = [
  {
    id: 'overview',
    label: 'Overview',
    view: { position: [0, 4.3, 8.0], target: [0, 0.5, -2.2] }
  },
  {
    id: 'board',
    label: "Teacher's view",
    // over the teacher's shoulder, looking down the two bench columns
    view: { position: [0.4, 3.0, -5.9], target: [0, 1.0, 5.8] }
  },
  {
    id: 'window',
    label: 'Window side',
    view: { position: [5.2, 2.5, 5.2], target: [-2.0, 0.9, -2.0] }
  },
  {
    id: 'aisle',
    label: 'Eye level',
    // raised eye-level: over the last bench row, straight down the aisle
    view: { position: [0, 2.5, 8.2], target: [0, 1.0, -4.5] }
  },
  {
    id: 'top',
    label: 'High back',
    // back-left corner, raised — the old straight-down preset left the room
    view: { position: [-4.9, 4.1, 7.9], target: [1.8, 0.5, -2.4] }
  },
  {
    id: 'teacherpov',
    label: 'Teacher’s eyes',
    // first-person from the teacher's spot, facing the benches
    view: { position: [0, 1.6, -7.0], target: [0, 1.15, 0.5] }
  }
]

/**
 * First-person eyes at any occupied bench: seated head height, angled down
 * the aisle toward the blackboard (every bench faces the front).
 */
export function studentPovView(seat: number): CameraView {
  const [x, , z] = seatPosition(seat)
  return {
    position: [x, 1.42, z - 0.25],
    target: [x * 0.35, 1.3, -7.2]
  }
}

export const DEFAULT_VIEW_ID = 'overview'
export const DEFAULT_VIEW: CameraView = CAMERA_VIEWS[0].view

export function cameraViewById(id: string): CameraView {
  return CAMERA_VIEWS.find((v) => v.id === id)?.view ?? DEFAULT_VIEW
}
