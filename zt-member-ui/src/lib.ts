export type PeerStatus = 'online' | 'offline' | 'relay'

export interface Member {
  id: string // ZeroTier address (10-hex)
  name: string // friendly name
  authorized: boolean
  ipAssignments: string[] // e.g. ['10.147.18.5']
  bridge: boolean
  autoAssign: boolean // 成员级自动分配开关（UI 偏好，控制器无此字段）
  status: PeerStatus // derived from /peer
  lastSeen: number // epoch ms
  version: string // ZeroTier client version, e.g. '1.12.2'
}

export type AuthFilter = 'unauth' | 'auth'
export type SortKey = 'ip' | 'name' | 'status' | 'lastSeen' | 'version'

export function ipToNumber(ip?: string): number {
  if (!ip) return Number.MAX_SAFE_INTEGER // no ip -> sorts last
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some(isNaN)) return Number.MAX_SAFE_INTEGER
  return (((parts[0] << 24) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0) || Number.MAX_SAFE_INTEGER
}

export function statusColor(s: PeerStatus): string {
  return s === 'online' ? '#34C759' : s === 'relay' ? '#FF9500' : '#C7C7CC'
}
export function statusLabel(s: PeerStatus): string {
  return s === 'online' ? '在线' : s === 'relay' ? '中继' : '离线'
}

export type Group = 'unauth' | 'pending' | 'assigned'
export function memberGroup(m: Member): Group {
  if (!m.authorized) return 'unauth'
  return m.ipAssignments.length > 0 ? 'assigned' : 'pending'
}

export function isNamed(m: Member): boolean {
  return m.name.trim().length > 0
}
export function displayName(m: Member): string {
  return isNamed(m) ? m.name : m.id
}

// 控制器节点地址 = 首个网络 ID 前 10 位；当其作为成员出现在网络里时，
// 其成员地址等于该值。用此判断某成员是否为「控制器」自身。
export function isControllerMember(m: Member, controllerAddress: string): boolean {
  return !!controllerAddress && m.id === controllerAddress
}

export function sortMembers(list: Member[], key: SortKey, asc = true): Member[] {
  const dir = asc ? 1 : -1
  return [...list].sort((a, b) => {
    let r = 0
    if (key === 'ip') r = ipToNumber(a.ipAssignments[0]) - ipToNumber(b.ipAssignments[0])
    else if (key === 'name') r = a.name.localeCompare(b.name, 'zh')
    else if (key === 'status') r = a.status.localeCompare(b.status)
    else if (key === 'version') {
      const av = (a.version || '').trim()
      const bv = (b.version || '').trim()
      r = av.localeCompare(bv, undefined, { numeric: true })
      if (av === '' && bv !== '') r = 1
      else if (av !== '' && bv === '') r = -1
    }
    else r = a.lastSeen - b.lastSeen
    if (r === 0) r = a.name.localeCompare(b.name, 'zh')
    return r * dir
  })
}

// Derive the candidate subnet from the network's first IP pool (falls back to 10.147.18).
export function nextFreeIp(list: Member[], net?: Network): string {
  const base = net?.ipPool[0]?.start ?? '10.147.18.1'
  const subnet = base.split('.').slice(0, 3).join('.')
  const used = new Set(list.flatMap((m) => m.ipAssignments))
  for (let i = 2; i <= 254; i++) {
    const ip = `${subnet}.${i}`
    if (!used.has(ip)) return ip
  }
  return `${subnet}.254`
}

export function isValidIp(ip?: string): boolean {
  if (!ip) return false
  const p = ip.split('.')
  if (p.length !== 4) return false
  return p.every((n) => /^\d{1,3}$/.test(n) && Number(n) >= 0 && Number(n) <= 255)
}
export function ipInUse(ip: string, list: Member[], exceptId?: string): boolean {
  return list.some((m) => m.id !== exceptId && m.ipAssignments.includes(ip))
}
// An IP must belong to the current network's IP pool. A network with no pool
// configured does not restrict (e.g. a public lab network) — returns true.
export function ipInPool(ip: string, net?: Network): boolean {
  if (!net || !net.ipPool || net.ipPool.length === 0) return true
  const v = ipToNumber(ip)
  if (v === Number.MAX_SAFE_INTEGER) return false
  return net.ipPool.some((r) => {
    const s = ipToNumber(r.start)
    const e = ipToNumber(r.end)
    if (s === Number.MAX_SAFE_INTEGER || e === Number.MAX_SAFE_INTEGER) return false
    return v >= s && v <= e
  })
}
export function poolText(net?: Network): string {
  if (!net || !net.ipPool || net.ipPool.length === 0) return '未配置 IP 池'
  return net.ipPool.map((r) => (r.start === r.end ? r.start : `${r.start}–${r.end}`)).join('、')
}

