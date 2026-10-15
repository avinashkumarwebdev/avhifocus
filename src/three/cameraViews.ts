export interface CameraView {
  position: [number, number, number]
  target: [number, number, number]
}

/**
 * Named camera presets for the classroom. Bench layout (seatPosition):
 * two columns at x=±2.7, rows z ∈ [-4.2, 5.4]; the centre aisle (x=0) is
 * always clear, as is everything above y≈2.4 — every preset lives in that
 * free space so the camera can never sit inside a bench, avatar, or wall.
 */
export const CAMERA_VIEWS: Array<{ id: string; label: string; view: CameraView }> = [
  {
    id: 'overview',
    label: 'Overview',
    view: { position: [0, 7, 13], target: [0, 0.6, -2] }
  },
  {
    id: 'board',
    label: "Teacher's view",
    // over the teacher's shoulder, looking down the two bench columns
    view: { position: [0.4, 3.2, -6.3], target: [0, 1, 6.5] }
  },
  {
    id: 'window',
    label: 'Window side',
    view: { position: [6.2, 3.2, 5.6], target: [-2.2, 0.8, -2.2] }
  },
  {
    id: 'aisle',
    label: 'Eye level',
    // raised eye-level: over the last bench row, straight down the aisle
    view: { position: [0, 3, 10.6], target: [0, 1, -5.5] }
  },
  {
    id: 'top',
    label: 'Top down',
    view: { position: [0, 14.6, 1.0], target: [0, 0, 0.6] }
  }
]

export const DEFAULT_VIEW_ID = 'overview'
export const DEFAULT_VIEW: CameraView = CAMERA_VIEWS[0].view

export function cameraViewById(id: string): CameraView {
  return CAMERA_VIEWS.find((v) => v.id === id)?.view ?? DEFAULT_VIEW
}
