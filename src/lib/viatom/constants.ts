/**
 * Viatom / Wellue "O2 series" BLE constants.
 *
 * Sources (see README "Protocol sources"):
 *  - Viatom's own Android demo SDK: github.com/viatom-develop/LepuBle (OxyBleManager.java, OxyBleCmd.java)
 *  - MackeyStingray/o2r (o2r/defines.py)
 *  - farolone/wellue-o2ring-protocol, ecostech/viatom-ble, afshari.lu notes
 */

/** Legacy Viatom O2 service (Checkme O2, O2Ring, SleepU, BabyO2, O2 Vibe class devices). */
export const O2_SERVICE_UUID = '14839ac4-7d7e-415c-9a42-167340cf2339'
/** Write characteristic (vendor uses write-without-response). */
export const O2_WRITE_UUID = '8b00ace7-eb0b-49b0-bbe9-9aee0a26e1a3'
/** Notify characteristic (responses arrive here, split over several notifications). */
export const O2_NOTIFY_UUID = '0734594a-a8e7-4b1a-a6b1-cd5243059a57'

/**
 * Newer "OxyII" service used by O2Ring S (T8520) firmware (nglessner/o2ring-s-protocol).
 * We only *detect* it so we can show a clear message; it is a different protocol.
 */
export const OXYII_SERVICE_UUID = 'e8fb0001-a14b-98f9-831b-4e2941d01248'

/** Device information service, used opportunistically. */
export const DEVICE_INFO_SERVICE = 'device_information'

/** Request/response command opcodes (legacy O2 protocol). */
export const Cmd = {
  /** Open a stored file for reading. Payload: ASCII file name + NUL. Reply: u32 LE size. */
  FILE_OPEN: 0x03,
  /** Read the next chunk. "block" header field = chunk index starting at 0. */
  FILE_READ: 0x04,
  /** Close the open file. */
  FILE_CLOSE: 0x05,
  /** Device info / settings as JSON, including "FileList" and "CurTIME". */
  INFO: 0x14,
  /** Ping (o2r). */
  PING: 0x15,
  /** Set parameters, payload JSON e.g. {"SetTIME":"2026-10-10,07:00:00"}. */
  PARA_SYNC: 0x16,
  /** Live sensor values, no waveform (o2r / viatom-ble). */
  READ_SENSORS: 0x17,
  /** Live values + pleth waveform (vendor SDK "getRtWave"). Payload: 1 byte rate (0 = 125 Hz). */
  RT_WAVE: 0x1b,
} as const

export const HOST_LEAD = 0xaa
export const DEVICE_LEAD = 0x55
export const HEADER_LEN = 7
/** Header (7) + CRC (1). */
export const FRAME_OVERHEAD = 8
/** Classic ATT payload size; Chrome may negotiate a larger MTU but 20 is always safe. */
export const WRITE_CHUNK = 20

/** Name prefixes seen on Viatom O2 family devices. Used for the Chrome device chooser. */
export const DEVICE_NAME_PREFIXES = [
  'O2 Vibe',
  'O2Vibe',
  'O2',
  'Checkme',
  'CheckO2',
  'SleepU',
  'SleepO2',
  'WearO2',
  'KidsO2',
  'BabyO2',
  'Oxylink',
  'Oxyfit',
  'OxySmart',
  'BodiMetrics',
  'Wellue',
  'Viatom',
  'PO2',
  'S8-AW',
  'T8520',
]

export const TIME_FORMAT_HINT = 'YYYY-MM-DD,HH:MM:SS'
