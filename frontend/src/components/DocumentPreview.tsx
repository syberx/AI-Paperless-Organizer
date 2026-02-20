import { useState } from 'react'
import { ZoomIn, ZoomOut, RotateCcw, Eye } from 'lucide-react'

interface DocumentPreviewProps {
    documentId: number
    height?: string
}

const ZOOM_STEPS = [50, 75, 100, 125, 150, 200, 250, 300]
const DEFAULT_ZOOM_INDEX = 2

export default function DocumentPreview({ documentId, height = '500px' }: DocumentPreviewProps) {
    const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX)
    const zoom = ZOOM_STEPS[zoomIndex]
    const scale = zoom / 100

    const zoomIn = () => setZoomIndex(i => Math.min(i + 1, ZOOM_STEPS.length - 1))
    const zoomOut = () => setZoomIndex(i => Math.max(i - 1, 0))
    const zoomReset = () => setZoomIndex(DEFAULT_ZOOM_INDEX)

    return (
        <div>
            <h4 className="text-sm font-semibold text-violet-300 mb-3 flex items-center gap-2">
                <Eye className="w-4 h-4 text-violet-400" />
                PDF Vorschau
                <div className="ml-auto flex items-center gap-1">
                    <button
                        onClick={zoomOut}
                        disabled={zoomIndex === 0}
                        className="p-1 rounded hover:bg-surface-700 text-surface-400 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-surface-400 transition-colors"
                        title="Verkleinern"
                    >
                        <ZoomOut className="w-4 h-4" />
                    </button>
                    <button
                        onClick={zoomReset}
                        className="px-1.5 py-0.5 rounded hover:bg-surface-700 text-xs font-mono text-surface-400 hover:text-white transition-colors min-w-[3rem] text-center"
                        title="Zoom zurücksetzen"
                    >
                        {zoom}%
                    </button>
                    <button
                        onClick={zoomIn}
                        disabled={zoomIndex === ZOOM_STEPS.length - 1}
                        className="p-1 rounded hover:bg-surface-700 text-surface-400 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-surface-400 transition-colors"
                        title="Vergrößern"
                    >
                        <ZoomIn className="w-4 h-4" />
                    </button>
                    {zoomIndex !== DEFAULT_ZOOM_INDEX && (
                        <button
                            onClick={zoomReset}
                            className="p-1 rounded hover:bg-surface-700 text-surface-500 hover:text-white transition-colors ml-1"
                            title="Zurücksetzen"
                        >
                            <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                    )}
                </div>
            </h4>
            <div
                className="bg-surface-900/60 rounded-xl border border-violet-500/20 overflow-auto custom-scrollbar"
                style={{ height }}
            >
                <div
                    style={{
                        width: `${scale * 100}%`,
                        height: `${scale * 100}%`,
                        transformOrigin: '0 0',
                    }}
                >
                    <iframe
                        src={`/api/ocr/preview/${documentId}#toolbar=0&navpanes=0`}
                        title="PDF Vorschau"
                        className="border-0 bg-white"
                        style={{
                            width: `${100 / scale}%`,
                            height: `${100 / scale}%`,
                            transform: `scale(${scale})`,
                            transformOrigin: '0 0',
                        }}
                    />
                </div>
            </div>
        </div>
    )
}
