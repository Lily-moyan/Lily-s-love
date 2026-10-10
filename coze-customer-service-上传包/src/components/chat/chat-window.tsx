'use client'

import { useState, useRef, useEffect } from 'react'

interface Message {
  role: 'user' | 'assistant'
  content: string
  nodeTitle?: string
  loopIndex?: number
}

interface PendingResume {
  eventId: string
  interruptType: number
}

export default function ChatWindow() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [pendingResume, setPendingResume] = useState<PendingResume | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [isMounted, setIsMounted] = useState(false)

  useEffect(() => {
    setIsMounted(true)
  }, [])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const handleSend = async () => {
    if (!input.trim() || isLoading) return

    const userMessage = input.trim()
    setInput('')
    setIsLoading(true)

    // 添加用户消息
    setMessages(prev => [...prev, { role: 'user', content: userMessage }])

    try {
      const requestBody = pendingResume
        ? {
            message: userMessage,
            eventId: pendingResume.eventId,
            interruptType: pendingResume.interruptType,
          }
        : {
            message: userMessage,
          }

      // 清除 pending resume（在发送后）
      if (pendingResume) {
        setPendingResume(null)
      }

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error('无法读取响应流')
      }

      const decoder = new TextDecoder()
      let buffer = ''
      const assistantMessages: Message[] = []
      let hasOrderResult = false

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.trim()) continue

          try {
            const data = JSON.parse(line)

            if (data.type === 'coze_event') {
              const event = data.event

              // 处理 Message 事件
              if (event.event === 'Message') {
                const nodeTitle = event.data?.node_title || '回复'
                const loopIndex = event.data?.loop_index || 0
                const content = event.data?.content || ''

                if (content && content.includes('订单')) {
                  hasOrderResult = true
                }

                // 按 node_title + loop_index 分组
                const key = `${nodeTitle}_${loopIndex}`
                const existingIndex = assistantMessages.findIndex(
                  m => `${m.nodeTitle}_${m.loopIndex}` === key
                )

                if (existingIndex >= 0) {
                  // 追加到现有气泡
                  assistantMessages[existingIndex].content += content
                } else {
                  // 创建新气泡
                  assistantMessages.push({
                    role: 'assistant',
                    content,
                    nodeTitle,
                    loopIndex,
                  })
                }

                // 实时更新显示
                setMessages(prev => {
                  const userMsgs = prev.filter(m => m.role === 'user')
                  return [...userMsgs, ...assistantMessages]
                })
              }

              // 处理 Interrupt 事件（追问）
              if (event.event === 'Interrupt') {
                const interruptData = event.data
                setPendingResume({
                  eventId: interruptData.event_id,
                  interruptType: interruptData.interrupt_type,
                })

                // 显示追问内容
                const interruptMsg = interruptData.data?.output || '请提供更多信息'
                assistantMessages.push({
                  role: 'assistant',
                  content: interruptMsg,
                })

                setMessages(prev => {
                  const userMsgs = prev.filter(m => m.role === 'user')
                  return [...userMsgs, ...assistantMessages]
                })
              }

              // 处理 Error 事件
              if (event.event === 'Error') {
                assistantMessages.push({
                  role: 'assistant',
                  content: `错误: ${event.data?.msg || '未知错误'}`,
                })

                setMessages(prev => {
                  const userMsgs = prev.filter(m => m.role === 'user')
                  return [...userMsgs, ...assistantMessages]
                })
              }
            }

            if (data.type === 'error') {
              throw new Error(data.error)
            }
          } catch (e) {
            console.error('Failed to parse line:', line, e)
          }
        }
      }

      // 未查到 fallback：检查用户输入是否像订单号/手机号且没有订单结果
      const looksLikeOrderQuery =
        /^\d{11}$/.test(userMessage) || /^\d{10,20}$/.test(userMessage)
      if (looksLikeOrderQuery && !hasOrderResult && assistantMessages.length === 0) {
        setMessages(prev => [
          ...prev,
          {
            role: 'assistant',
            content: '未查询到相关订单信息，请检查您的手机号或快递单号是否正确。',
          },
        ])
      }
    } catch (error) {
      console.error('Chat error:', error)
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: `抱歉，发生了错误: ${error instanceof Error ? error.message : '未知错误'}`,
        },
      ])
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  if (!isMounted) {
    return null
  }

  return (
    <div
      className="w-full max-w-4xl mx-auto flex flex-col shadow-bento"
      style={{
        height: '600px',
        backgroundColor: 'hsl(var(--card))',
        borderRadius: 'var(--radius)',
        border: '1px solid hsl(var(--border))',
      }}
    >
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] px-4 py-3 ${
                msg.role === 'user'
                  ? 'text-white'
                  : 'text-foreground'
              }`}
              style={{
                backgroundColor:
                  msg.role === 'user' ? 'hsl(var(--primary))' : 'hsl(var(--muted))',
                borderRadius: 'var(--radius)',
                color:
                  msg.role === 'user'
                    ? 'hsl(var(--primary-foreground))'
                    : 'hsl(var(--foreground))',
              }}
            >
              {msg.nodeTitle && msg.role === 'assistant' && (
                <div
                  className="text-xs mb-1 opacity-70"
                  style={{ color: 'hsl(var(--muted-foreground))' }}
                >
                  {msg.nodeTitle}
                  {msg.loopIndex !== undefined && msg.loopIndex > 0 && ` #${msg.loopIndex + 1}`}
                </div>
              )}
              <div className="whitespace-pre-wrap break-words">{msg.content}</div>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div
              className="px-4 py-3"
              style={{
                backgroundColor: 'hsl(var(--muted))',
                borderRadius: 'var(--radius)',
                color: 'hsl(var(--muted-foreground))',
              }}
            >
              <div className="flex space-x-2">
                <div className="w-2 h-2 rounded-full bg-current animate-bounce" style={{ animationDelay: '0ms' }}></div>
                <div className="w-2 h-2 rounded-full bg-current animate-bounce" style={{ animationDelay: '150ms' }}></div>
                <div className="w-2 h-2 rounded-full bg-current animate-bounce" style={{ animationDelay: '300ms' }}></div>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div
        className="p-4"
        style={{
          borderTop: '1px solid hsl(var(--border))',
        }}
      >
        <div className="flex space-x-2">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={pendingResume ? '请回答上述问题...' : '请输入您的问题...'}
            disabled={isLoading}
            className="flex-1 px-4 py-2 focus:outline-none focus:ring-2"
            style={{
              backgroundColor: 'hsl(var(--input))',
              borderRadius: 'var(--radius)',
              border: '1px solid hsl(var(--border))',
              color: 'hsl(var(--foreground))',
            }}
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !input.trim()}
            className="px-6 py-2 font-medium transition-opacity disabled:opacity-50"
            style={{
              backgroundColor: 'hsl(var(--primary))',
              color: 'hsl(var(--primary-foreground))',
              borderRadius: 'var(--radius)',
            }}
          >
            发送
          </button>
        </div>
      </div>
    </div>
  )
}
