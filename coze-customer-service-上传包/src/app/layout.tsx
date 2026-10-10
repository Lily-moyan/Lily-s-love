import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '通用网页搭建专家 - 智能客服',
  description: '基于 Coze 工作流的智能客服系统',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  )
}
