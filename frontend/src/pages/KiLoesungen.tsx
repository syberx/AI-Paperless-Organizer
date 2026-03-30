import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Briefcase, ExternalLink, Mail, Building2, FileText, Wrench, EyeOff, CheckCircle2 } from 'lucide-react'

const HIDE_KEY = 'ki_loesungen_hidden'

export default function KiLoesungen() {
  const navigate = useNavigate()
  const [hidden, setHidden] = useState(false)

  const handleHide = () => {
    localStorage.setItem(HIDE_KEY, 'true')
    setHidden(true)
    setTimeout(() => navigate('/'), 1500)
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">

      {/* Header */}
      <div className="card p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-700
                            flex items-center justify-center shadow-lg shadow-primary-600/30 flex-shrink-0">
              <Briefcase className="w-7 h-7 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-xl font-bold text-surface-100">Individuelle KI-Lösungen</h1>
                <span className="text-xs px-2 py-0.5 rounded-full bg-surface-700 text-surface-500 border border-surface-600/50">
                  Eigenwerbung
                </span>
              </div>
              <p className="text-surface-400 text-sm">
                Maßgeschneiderte KI-Systemlösungen für Unternehmen – von Christian Wilms
              </p>
            </div>
          </div>
        </div>

        <p className="mt-4 text-surface-300 text-sm leading-relaxed">
          Wer dieses Tool nutzt, versteht bereits den Wert von KI-Automatisierung.
          <strong className="text-surface-100"> Stell dir vor, was das für dein gesamtes Unternehmen bedeuten könnte.</strong>
        </p>
      </div>

      {/* Services */}
      <div className="grid gap-4">
        <div className="card p-5 flex gap-4">
          <div className="w-10 h-10 rounded-xl bg-primary-500/10 border border-primary-500/20
                          flex items-center justify-center flex-shrink-0 mt-0.5">
            <Building2 className="w-5 h-5 text-primary-400" />
          </div>
          <div>
            <h2 className="text-surface-100 font-semibold mb-1">KI-Systemlösungen für Unternehmen</h2>
            <p className="text-surface-400 text-sm leading-relaxed">
              Individuelle KI-Integration in bestehende Infrastruktur und Prozesse – abgestimmt auf die
              spezifischen Anforderungen deines Unternehmens. Vollständig <strong className="text-surface-300">DSGVO-konform</strong>,
              On-Premise möglich, kein Cloud-Zwang. Die KI läuft dort, wo deine Daten sicher sind.
            </p>
          </div>
        </div>

        <div className="card p-5 flex gap-4">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20
                          flex items-center justify-center flex-shrink-0 mt-0.5">
            <FileText className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-surface-100 font-semibold mb-1">Paperless Organizer – Setup & Anpassung</h2>
            <p className="text-surface-400 text-sm leading-relaxed">
              Professionelle Einrichtung dieses Tools für dein Unternehmen oder Büro – mit maßgeschneiderten
              Klassifizierungsregeln, Speicherpfad-Profilen, Custom Fields und automatisierten Workflows.
              Damit du von Anfang an das Maximum herausholst.
            </p>
          </div>
        </div>

        <div className="card p-5 flex gap-4">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20
                          flex items-center justify-center flex-shrink-0 mt-0.5">
            <Wrench className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h2 className="text-surface-100 font-semibold mb-1">Individuelle KI-Automatisierung</h2>
            <p className="text-surface-400 text-sm leading-relaxed">
              Dokumentenverarbeitung, Prozessautomatisierung, LLM-Integration in vorhandene Systeme –
              entwickelt exakt für deine Abläufe. Nicht von der Stange, sondern auf dein Unternehmen
              zugeschnitten.
            </p>
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="card p-6 border border-primary-500/20 bg-primary-500/5">
        <h2 className="text-surface-100 font-semibold mb-1">Interesse an einer Zusammenarbeit?</h2>
        <p className="text-surface-400 text-sm mb-4">
          Kostenlose Erstberatung – lass uns besprechen, wie KI-Automatisierung deinem Unternehmen konkret helfen kann.
        </p>
        <div className="flex flex-wrap gap-3">
          <a
            href="https://web-dienste.com"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary flex items-center gap-2"
          >
            <ExternalLink className="w-4 h-4" />
            web-dienste.com
          </a>
          <a
            href="mailto:info@web-dienste.com"
            className="btn bg-surface-700 hover:bg-surface-600 text-surface-200 flex items-center gap-2"
          >
            <Mail className="w-4 h-4" />
            info@web-dienste.com
          </a>
        </div>
      </div>

      {/* Hide option */}
      <div className="flex items-center justify-between px-1">
        <p className="text-xs text-surface-600">
          Dieser Menüpunkt ist Eigenwerbung des Projektautors.
        </p>
        {hidden ? (
          <span className="flex items-center gap-1.5 text-xs text-emerald-400">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Ausgeblendet – weiterleitung...
          </span>
        ) : (
          <button
            onClick={handleHide}
            className="flex items-center gap-1.5 text-xs text-surface-500 hover:text-red-400 transition-colors"
          >
            <EyeOff className="w-3.5 h-3.5" />
            Menüpunkt dauerhaft ausblenden
          </button>
        )}
      </div>

    </div>
  )
}