// ---- Network (mirrors ztncui /controller/network/:nwid) ----
export type V4Mode = 'zt' | 'rfc4193' | 'none'
export type V6Mode = '6plane' | 'rfc4193' | 'zt' | 'none'
export interface IpRange {
  id: string
  start: string
  end: string
}
export interface Route {
  id: string
  target: string // CIDR, e.g. 0.0.0.0/0
  via: string // gateway IP, optional
}
export interface DnsConfig {
  domain: string
  servers: string[]
}
export interface Network {
  id: string // nwid (16-hex)
  name: string
  private: boolean
  v4AssignMode: V4Mode
  v6AssignMode: V6Mode
  ipPool: IpRange[]
  routes: Route[]
  dns: DnsConfig | null
}

let _uid = 100
export function uid(prefix = 'n'): string {
  _uid += 1
  return `${prefix}${_uid}`
}

export function countByNetwork(net: Network, members: Member[]): { total: number; authorized: number } {
  const total = members.length
  const authorized = members.filter((m) => m.authorized).length
  return { total, authorized }
}

export function newNetworkDraft(): Network {
  const id = uid('nw').padEnd(16, '0').slice(0, 16)
  return {
    id,
    name: '新网络',
    private: true,
    v4AssignMode: 'zt',
    v6AssignMode: '6plane',
    ipPool: [{ id: uid('p'), start: '10.147.19.1', end: '10.147.19.254' }],
    routes: [],
    dns: null,
  }
}

// ============================================================================
// 真实后端对接层：所有取数 / 写入均经后端 /api/controller/** 反向代理到
// 宿主机 ZeroTier 控制器（会话保护 + X-ZT1-Auth 注入由后端完成）。
// 前端不再持有任何 mock 数据。
// ============================================================================
export const API_BASE = '/api/controller'
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const r = await fetch(API_BASE + path, { credentials: 'include', ...init })
  if (!r.ok) throw new Error(await r.text())
  return r
}

// ---- API Key 管理（控制台自身鉴权，不走 /api/controller 代理） ----
export interface ApiKey {
  id: string
  name: string
  prefix: string
  status: string
  created_at: number
  expires_at: number | null
  created_by: string
  last_used_at: number | null
  active: boolean
}
export interface ApiKeyIssued extends ApiKey {
  key: string // 明文，仅创建时返回一次
}
export async function fetchApiKeys(): Promise<ApiKey[]> {
  const r = await fetch('/api/auth/api-keys', { credentials: 'include' })
  if (!r.ok) throw new Error(await r.text())
  return (await r.json()) as ApiKey[]
}
export async function createApiKey(name: string): Promise<ApiKeyIssued> {
  const r = await fetch('/api/auth/api-keys', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!r.ok) throw new Error(await r.text())
  return (await r.json()) as ApiKeyIssued
}
export async function revokeApiKey(id: string): Promise<void> {
  const r = await fetch(`/api/auth/api-keys/${id}`, { method: 'DELETE', credentials: 'include' })
  if (!r.ok) throw new Error(await r.text())
}

// ---- 控制器原始结构（仅取所需字段） ----
interface ZTMemberRaw {
  id?: string
  address?: string
  name?: string
  authorized?: boolean
  ipAssignments?: string[]
  activeBridge?: boolean
  noAutoAssignIps?: boolean
  lastSeen?: number
}
interface ZTNetworkRaw {
  id?: string
  nwid?: string
  name?: string
  private?: boolean
  ipAssignmentPools?: { ipRangeStart?: string; ipRangeEnd?: string }[]
  routes?: { target?: string; via?: string | null }[]
  dns?: { domain?: string; servers?: string[] } | null
  v4AssignMode?: Record<string, boolean>
  v6AssignMode?: Record<string, boolean>
}

