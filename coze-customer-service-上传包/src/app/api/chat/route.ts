import { NextRequest } from 'next/server'

const COZE_API_BASE = 'https://api.coze.cn/v1/workflow'

interface ChatRequestBody {
  message: string
  eventId?: string
  interruptType?: number
}

export async function POST(request: NextRequest) {
  try {
    const body: ChatRequestBody = await request.json()
    const { message, eventId, interruptType } = body

    const COZE_PAT = process.env.COZE_PAT
    const WORKFLOW_ID = process.env.COZE_WORKFLOW_ID

    if (!COZE_PAT || !WORKFLOW_ID) {
      return new Response(
        JSON.stringify({ type: 'error', error: '服务配置错误' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // 根据是否有 eventId 路由到不同端点
    const isResume = !!eventId
    const endpoint = isResume ? `${COZE_API_BASE}/stream_resume` : `${COZE_API_BASE}/stream_run`

    // 构建请求体
    const requestBody = isResume
      ? {
          workflow_id: WORKFLOW_ID,
          event_id: eventId,
          interrupt_type: interruptType || 0,
          resume_data: message,
        }
      : {
          workflow_id: WORKFLOW_ID,
          parameters: {
            user_input: message,
          },
        }

    // 调用 Coze 工作流 API
    const cozeResponse = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${COZE_PAT}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })

    if (!cozeResponse.ok) {
      const errorText = await cozeResponse.text()
      console.error('Coze API error:', errorText)
      return new Response(
        JSON.stringify({ type: 'error', error: `工作流调用失败: ${cozeResponse.status}` }),
        { status: cozeResponse.status, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // 创建 SSE 流式响应
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const reader = cozeResponse.body?.getReader()
          if (!reader) {
            controller.enqueue(encoder.encode(JSON.stringify({ type: 'error', error: '无法读取响应流' }) + '\n'))
            controller.close()
            return
          }

          let buffer = ''

          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            // 解码并追加到缓冲区
            buffer += new TextDecoder().decode(value, { stream: true })

            // 处理完整的 SSE 行
            const lines = buffer.split('\n')
            buffer = lines.pop() || '' // 保留最后一个不完整的行

            for (const line of lines) {
              if (!line.trim() || line.startsWith(':')) continue

              if (line.startsWith('data: ')) {
                const dataStr = line.slice(6).trim()
                if (dataStr === '[DONE]') {
                  controller.enqueue(encoder.encode(JSON.stringify({ type: 'done' }) + '\n'))
                  continue
                }

                try {
                  const eventData = JSON.parse(dataStr)
                  // 透传 Coze 事件到前端
                  controller.enqueue(
                    encoder.encode(
                      JSON.stringify({
                        type: 'coze_event',
                        event: eventData,
                      }) + '\n'
                    )
                  )
                } catch (e) {
                  console.error('Failed to parse event data:', dataStr, e)
                }
              }
            }
          }

          controller.close()
        } catch (error) {
          console.error('Stream processing error:', error)
          controller.enqueue(
            encoder.encode(JSON.stringify({ type: 'error', error: '流处理失败' }) + '\n')
          )
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  } catch (error) {
    console.error('API route error:', error)
    return new Response(
      JSON.stringify({ type: 'error', error: '服务器内部错误' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
