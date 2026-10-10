import ChatWindow from '@/components/chat/chat-window'

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-cyan-50 to-blue-50 dark:from-gray-900 dark:to-gray-800">
      <div className="container mx-auto px-4 py-8 h-screen flex flex-col">
        <header className="mb-6">
          <h1 className="text-3xl font-bold text-center" style={{ color: 'hsl(var(--primary))' }}>
            通用网页搭建专家
          </h1>
          <p className="text-center mt-2" style={{ color: 'hsl(var(--muted-foreground))' }}>
            智能客服系统 - 订单查询 / 物流跟踪 / 售后处理
          </p>
        </header>
        <div className="flex-1 flex items-center justify-center">
          <ChatWindow />
        </div>
      </div>
    </main>
  )
}