function mapV4Mode(m?: Record<string, boolean>): V4Mode {
  if (m && m.zt) return 'zt'
  if (m && m.rfc4193) return 'rfc4193'
  return 'none'
}
function mapV6Mode(m?: Record<string, boolean>): V6Mode {
  if (m && m['6plane']) return '6plane'
  if (m && m.rfc4193) return 'rfc4193'
  if (m && m.zt) return 'zt'
  return 'none'
}

function mapNetwork(raw: ZTNetworkRaw): Network {
  const id = raw.nwid || raw.id || ''
  const dns =
    raw.dns && (raw.dns.domain || (raw.dns.servers && raw.dns.servers.length))
      ? { domain: raw.dns.domain || '', servers: raw.dns.servers || [] }
      : null
  return {
    id,
    name: raw.name ?? '',
    private: raw.private ?? true,
    v4AssignMode: mapV4Mode(raw.v4AssignMode),
    v6AssignMode: mapV6Mode(raw.v6AssignMode),
    ipPool: (raw.ipAssignmentPools || []).map((p, i) => ({
      id: `p${i}`,
      start: p.ipRangeStart || '',
      end: p.ipRangeEnd || '',
    })),
    routes: (raw.routes || []).map((rt, i) => ({
      id: `r${i}`,
      target: rt.target || '',
      via: rt.via || '',
    })),
    dns,
  }
}

function mapMember(raw: ZTMemberRaw): Member {
  return {
    id: raw.address || raw.id || '',
    name: raw.name ?? '',
    authorized: raw.authorized ?? false,
    ipAssignments: raw.ipAssignments ?? [],
    bridge: raw.activeBridge ?? false,
    autoAssign: !(raw.noAutoAssignIps ?? false),
    status: 'offline',
    lastSeen: (raw.lastSeen ?? 0) * 1000,
    version: '',
  }
}

export async function fetchNetworks(): Promise<Network[]> {
  const idsResp = await apiFetch('/network')
  const ids: string[] = await idsResp.json()
  const nets = await Promise.all(
    ids.map(async (id) => {
      const r = await apiFetch(`/network/${id}`)
      return mapNetwork((await r.json()) as ZTNetworkRaw)
    }),
  )
  return nets
}

export async function fetchMembers(nwid: string): Promise<Member[]> {
  // 列表接口只返回 { 成员地址: 修订号 }，需逐个取详情。
  const listResp = await apiFetch(`/network/${nwid}/member`)
  const list = (await listResp.json()) as Record<string, unknown>
  const ids = Object.keys(list)
  const members = await Promise.all(
    ids.map(async (id) => {
      const r = await apiFetch(`/network/${nwid}/member/${id}`)
      return mapMember((await r.json()) as ZTMemberRaw)
    }),
  )
  return members
}

// 控制器 /peer 返回所有对等节点；节点在线列表即当前连到控制器的 peer。
// 真实 peer 对象结构：{ address, version, paths:[{active, expired, lastReceive(ms), ...}], role, ... }
// 注意：peer 对象没有 lastSeen 字段，最近活跃时间取 paths[].lastReceive（毫秒）。
export interface PeerInfo {
  lastSeen: number // epoch seconds
  version?: string // ZeroTier client version, e.g. '1.12.2'
}
export async function fetchPeers(): Promise<Record<string, PeerInfo>> {
  try {
    const r = await apiFetch('/peer')
    const arr = (await r.json()) as {
      address?: string
      version?: string
      paths?: { active?: boolean; expired?: boolean; lastReceive?: number }[]
    }[]
    const map: Record<string, PeerInfo> = {}
    const nowMs = Date.now()
    for (const p of arr) {
      if (!p.address) continue
      const paths = p.paths || []
      const lastMs = paths.reduce((mx, x) => Math.max(mx, x.lastReceive || 0), 0)
      const live = paths.some(
        (x) => x.active && !x.expired && (x.lastReceive || 0) > nowMs - 10 * 60 * 1000,
      )
      if (live) {
        map[p.address] = { lastSeen: Math.floor(lastMs / 1000), version: p.version }
      }
    }
    return map
  } catch {
    return {}
  }
}

