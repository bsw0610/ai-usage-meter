// codex app-server에 한 번 물어 5시간·7일 한도만 JSON 한 줄로 출력한다.
// app-server는 stdin이 닫히면 응답 전에 끝나므로 응답을 받을 때까지 stdin을 열어 둔다.
// 필요한 필드만 추리고 계정·크레딧 ID 등은 버린다. 실패하면 아무것도 쓰지 않고 1로 끝난다.
import { spawn } from 'node:child_process'

const TIMEOUT_MS = 4000

const child = spawn('codex', ['app-server'], { stdio: ['pipe', 'pipe', 'ignore'] })
const fail = () => {
  child.kill()
  process.exit(1)
}
setTimeout(fail, TIMEOUT_MS).unref()
child.on('error', fail)
child.on('exit', () => process.exit(1))
child.stdin.on('error', () => {})

const pick = w =>
  w && typeof w.usedPercent === 'number' && typeof w.windowDurationMins === 'number'
    ? { usedPercent: w.usedPercent, windowDurationMins: w.windowDurationMins, resetsAt: w.resetsAt }
    : null

const send = o => child.stdin.write(JSON.stringify(o) + '\n')

let buf = ''
child.stdout.on('data', d => {
  buf += d
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i)
    buf = buf.slice(i + 1)
    let m
    try {
      m = JSON.parse(line)
    } catch {
      continue
    }
    if (m.id === 1) {
      send({ method: 'initialized' })
      send({ id: 2, method: 'account/rateLimits/read' })
    } else if (m.id === 2) {
      const r = m.result?.rateLimitsByLimitId?.codex ?? m.result?.rateLimits
      if (!r || r.limitId !== 'codex') fail()
      process.stdout.write(
        JSON.stringify({ limitId: 'codex', windows: [pick(r.primary), pick(r.secondary)].filter(Boolean) }) + '\n',
        () => {
          child.kill()
          process.exit(0)
        },
      )
    }
  }
})

send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'ai-usage-meter', version: '0.1.0' } } })
