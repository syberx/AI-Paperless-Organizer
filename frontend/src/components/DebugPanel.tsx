import { useState, useEffect } from 'react'
import { 
  Network, 
  Globe, 
  Server, 
  CheckCircle2, 
  XCircle, 
  Loader2, 
  Play,
  RefreshCw,
  Terminal
} from 'lucide-react'
import clsx from 'clsx'

interface TestResult {
  test: string
  success: boolean
  result: string
}

interface NetworkInfo {
  hostname: string
  local_ip: string
  dns_servers: string[]
  interfaces: string[]
}

export default function DebugPanel() {
  const [networkInfo, setNetworkInfo] = useState<NetworkInfo | null>(null)
  const [commonTests, setCommonTests] = useState<TestResult[]>([])
  const [loading, setLoading] = useState(false)
  
  // Custom test states
  const [dnsHost, setDnsHost] = useState('')
  const [dnsResult, setDnsResult] = useState<any>(null)
  const [dnsLoading, setDnsLoading] = useState(false)
  
  const [tcpHost, setTcpHost] = useState('')
  const [tcpResult, setTcpResult] = useState<any>(null)
  const [tcpLoading, setTcpLoading] = useState(false)
  
  const [httpUrl, setHttpUrl] = useState('')
  const [httpResult, setHttpResult] = useState<any>(null)
  const [httpLoading, setHttpLoading] = useState(false)
  
  const [paperlessUrl, setPaperlessUrl] = useState('')
  const [paperlessToken, setPaperlessToken] = useState('')
  const [paperlessResult, setPaperlessResult] = useState<any>(null)
  const [paperlessLoading, setPaperlessLoading] = useState(false)

  useEffect(() => {
    loadNetworkInfo()
    runCommonTests()
  }, [])

  const loadNetworkInfo = async () => {
    try {
      const res = await fetch('/api/debug/network-info')
      const data = await res.json()
      setNetworkInfo(data)
    } catch (e) {
      console.error('Error loading network info:', e)
    }
  }

  const runCommonTests = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/debug/common-tests')
      const data = await res.json()
      setCommonTests(data.tests || [])
    } catch (e) {
      console.error('Error running tests:', e)
    } finally {
      setLoading(false)
    }
  }

  const runDnsTest = async () => {
    if (!dnsHost) return
    setDnsLoading(true)
    setDnsResult(null)
    try {
      const res = await fetch('/api/debug/dns-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostname: dnsHost })
      })
      setDnsResult(await res.json())
    } catch (e) {
      setDnsResult({ success: false, message: String(e) })
    } finally {
      setDnsLoading(false)
    }
  }

  const runTcpTest = async () => {
    if (!tcpHost) return
    setTcpLoading(true)
    setTcpResult(null)
    try {
      const res = await fetch('/api/debug/tcp-connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: tcpHost })
      })
      setTcpResult(await res.json())
    } catch (e) {
      setTcpResult({ success: false, message: String(e) })
    } finally {
      setTcpLoading(false)
    }
  }

  const runHttpTest = async () => {
    if (!httpUrl) return
    setHttpLoading(true)
    setHttpResult(null)
    try {
      const res = await fetch('/api/debug/http-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: httpUrl })
      })
      setHttpResult(await res.json())
    } catch (e) {
      setHttpResult({ success: false, message: String(e) })
    } finally {
      setHttpLoading(false)
    }
  }

  const runPaperlessTest = async () => {
    if (!paperlessUrl) return
    setPaperlessLoading(true)
    setPaperlessResult(null)
    try {
      const res = await fetch('/api/debug/paperless-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: paperlessUrl, token: paperlessToken || null })
      })
      setPaperlessResult(await res.json())
    } catch (e) {
      setPaperlessResult({ success: false, message: String(e) })
    } finally {
      setPaperlessLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="font-display text-2xl font-bold text-surface-100">
          Netzwerk-Diagnose
        </h2>
        <p className="text-surface-400 mt-1">
          Teste die Netzwerkverbindung vom Docker Container aus
        </p>
      </div>

      {/* Network Info */}
      <div className="card p-6">
        <div className="flex items-center gap-3 mb-4">
          <Server className="w-5 h-5 text-primary-400" />
          <h3 className="font-semibold text-surface-100">Container Netzwerk-Info</h3>
        </div>
        
        {networkInfo ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-surface-400">Hostname:</span>
              <span className="ml-2 text-surface-100 font-mono">{networkInfo.hostname}</span>
            </div>
            <div>
              <span className="text-surface-400">IP:</span>
              <span className="ml-2 text-surface-100 font-mono">{networkInfo.local_ip}</span>
            </div>
            <div className="md:col-span-2">
              <span className="text-surface-400">DNS Server:</span>
              <span className="ml-2 text-surface-100 font-mono">
                {networkInfo.dns_servers?.join(', ') || 'Nicht gefunden'}
              </span>
            </div>
          </div>
        ) : (
          <div className="text-surface-400">Lade...</div>
        )}
      </div>

      {/* Common Tests */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Globe className="w-5 h-5 text-primary-400" />
            <h3 className="font-semibold text-surface-100">Standard-Tests</h3>
          </div>
          <button
            onClick={runCommonTests}
            disabled={loading}
            className="btn btn-secondary flex items-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Neu testen
          </button>
        </div>
        
        <div className="space-y-2">
          {commonTests.map((test, i) => (
            <div 
              key={i}
              className={clsx(
                'p-3 rounded-lg flex items-center justify-between',
                test.success 
                  ? 'bg-emerald-500/10 border border-emerald-500/30' 
                  : 'bg-red-500/10 border border-red-500/30'
              )}
            >
              <div className="flex items-center gap-3">
                {test.success ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                ) : (
                  <XCircle className="w-5 h-5 text-red-400" />
                )}
                <span className="text-surface-100">{test.test}</span>
              </div>
              <span className={clsx(
                'text-sm font-mono',
                test.success ? 'text-emerald-400' : 'text-red-400'
              )}>
                {test.result}
              </span>
            </div>
          ))}
          {commonTests.length === 0 && !loading && (
            <div className="text-surface-400 text-center py-4">
              Keine Tests ausgeführt
            </div>
          )}
        </div>
      </div>

      {/* DNS Test */}
      <div className="card p-6">
        <div className="flex items-center gap-3 mb-4">
          <Network className="w-5 h-5 text-blue-400" />
          <h3 className="font-semibold text-surface-100">DNS-Auflösung testen</h3>
        </div>
        
        <div className="flex gap-3">
          <input
            type="text"
            value={dnsHost}
            onChange={(e) => setDnsHost(e.target.value)}
            placeholder="z.B. paperless.meine-domain.de"
            className="input flex-1"
            onKeyDown={(e) => e.key === 'Enter' && runDnsTest()}
          />
          <button
            onClick={runDnsTest}
            disabled={dnsLoading || !dnsHost}
            className="btn btn-primary flex items-center gap-2"
          >
            {dnsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            Testen
          </button>
        </div>
        
        {dnsResult && (
          <div className={clsx(
            'mt-4 p-4 rounded-lg',
            dnsResult.success 
              ? 'bg-emerald-500/10 border border-emerald-500/30' 
              : 'bg-red-500/10 border border-red-500/30'
          )}>
            <div className="flex items-center gap-2 mb-2">
              {dnsResult.success ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              ) : (
                <XCircle className="w-5 h-5 text-red-400" />
              )}
              <span className={dnsResult.success ? 'text-emerald-400' : 'text-red-400'}>
                {dnsResult.message}
              </span>
            </div>
            {dnsResult.ips && (
              <div className="text-sm font-mono text-surface-300">
                IPs: {dnsResult.ips.join(', ')}
              </div>
            )}
          </div>
        )}
      </div>

      {/* TCP Connect Test */}
      <div className="card p-6">
        <div className="flex items-center gap-3 mb-4">
          <Terminal className="w-5 h-5 text-purple-400" />
          <h3 className="font-semibold text-surface-100">TCP-Verbindung testen</h3>
        </div>
        
        <div className="flex gap-3">
          <input
            type="text"
            value={tcpHost}
            onChange={(e) => setTcpHost(e.target.value)}
            placeholder="z.B. paperless.meine-domain.de:443"
            className="input flex-1"
            onKeyDown={(e) => e.key === 'Enter' && runTcpTest()}
          />
          <button
            onClick={runTcpTest}
            disabled={tcpLoading || !tcpHost}
            className="btn btn-primary flex items-center gap-2"
          >
            {tcpLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            Testen
          </button>
        </div>
        
        {tcpResult && (
          <div className={clsx(
            'mt-4 p-4 rounded-lg',
            tcpResult.success 
              ? 'bg-emerald-500/10 border border-emerald-500/30' 
              : 'bg-red-500/10 border border-red-500/30'
          )}>
            <div className="flex items-center gap-2">
              {tcpResult.success ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              ) : (
                <XCircle className="w-5 h-5 text-red-400" />
              )}
              <span className={tcpResult.success ? 'text-emerald-400' : 'text-red-400'}>
                {tcpResult.message}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* HTTP Test */}
      <div className="card p-6">
        <div className="flex items-center gap-3 mb-4">
          <Globe className="w-5 h-5 text-amber-400" />
          <h3 className="font-semibold text-surface-100">HTTP/HTTPS-Request testen</h3>
        </div>
        
        <div className="flex gap-3">
          <input
            type="text"
            value={httpUrl}
            onChange={(e) => setHttpUrl(e.target.value)}
            placeholder="z.B. https://paperless.meine-domain.de"
            className="input flex-1"
            onKeyDown={(e) => e.key === 'Enter' && runHttpTest()}
          />
          <button
            onClick={runHttpTest}
            disabled={httpLoading || !httpUrl}
            className="btn btn-primary flex items-center gap-2"
          >
            {httpLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            Testen
          </button>
        </div>
        
        {httpResult && (
          <div className={clsx(
            'mt-4 p-4 rounded-lg',
            httpResult.success 
              ? 'bg-emerald-500/10 border border-emerald-500/30' 
              : 'bg-red-500/10 border border-red-500/30'
          )}>
            <div className="flex items-center gap-2 mb-2">
              {httpResult.success ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              ) : (
                <XCircle className="w-5 h-5 text-red-400" />
              )}
              <span className={httpResult.success ? 'text-emerald-400' : 'text-red-400'}>
                {httpResult.message}
              </span>
            </div>
            {httpResult.status_code && (
              <div className="text-sm text-surface-300">
                Status: {httpResult.status_code}
              </div>
            )}
            {httpResult.redirect_info && (
              <div className="text-sm text-amber-400 mt-2">
                <strong>Redirect zu:</strong>{' '}
                <code className="px-1 py-0.5 bg-surface-800 rounded">{httpResult.redirect_info.redirects_to}</code>
                <p className="text-surface-400 mt-1">{httpResult.redirect_info.hint}</p>
              </div>
            )}
            {httpResult.details && (
              <div className="text-sm text-surface-400 font-mono mt-2 break-all">
                {httpResult.details}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Paperless Test */}
      <div className="card p-6 border-2 border-primary-500/30">
        <div className="flex items-center gap-3 mb-4">
          <Server className="w-5 h-5 text-primary-400" />
          <h3 className="font-semibold text-surface-100">Paperless-ngx API testen</h3>
        </div>
        
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-surface-400 mb-1">Paperless URL</label>
            <input
              type="text"
              value={paperlessUrl}
              onChange={(e) => setPaperlessUrl(e.target.value)}
              placeholder="z.B. http://192.13.37.4:8000 oder https://paperless.domain.de"
              className="input"
            />
          </div>
          <div>
            <label className="block text-sm text-surface-400 mb-1">API Token (optional für erweiterten Test)</label>
            <input
              type="password"
              value={paperlessToken}
              onChange={(e) => setPaperlessToken(e.target.value)}
              placeholder="Token aus Paperless Admin"
              className="input"
            />
          </div>
          <button
            onClick={runPaperlessTest}
            disabled={paperlessLoading || !paperlessUrl}
            className="btn btn-primary flex items-center gap-2"
          >
            {paperlessLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            Testen
          </button>
        </div>
        
        {paperlessResult && (
          <div className={clsx(
            'mt-4 p-4 rounded-lg',
            paperlessResult.success 
              ? 'bg-emerald-500/10 border border-emerald-500/30' 
              : 'bg-amber-500/10 border border-amber-500/30'
          )}>
            <div className="flex items-center gap-2 mb-2">
              {paperlessResult.success ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              ) : (
                <XCircle className="w-5 h-5 text-amber-400" />
              )}
              <span className={paperlessResult.success ? 'text-emerald-400' : 'text-amber-400'}>
                {paperlessResult.message}
              </span>
            </div>
            
            {paperlessResult.working_url && (
              <div className="text-sm text-emerald-300 mt-2">
                <strong>Funktionierende URL:</strong>{' '}
                <code className="px-1 py-0.5 bg-surface-800 rounded">{paperlessResult.working_url}</code>
              </div>
            )}
            
            {paperlessResult.redirect_target && (
              <div className="text-sm text-surface-300 mt-2">
                <strong>Redirect zu:</strong>{' '}
                <code className="px-1 py-0.5 bg-surface-800 rounded text-primary-400">{paperlessResult.redirect_target}</code>
              </div>
            )}
            
            {paperlessResult.redirect_detected && (
              <div className="text-sm text-amber-300 mt-2">
                <strong>Redirect erkannt:</strong>{' '}
                <code className="px-1 py-0.5 bg-surface-800 rounded">{paperlessResult.redirect_detected}</code>
                <p className="mt-1 text-surface-400">Versuche diese URL direkt!</p>
              </div>
            )}
            
            {paperlessResult.hint && (
              <div className="text-sm text-surface-400 mt-2">
                <strong>Tipp:</strong> {paperlessResult.hint}
              </div>
            )}
            
            {paperlessResult.tested_urls && paperlessResult.tested_urls.length > 0 && (
              <details className="mt-3">
                <summary className="text-sm text-surface-400 cursor-pointer hover:text-surface-300">
                  Getestete URLs anzeigen ({paperlessResult.tested_urls.length})
                </summary>
                <div className="mt-2 space-y-1 text-xs font-mono">
                  {paperlessResult.tested_urls.map((t: any, i: number) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className={t.status === 200 ? 'text-emerald-400' : 'text-surface-500'}>
                        {t.status || 'ERR'}
                      </span>
                      <span className="text-surface-400">{t.url}</span>
                      {t.final_url && t.final_url !== t.url && (
                        <span className="text-primary-400">→ {t.final_url}</span>
                      )}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
        
        <div className="mt-4 p-3 rounded-lg bg-surface-700/50 text-sm text-surface-400">
          <strong className="text-surface-300">Tipps:</strong>
          <ul className="mt-1 space-y-1 list-disc list-inside">
            <li>HTTP 302 = Redirect, versuche die Ziel-URL oder HTTPS</li>
            <li>Lokales Paperless: <code className="text-primary-400">http://host.docker.internal:PORT</code></li>
            <li>Falls Login nötig: Trage den API Token ein</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