// peers: 地址 -> 对端信息（最近活跃秒数 + ZeroTier 客户端版本）。
// controllerAddress: 控制器节点地址（首个网络 ID 前 10 位）。控制器即本机，
// 不会出现在自己的 /peer 列表里，需强制判为在线，否则永远显示离线。
export function withPeerStatus(
  members: Member[],
  peers: Record<string, PeerInfo>,
  controllerAddress = '',
): Member[] {
  const nowSec = Math.floor(Date.now() / 1000)
  return members.map((m) => {
    // 控制器自身：本机永远在线，用当前时间作为最近活跃。
    if (m.id && m.id === controllerAddress) {
      return { ...m, status: 'online' as PeerStatus, lastSeen: Date.now() }
    }
    const info = peers[m.id]
    const ls = info?.lastSeen || 0
    const online = ls > 0 && nowSec - ls < 300
    return {
      ...m,
      status: (online ? 'online' : 'offline') as PeerStatus,
      lastSeen: ls * 1000,
      version: info?.version || '',
    }
  })
}

// 控制器状态：HTTP /controller 不暴露节点地址/版本，地址由首个网络 ID 前 10 位推导（ZT 约定：nwid = 控制器地址 + 6 位随机）。
export interface ControllerStatus {
  address: string
  apiVersion: number
  databaseReady: boolean
}
export async function fetchControllerStatus(nets: Network[]): Promise<ControllerStatus> {
  const address = nets[0]?.id.slice(0, 10) || ''
  try {
    const r = await apiFetch('')
    const raw = (await r.json()) as { apiVersion?: number; databaseReady?: boolean }
    return { address, apiVersion: raw.apiVersion ?? 0, databaseReady: raw.databaseReady ?? false }
  } catch {
    return { address, apiVersion: 0, databaseReady: false }
  }
}

// ---- 写入：均透传后端代理到控制器 ----
export async function saveMember(
  nwid: string,
  id: string,
  patch: { authorized?: boolean; name?: string; ipAssignments?: string[]; bridge?: boolean; autoAssign?: boolean },
): Promise<void> {
  const body: Record<string, unknown> = {}
  if (patch.authorized !== undefined) body.authorized = patch.authorized
  if (patch.name !== undefined) body.name = patch.name
  if (patch.ipAssignments !== undefined) body.ipAssignments = patch.ipAssignments
  if (patch.bridge !== undefined) body.activeBridge = patch.bridge
  if (patch.autoAssign !== undefined) body.noAutoAssignIps = !patch.autoAssign
  await apiFetch(`/network/${nwid}/member/${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function saveNetwork(nwid: string, net: Network): Promise<void> {
  const body = {
    name: net.name,
    private: net.private,
    ipAssignmentPools: net.ipPool.map((r) => ({ ipRangeStart: r.start, ipRangeEnd: r.end })),
    routes: net.routes.map((rt) => ({ target: rt.target, via: rt.via || null })),
    dns: net.dns ? { domain: net.dns.domain, servers: net.dns.servers } : null,
    v4AssignMode: { zt: net.v4AssignMode === 'zt', rfc4193: net.v4AssignMode === 'rfc4193' },
    v6AssignMode: {
      '6plane': net.v6AssignMode === '6plane',
      rfc4193: net.v6AssignMode === 'rfc4193',
      zt: net.v6AssignMode === 'zt',
    },
  }
  await apiFetch(`/network/${nwid}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// 创建网络：先让控制器分配 nwid，再套用配置；返回真实 nwid。
export async function createNetworkApi(net: Network): Promise<string> {
  const r = await apiFetch('/network', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  const raw = (await r.json()) as { nwid?: string; id?: string }
  const nwid = raw.nwid || raw.id || ''
  if (nwid) await saveNetwork(nwid, net)
  return nwid
}

export async function deleteNetworkApi(nwid: string): Promise<void> {
  await apiFetch(`/network/${nwid}`, { method: 'DELETE' })
}

export async function deleteMemberApi(nwid: string, id: string): Promise<void> {
  await apiFetch(`/network/${nwid}/member/${id}`, { method: 'DELETE' })
}
