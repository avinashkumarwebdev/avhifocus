import { z } from 'zod'

const noControlChars = /^[^\p{Cc}\p{Cf}]+$/u

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, 'Please enter your name')
  .max(24, 'Keep it under 24 characters')
  .regex(noControlChars, 'Name contains invalid characters')

export const classLabelSchema = z
  .string()
  .trim()
  .min(1, 'Please enter your class')
  .max(16, 'Keep it under 16 characters')
  .regex(noControlChars, 'Class contains invalid characters')

export const classroomNameSchema = z
  .string()
  .trim()
  .min(2, 'Give the classroom a name (2+ characters)')
  .max(40, 'Keep it under 40 characters')
  .regex(noControlChars, 'Name contains invalid characters')

/** Unambiguous alphabet: no 0/O/1/I/L, always uppercased, 6 chars. */
export const JOIN_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
export const JOIN_CODE_LENGTH = 6

export const joinCodeSchema = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase().replace(/[\s-]/g, ''))
  .pipe(
    z
      .string()
      .length(JOIN_CODE_LENGTH, `A classroom code has ${JOIN_CODE_LENGTH} characters`)
      .regex(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]+$/, 'That code has invalid characters')
  )

export function generateJoinCode(random: () => number = Math.random): string {
  let code = ''
  for (let i = 0; i < JOIN_CODE_LENGTH; i++) {
    code += JOIN_CODE_ALPHABET[Math.floor(random() * JOIN_CODE_ALPHABET.length)]
  }
  return code
}

export const classSuggestions = [
  'Class 6', 'Class 7', 'Class 8', 'Class 9', 'Class 10',
  'Class 11', 'Class 12', 'NEET', 'JEE', 'College'
]
