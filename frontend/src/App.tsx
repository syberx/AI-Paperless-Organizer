import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './components/Dashboard'
import CorrespondentManager from './components/CorrespondentManager'
import TagManager from './components/TagManager'
import TagCleanupWizard from './components/TagCleanupWizard'
import DocumentTypeManager from './components/DocumentTypeManager'
import SettingsPanel from './components/SettingsPanel'
import PromptEditor from './components/PromptEditor'
import DebugPanel from './components/DebugPanel'
import OcrManager from './components/OcrManager'
import CleanupManager from './components/CleanupManager'

function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/ocr" element={<OcrManager />} />
        <Route path="/cleanup" element={<CleanupManager />} />
        <Route path="/correspondents" element={<CorrespondentManager />} />
        <Route path="/tags" element={<TagManager />} />
        <Route path="/tags/wizard" element={<TagCleanupWizard />} />
        <Route path="/document-types" element={<DocumentTypeManager />} />
        <Route path="/settings" element={<SettingsPanel />} />
        <Route path="/prompts" element={<PromptEditor />} />
        <Route path="/debug" element={<DebugPanel />} />
      </Routes>
    </Layout>
  )
}

export default App

