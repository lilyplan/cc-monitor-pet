import path from 'path'
import os from 'os'

export const PET_SIZE = 112

export const SERVER_HOST = '127.0.0.1'
export const SERVER_PORT = 23333

export const TOKEN_PATH = path.join(os.homedir(), '.cc-monitor-pet.token')

export const MAX_BODY_BYTES = 65536

export const HOOK_TIMEOUT_MS = 1000
export const PERMISSION_TIMEOUT_MS = 60000
