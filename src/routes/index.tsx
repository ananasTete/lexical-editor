import { createFileRoute } from '@tanstack/react-router'
import { LexicalEditor } from '../components/editor'

export const Route = createFileRoute('/')({
  component: App,
})

function App() {
  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="container mx-auto px-4">
        <h1 className="text-3xl font-bold text-center mb-2 text-gray-800">
          Markdown 编辑器
        </h1>
        <p className="text-center text-gray-600 mb-8">
          所见即所得的 Markdown 编辑体验，支持撤销/重做功能
        </p>
        <LexicalEditor />
      </div>
    </div>
  )
}
